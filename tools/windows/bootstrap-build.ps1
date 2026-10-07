#Requires -Version 5.1
<#
.SYNOPSIS
    One command that takes a Windows machine from a clean disk to an unsigned
    Aurelia development artifact.

.DESCRIPTION
    The script runs the same pipeline as tools/chromium/build.mjs and the
    self-hosted CI workflow, in the same order, by calling the same tools:

        detect -> gate -> pin -> depot_tools -> gclient sync -> verify HEAD
        -> overlay + patch series -> fork delta -> gn gen -> autoninja chrome
        -> stage the complete runtime directory -> smoke test -> package

    It never edits the registry, never touches the pagefile, never changes
    system settings and never deletes anything. Writes are confined to -Dest,
    the repository's artifacts\local-build directory (logs) and the repository
    itself (the tools read it; they do not modify tracked files).

    LOW_RESOURCE_EXPERIMENT (-LowResourceExperiment)
    The documented builder minimum (8+ cores / 32 GB RAM / 150 GB free, see
    docs/BUILDING-CHROMIUM.md) is never lowered. This switch lets a
    below-reference machine - for example an 8 GB i3 with ~110 GB free -
    attempt a development build anyway:

      * RAM and CPU shortfalls become warnings, not refusals;
      * the GN profile config/gn/win-x64-low-resource.gn is used
        (symbol_level = 0, concurrent_links = 1: slower, smaller, less RAM);
      * autoninja runs with -j N where N comes from the measured machine
        (tools/chromium/low-resource.mjs), never from a guess;
      * disk space stays a hard requirement: 100 GB free with a 15 GB reserve
        that the build is stopped before it can consume.

    Nothing security-relevant changes: the sandbox, site isolation, TLS
    verification and process isolation are untouched by either profile.

    RESUMABLE MODES
    Each mode records its own checkpoint, so a machine can be rebooted between
    steps and -Mode ALL skips work that already succeeded:

        CHECK    detect and print the machine, then stop
        SYNC     pin + depot_tools + gclient sync + verify HEAD
        VERIFY   patch set against the pristine checkout + fork-delta budget
        BUILD    overlay + patches + gn gen + autoninja chrome + stage
        SMOKE    launch chrome://aurelia, check the pin, verify a clean exit
        PACKAGE  zip the staged directory + SHA-256 sidecar
        ALL      everything above, in order (default)
        CLEANUP  explicit, prompt-confirmed deletion of checkout/artifacts/logs

    LOGS
    artifacts\local-build\bootstrap.log   what this script did
    artifacts\local-build\environment.json the machine report (JSON)
    artifacts\local-build\build.log       build driver + tool output
    artifacts\local-build\gn.log          the gn gen stage
    artifacts\local-build\last-error.txt  the failing stage and command

.PARAMETER Dest
    Directory that holds the Chromium checkout (src) and the artifacts.
    Defaults to $env:AURELIA_CHROMIUM_DEST. Keep it short (for example D:\aeb):
    a deep path can break builds on machines without long-path support.

.PARAMETER Mode
    CHECK, SYNC, VERIFY, BUILD, SMOKE, PACKAGE, ALL (default) or CLEANUP.

.PARAMETER LowResourceExperiment
    Opt in to LOW_RESOURCE_EXPERIMENT on a below-reference machine. Prints a
    large warning and continues when the necessary prerequisites exist; never
    rejects solely for low RAM or CPU.

.PARAMETER CleanupTarget
    With -Mode CLEANUP: checkout, artifacts, logs or all.

.PARAMETER Yes
    Answer the CLEANUP confirmation prompt non-interactively.

.PARAMETER Force
    Re-run modes whose checkpoints already recorded success.

.PARAMETER DryRun
    Print the exact commands each requested mode would run (the build driver's
    --dry-run) and stop. Nothing is downloaded, compiled or changed.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File tools\windows\bootstrap-build.ps1 -Dest D:\aeb -Mode CHECK

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File tools\windows\bootstrap-build.ps1 -Dest D:\aeb -LowResourceExperiment

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File tools\windows\bootstrap-build.ps1 -Dest D:\aeb -Mode CLEANUP -CleanupTarget all -Yes

.NOTES
    Written for Windows PowerShell 5.1 (the version that ships with Windows
    10/11) and PowerShell 7+. Windows execution has not been verified yet:
    see docs/LOCAL-WINDOWS-BUILD.md for what has and has not been proven.
#>
[CmdletBinding()]
param(
    [ValidateSet('CHECK', 'SYNC', 'VERIFY', 'BUILD', 'SMOKE', 'PACKAGE', 'ALL', 'CLEANUP')]
    [string]$Mode = 'ALL',

    [string]$Dest = $env:AURELIA_CHROMIUM_DEST,

    [switch]$LowResourceExperiment,

    [ValidateSet('checkout', 'artifacts', 'logs', 'all')]
    [string]$CleanupTarget = 'checkout',

    [switch]$Yes,

    [switch]$Force,

    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

# A build tool that writes progress to stderr must never abort this script.
# Windows PowerShell 5.1 does not turn native stderr into an error, but
# PowerShell 7.3+ can (via $PSNativeCommandUseErrorActionPreference), and that
# difference already caused one silently failed hosted-runner run. The
# preference is pinned off and every exit code is checked explicitly instead.
$PSNativeCommandUseErrorActionPreference = $false

# ---------------------------------------------------------------- paths -----

if ($PSScriptRoot) {
    $ScriptDir = $PSScriptRoot
} else {
    $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}
$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $ScriptDir '..\..')).Path
$BuildDriver = Join-Path $RepoRoot 'tools\chromium\build.mjs'
$LowResourceTool = Join-Path $RepoRoot 'tools\chromium\low-resource.mjs'

$LogDir = Join-Path $RepoRoot 'artifacts\local-build'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$BootstrapLog = Join-Path $LogDir 'bootstrap.log'
$EnvironmentFile = Join-Path $LogDir 'environment.json'
$BuildLog = Join-Path $LogDir 'build.log'
$LastErrorFile = Join-Path $LogDir 'last-error.txt'
$StateFile = Join-Path $LogDir 'state.json'

$script:Verdict = $null

# 1 GiB in bytes; a named constant keeps the arithmetic readable and keeps the
# file parseable by static tooling that does not know PowerShell's numeric
# multipliers (1GB).
$script:GiB = 1073741824

$StageSets = [ordered]@{
    SYNC    = @('preflight', 'sync')
    VERIFY  = @('preflight', 'verify-patches', 'fork-delta')
    BUILD   = @('preflight', 'install-overlay', 'fork-delta', 'gn-args', 'gn-gen', 'compile', 'stage')
    SMOKE   = @('smoke-test', 'record')
    PACKAGE = @('package')
}
$ModeOrder = @('SYNC', 'VERIFY', 'BUILD', 'SMOKE', 'PACKAGE')

# -------------------------------------------------------------- logging -----

$script:LogStreams = @{}

function Write-Utf8NoBom {
    param(
        [string]$Path,
        [string]$Text
    )
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Text, $encoding)
}

function Get-LogStream {
    param([string]$Path)
    if (-not $script:LogStreams.ContainsKey($Path)) {
        $encoding = New-Object System.Text.UTF8Encoding($false)
        $stream = New-Object System.IO.StreamWriter($Path, $true, $encoding)
        $stream.AutoFlush = $true
        $script:LogStreams[$Path] = $stream
    }
    return $script:LogStreams[$Path]
}

function Write-Log {
    param(
        [string]$Text = '',
        [string]$Colour = $null
    )
    if ($Text -eq '') {
        Write-Host ''
    } elseif ($Colour) {
        Write-Host $Text -ForegroundColor $Colour
    } else {
        Write-Host $Text
    }
    try {
        (Get-LogStream $BootstrapLog).WriteLine($Text)
    } catch {
        # logging must never mask the real result
    }
}

function Write-Raw {
    param(
        [string]$Text = '',
        [string]$Path = $null
    )
    Write-Host $Text
    if ($Path) {
        try {
            (Get-LogStream $Path).WriteLine($Text)
        } catch {
        }
    }
}

function Close-Logs {
    foreach ($key in @($script:LogStreams.Keys)) {
        try {
            $script:LogStreams[$key].Dispose()
        } catch {
        }
        $script:LogStreams.Remove($key)
    }
}

# ------------------------------------------------------------- natives ------

function Get-ArgumentString {
    param([string[]]$Arguments)
    $parts = @()
    foreach ($argument in $Arguments) {
        if ($argument -match '[\s"]') {
            $parts += '"' + ($argument -replace '(\\*)"', '$1$1\"') + '"'
        } else {
            $parts += $argument
        }
    }
    return ($parts -join ' ')
}

function Invoke-NativeChecked {
    param(
        [string]$FilePath,
        [string[]]$Arguments = @(),
        [string]$WorkingDirectory = $null,
        [string]$LogFile = $null,
        [switch]$AllowFailure
    )
    $display = "$FilePath $(Get-ArgumentString $Arguments)"
    Write-Raw "    > $display" $LogFile
    $previous = $null
    if ($WorkingDirectory) {
        $previous = (Get-Location).Path
        Set-Location -LiteralPath $WorkingDirectory
    }
    try {
        & $FilePath @Arguments 2>&1 | ForEach-Object {
            $line = if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.ToString() } else { "$_" }
            Write-Raw $line $LogFile
        }
        $code = $LASTEXITCODE
    } finally {
        if ($previous) {
            Set-Location -LiteralPath $previous
        }
    }
    if ($null -eq $code) {
        $code = 0
    }
    if ($code -ne 0 -and -not $AllowFailure) {
        Write-FailureNote "stage command failed with exit code $code`: $display"
        throw "command failed with exit code $code`: $display (see $LastErrorFile)"
    }
    return $code
}

function Invoke-NativeCaptured {
    param(
        [string]$FilePath,
        [string[]]$Arguments = @(),
        [string]$WorkingDirectory = $null,
        [string]$LogFile = $null
    )
    $display = "$FilePath $(Get-ArgumentString $Arguments)"
    Write-Raw "    > $display" $LogFile
    $errorFile = [System.IO.Path]::GetTempFileName()
    $previous = $null
    if ($WorkingDirectory) {
        $previous = (Get-Location).Path
        Set-Location -LiteralPath $WorkingDirectory
    }
    try {
        $lines = @(& $FilePath @Arguments 2>$errorFile)
        $code = $LASTEXITCODE
    } finally {
        if ($previous) {
            Set-Location -LiteralPath $previous
        }
    }
    if ($null -eq $code) {
        $code = 0
    }
    try {
        if (Test-Path -LiteralPath $errorFile) {
            $errorText = (Get-Content -LiteralPath $errorFile -Raw -ErrorAction SilentlyContinue)
            if ($errorText) {
                foreach ($line in ($errorText -split "`r?`n")) {
                    if ($line -and $line.Trim().Length -gt 0) {
                        Write-Raw "    ! $line" $LogFile
                    }
                }
            }
        }
    } finally {
        Remove-Item -LiteralPath $errorFile -Force -ErrorAction SilentlyContinue
    }
    return [ordered]@{
        Output   = (@($lines) -join "`n").Trim()
        ExitCode = $code
    }
}

function Write-FailureNote {
    param([string]$Text)
    $lines = @(
        "time:    $((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'))",
        "script:  tools/windows/bootstrap-build.ps1",
        "mode:    $Mode",
        "detail:  $Text"
    )
    try {
        # Written BOM-free on purpose: Set-Content -Encoding UTF8 adds a
        # byte-order mark under Windows PowerShell 5.1, and anything that parses
        # this file (or the JSON beside it) would fail on it.
        Write-Utf8NoBom -Path $LastErrorFile -Text (($lines -join "`r`n") + "`r`n")
    } catch {
    }
}

# ------------------------------------------------------- environment --------

function Convert-KbToGb {
    param([double]$Kb)
    return [math]::Round($Kb / 1048576, 1)
}

function Join-Safe {
    param([string]$Base, [string]$Leaf)
    if ([string]::IsNullOrEmpty($Base)) {
        return $null
    }
    return (Join-Path $Base $Leaf)
}

function Get-WindowsInfo {
    $info = [ordered]@{
        productName    = $null
        caption        = $null
        version        = $null
        buildNumber    = $null
        buildRevision  = $null
        displayVersion = $null
        architecture   = $null
        isWindows11    = $false
    }
    try {
        $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop
        $info.caption = "$($os.Caption)".Trim()
        $info.productName = $info.caption
        $info.version = "$($os.Version)"
        $info.buildNumber = [int]$os.BuildNumber
        $info.architecture = "$($os.OSArchitecture)"
    } catch {
        Write-Log "  warning: Win32_OperatingSystem could not be read: $($_.Exception.Message)" 'Yellow'
    }
    try {
        $currentVersion = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -ErrorAction Stop
        $names = @($currentVersion.PSObject.Properties.Name)
        if (($names -contains 'ProductName') -and $currentVersion.ProductName) {
            $info.productName = "$($currentVersion.ProductName)".Trim()
        }
        if (($names -contains 'DisplayVersion') -and $currentVersion.DisplayVersion) {
            $info.displayVersion = "$($currentVersion.DisplayVersion)".Trim()
        }
        if (($names -contains 'CurrentBuildNumber') -and $currentVersion.CurrentBuildNumber) {
            $info.buildNumber = [int]$currentVersion.CurrentBuildNumber
        }
        if (($names -contains 'UBR') -and ($null -ne $currentVersion.UBR)) {
            $info.buildRevision = [int]$currentVersion.UBR
        }
    } catch {
        Write-Log "  warning: the Windows version registry keys could not be read: $($_.Exception.Message)" 'Yellow'
    }
    if ($null -ne $info.buildNumber) {
        $info.isWindows11 = ([int]$info.buildNumber -ge 22000)
    }
    return $info
}

function Get-CpuInfo {
    try {
        $processors = @(Get-CimInstance -ClassName Win32_Processor -ErrorAction Stop)
        if ($processors.Count -gt 0) {
            $physical = 0
            $logical = 0
            foreach ($processor in $processors) {
                if ($processor.NumberOfCores) { $physical += [int]$processor.NumberOfCores }
                if ($processor.NumberOfLogicalProcessors) { $logical += [int]$processor.NumberOfLogicalProcessors }
            }
            $model = "$($processors[0].Name)".Trim()
            $model = $model -replace '\s+', ' '
            return [ordered]@{ model = $model; physicalCores = $physical; logicalCores = $logical }
        }
    } catch {
        Write-Log "  warning: Win32_Processor could not be read: $($_.Exception.Message)" 'Yellow'
    }
    return [ordered]@{
        model         = $null
        physicalCores = 0
        logicalCores  = [int]$env:NUMBER_OF_PROCESSORS
    }
}

function Get-MemoryInfo {
    try {
        $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop
        return [ordered]@{
            totalGb     = Convert-KbToGb ([double]$os.TotalVisibleMemorySize)
            availableGb = Convert-KbToGb ([double]$os.FreePhysicalMemory)
        }
    } catch {
        Write-Log "  warning: RAM could not be measured: $($_.Exception.Message)" 'Yellow'
        return [ordered]@{ totalGb = 0; availableGb = 0 }
    }
}

function Resolve-VolumeTarget {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) {
        return $null
    }
    $full = $Path
    if (-not [System.IO.Path]::IsPathRooted($full)) {
        $full = Join-Path (Get-Location).Path $full
    }
    $probe = $full
    while (-not (Test-Path -LiteralPath $probe)) {
        $parent = Split-Path -Parent $probe
        if (-not $parent -or $parent -eq $probe) { break }
        $probe = $parent
    }
    return [ordered]@{
        root  = [System.IO.Path]::GetPathRoot($probe)
        probe = $probe
        full  = $full
    }
}

function Get-DiskInfo {
    param([string]$Path)
    $target = Resolve-VolumeTarget $Path
    if ($null -eq $target) {
        return [ordered]@{ target = $null; volume = $null; filesystem = 'unknown'; freeGb = 0; sizeGb = 0 }
    }
    $root = $target.root
    $freeGb = 0
    $sizeGb = 0
    $filesystem = 'unknown'
    $letter = $root.TrimEnd('\').TrimEnd(':')
    try {
        $volume = Get-Volume -DriveLetter $letter -ErrorAction Stop
        if ($volume.FileSystemType) { $filesystem = "$($volume.FileSystemType)" }
        if ($null -ne $volume.Size) { $sizeGb = [math]::Round(([double]$volume.Size) / $script:GiB, 1) }
        if ($null -ne $volume.SizeRemaining) { $freeGb = [math]::Round(([double]$volume.SizeRemaining) / $script:GiB, 1) }
    } catch {
        try {
            $disk = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DeviceID = '$($root.TrimEnd('\'))'" -ErrorAction Stop
            if ($disk.FileSystem) { $filesystem = "$($disk.FileSystem)" }
            if ($null -ne $disk.Size) { $sizeGb = [math]::Round(([double]$disk.Size) / $script:GiB, 1) }
            if ($null -ne $disk.FreeSpace) { $freeGb = [math]::Round(([double]$disk.FreeSpace) / $script:GiB, 1) }
        } catch {
            Write-Log "  warning: disk space could not be measured: $($_.Exception.Message)" 'Yellow'
        }
    }
    return [ordered]@{
        target     = $Path
        volume     = $root
        filesystem = $filesystem
        freeGb     = $freeGb
        sizeGb     = $sizeGb
    }
}

function Get-FreeSpaceGb {
    param([string]$Root)
    try {
        $disk = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DeviceID = '$($Root.TrimEnd('\'))'" -ErrorAction Stop
        if ($null -eq $disk.FreeSpace) { return -1 }
        return [math]::Round(([double]$disk.FreeSpace) / $script:GiB, 1)
    } catch {
        return -1
    }
}

function Get-VsWherePath {
    $candidates = @(
        (Join-Safe ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'),
        (Join-Safe $env:ProgramFiles 'Microsoft Visual Studio\Installer\vswhere.exe')
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            return $candidate
        }
    }
    return $null
}

function Get-VisualStudioInfo {
    $empty = [ordered]@{
        detected         = $false
        displayName      = $null
        version          = $null
        installationPath = $null
        hasCppTools      = $false
        msvcToolsets     = @()
    }
    $vsWhere = Get-VsWherePath
    if (-not $vsWhere) {
        return $empty
    }
    $displayName = $null
    $version = $null
    $installPath = $null
    $cppVersion = $null
    try {
        $displayName = (& $vsWhere -latest -products * -property displayName 2>$null | Select-Object -First 1)
        $version = (& $vsWhere -latest -products * -property installationVersion 2>$null | Select-Object -First 1)
        $installPath = (& $vsWhere -latest -products * -property installationPath 2>$null | Select-Object -First 1)
        $cppVersion = (& $vsWhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationVersion 2>$null | Select-Object -First 1)
    } catch {
        Write-Log "  warning: vswhere could not be queried: $($_.Exception.Message)" 'Yellow'
    }
    $toolsets = @()
    if ($installPath) {
        $msvcRoot = Join-Path "$installPath".Trim() 'VC\Tools\MSVC'
        if (Test-Path -LiteralPath $msvcRoot) {
            $toolsets = @(Get-ChildItem -LiteralPath $msvcRoot -Directory -ErrorAction SilentlyContinue |
                Select-Object -ExpandProperty Name | Sort-Object)
        }
    }
    $cleanDisplayName = $null
    if ($displayName) { $cleanDisplayName = "$displayName".Trim() }
    $cleanVersion = $null
    if ($version) { $cleanVersion = "$version".Trim() }
    $cleanInstallPath = $null
    if ($installPath) { $cleanInstallPath = "$installPath".Trim() }
    return [ordered]@{
        detected         = [bool]$version
        displayName      = $cleanDisplayName
        version          = $cleanVersion
        installationPath = $cleanInstallPath
        hasCppTools      = [bool]$cppVersion
        msvcToolsets     = $toolsets
    }
}

function Get-WindowsSdkInfo {
    $sdks = @()
    $includeRoot = Join-Safe ${env:ProgramFiles(x86)} 'Windows Kits\10\Include'
    if ($includeRoot -and (Test-Path -LiteralPath $includeRoot)) {
        $sdks = @(Get-ChildItem -LiteralPath $includeRoot -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match '^10\.' } |
            Select-Object -ExpandProperty Name | Sort-Object)
    }
    if ($sdks.Count -eq 0) {
        try {
            $key = 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Microsoft SDKs\Windows\v10.0'
            $properties = Get-ItemProperty -LiteralPath $key -ErrorAction Stop
            $names = @($properties.PSObject.Properties.Name)
            if (($names -contains 'ProductVersion') -and $properties.ProductVersion) {
                $sdks = @("$($properties.ProductVersion)".Trim())
            }
        } catch {
        }
    }
    return $sdks
}

function Get-LongPathState {
    try {
        $value = Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name LongPathsEnabled -ErrorAction Stop
        return [bool]$value.LongPathsEnabled
    } catch {
        return $null
    }
}

function Get-PagefileInfo {
    $files = @()
    $allocatedMb = 0
    $usageMb = 0
    $automatic = $false
    try {
        $system = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop
        if ($null -ne $system.AutomaticManagedPagefile) {
            $automatic = [bool]$system.AutomaticManagedPagefile
        }
    } catch {
        Write-Log "  warning: the managed-pagefile state could not be read: $($_.Exception.Message)" 'Yellow'
    }
    try {
        $entries = @(Get-CimInstance -ClassName Win32_PageFileUsage -ErrorAction Stop)
        foreach ($entry in $entries) {
            if ($entry.Name) { $files += "$($entry.Name)" }
            if ($entry.AllocatedBaseSize) { $allocatedMb += [int]$entry.AllocatedBaseSize }
            if ($entry.CurrentUsage) { $usageMb += [int]$entry.CurrentUsage }
        }
    } catch {
        Write-Log "  warning: pagefile usage could not be read: $($_.Exception.Message)" 'Yellow'
    }
    return [ordered]@{
        configured       = (($files.Count -gt 0) -or $automatic)
        automaticManaged = $automatic
        files            = $files
        allocatedGb      = [math]::Round($allocatedMb / 1024, 1)
        usageMb          = $usageMb
    }
}

function Get-CommandVersion {
    param(
        [string]$Name,
        [string[]]$VersionArguments = @('--version')
    )
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) {
        return $null
    }
    try {
        $arguments = $VersionArguments
        $output = @(& $command.Source @arguments 2>$null)
        if ($output.Count -eq 0) {
            return $null
        }
        return "$($output[0])".Trim()
    } catch {
        return $null
    }
}

function Get-NodePath {
    $command = Get-Command node -ErrorAction SilentlyContinue
    if (-not $command) {
        return $null
    }
    return $command.Source
}

function Get-DepotToolsInfo {
    param([string]$DestPath)
    if ([string]::IsNullOrWhiteSpace($DestPath)) {
        return $null
    }
    $directory = Join-Path $DestPath 'depot_tools'
    if (-not (Test-Path -LiteralPath $directory)) {
        return $null
    }
    $revision = $null
    try {
        $revision = (& git -C $directory rev-parse HEAD 2>$null | Select-Object -First 1)
    } catch {
    }
    $cleanRevision = $null
    if ($revision) { $cleanRevision = "$revision".Trim() }
    return [ordered]@{
        path     = $directory
        revision = $cleanRevision
    }
}

function New-EnvironmentReport {
    param([string]$DestPath)
    $windows = Get-WindowsInfo
    $cpu = Get-CpuInfo
    $memory = Get-MemoryInfo
    $disk = Get-DiskInfo $DestPath
    $visualStudio = Get-VisualStudioInfo
    $sdks = Get-WindowsSdkInfo
    $pagefile = Get-PagefileInfo

    $nodeVersion = Get-CommandVersion 'node'
    $gitVersion = Get-CommandVersion 'git'
    $pythonVersion = Get-CommandVersion 'python'
    $longPaths = Get-LongPathState
    $depotTools = Get-DepotToolsInfo $DestPath

    $visualStudioText = $null
    if ($visualStudio.detected) {
        $visualStudioText = "$($visualStudio.displayName) $($visualStudio.version)".Trim()
        if ($visualStudio.hasCppTools) {
            $visualStudioText = "$visualStudioText (C++ x64 toolchain present)"
        } else {
            $visualStudioText = "$visualStudioText (C++ x64 toolchain MISSING)"
        }
    }

    return [ordered]@{
        generatedAt           = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        host                  = $env:COMPUTERNAME
        dest                  = $DestPath
        lowResourceExperiment = [bool]$LowResourceExperiment
        windows               = $windows
        cpu                   = $cpu
        memory                = $memory
        disk                  = $disk
        tooling               = [ordered]@{
            visualStudio            = $visualStudioText
            visualStudioDisplayName = $visualStudio.displayName
            visualStudioVersion     = $visualStudio.version
            visualStudioPath        = $visualStudio.installationPath
            msvcToolsets            = $visualStudio.msvcToolsets
            windowsSdks             = $sdks
            node                    = $nodeVersion
            git                     = $gitVersion
            python                  = $pythonVersion
            longPathsEnabled        = $longPaths
            depotTools              = $depotTools
        }
        pagefile              = $pagefile
    }
}

function Show-MachineReport {
    param([object]$Report)
    $windows = $Report.windows
    $cpu = $Report.cpu
    $memory = $Report.memory
    $disk = $Report.disk
    $tooling = $Report.tooling
    $pagefile = $Report.pagefile

    $windowsName = $windows.productName
    if (-not $windowsName) { $windowsName = $windows.caption }
    if (-not $windowsName) { $windowsName = 'unknown Windows' }
    if ($windows.displayVersion) {
        $windowsName = "$windowsName $($windows.displayVersion)"
    }
    $build = "$($windows.buildNumber)"
    if ($windows.buildRevision) { $build = "$build.$($windows.buildRevision)" }

    Write-Log ''
    Write-Log 'Machine'
    Write-Log '-------'
    Write-Log ("  windows:        {0} (build {1}, {2})" -f $windowsName, $build, $windows.architecture)
    Write-Log ("  cpu:            {0} - {1} physical / {2} logical core(s)" -f $cpu.model, $cpu.physicalCores, $cpu.logicalCores)
    Write-Log ("  memory:         {0} GB total, {1} GB available" -f $memory.totalGb, $memory.availableGb)
    Write-Log ("  disk:           {0} {1} - {2} GB free of {3} GB" -f $disk.volume, $disk.filesystem, $disk.freeGb, $disk.sizeGb)
    Write-Log ("  destination:    {0}" -f $Report.dest)
    Write-Log ("  visual studio:  {0}" -f $(if ($tooling.visualStudio) { $tooling.visualStudio } else { 'NOT FOUND' }))
    Write-Log ("  msvc toolsets:  {0}" -f $(if ($tooling.msvcToolsets.Count -gt 0) { $tooling.msvcToolsets -join ', ' } else { 'none found' }))
    Write-Log ("  windows sdk:    {0}" -f $(if ($tooling.windowsSdks.Count -gt 0) { $tooling.windowsSdks -join ', ' } else { 'none found' }))
    Write-Log ("  node:           {0}" -f $(if ($tooling.node) { $tooling.node } else { 'NOT FOUND' }))
    Write-Log ("  git:            {0}" -f $(if ($tooling.git) { $tooling.git } else { 'NOT FOUND' }))
    Write-Log ("  python:         {0}" -f $(if ($tooling.python) { $tooling.python } else { 'not on PATH (depot_tools ships its own)' }))
    if ($tooling.longPathsEnabled -eq $true) {
        Write-Log '  long paths:     enabled'
    } elseif ($tooling.longPathsEnabled -eq $false) {
        Write-Log '  long paths:     DISABLED - keep the destination short' 'Yellow'
    } else {
        Write-Log '  long paths:     unknown'
    }
    if ($pagefile.configured) {
        $managed = ''
        if ($pagefile.automaticManaged) { $managed = ' (system managed)' }
        Write-Log ("  pagefile:       {0} GB allocated{1} - reported only, never modified" -f $pagefile.allocatedGb, $managed)
    } else {
        Write-Log '  pagefile:       none configured - a parallel C++ build needs virtual memory' 'Yellow'
    }
    if ($tooling.depotTools) {
        Write-Log ("  depot_tools:    {0} ({1})" -f $tooling.depotTools.path, $tooling.depotTools.revision)
    }
}

# ------------------------------------------------------------- state --------

function Get-CompletedModes {
    param([string]$DestPath, [string]$Profile)
    if (-not (Test-Path -LiteralPath $StateFile)) {
        return @()
    }
    try {
        $state = Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json
        if ($state.dest -ne $DestPath) { return @() }
        if ($state.profile -ne $Profile) { return @() }
        if ($state.completedModes) { return @($state.completedModes) }
    } catch {
        return @()
    }
    return @()
}

function Save-BuildState {
    param(
        [string]$DestPath,
        [string]$Profile,
        [object]$Jobs,
        [string[]]$CompletedModes,
        [string]$AureliaRevision
    )
    $payload = [ordered]@{
        dest            = $DestPath
        profile         = $Profile
        jobs            = $Jobs
        aureliaRevision = $AureliaRevision
        completedModes  = @($CompletedModes)
        updatedAt       = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    }
    Write-Utf8NoBom -Path $StateFile -Text ($payload | ConvertTo-Json -Depth 6)
}

function Get-AureliaRevision {
    try {
        $revision = (& git -C $RepoRoot rev-parse HEAD 2>$null | Select-Object -First 1)
        if (-not $revision) { return '<unknown>' }
        $revision = "$revision".Trim()
        $status = @(& git -C $RepoRoot status --porcelain 2>$null)
        if ($status.Count -gt 0) {
            return "$revision+dirty"
        }
        return $revision
    } catch {
        return '<unknown>'
    }
}

# ------------------------------------------------ monitored execution -------

function Write-NewFileLines {
    param(
        [string]$Path,
        [hashtable]$Offsets,
        [string]$MirrorLog
    )
    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }
    $stream = $null
    try {
        $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        $length = $stream.Length
        $offset = [long]$Offsets[$Path]
        if ($length -le $offset) {
            if ($length -lt $offset) { $Offsets[$Path] = [long]0 }
            return
        }
        $stream.Seek($offset, [System.IO.SeekOrigin]::Begin) | Out-Null
        $buffer = New-Object byte[] ($length - $offset)
        $read = $stream.Read($buffer, 0, $buffer.Length)
        if ($read -le 0) { return }
        $text = [System.Text.Encoding]::UTF8.GetString($buffer, 0, $read)
        $lastNewline = $text.LastIndexOf("`n")
        if ($lastNewline -lt 0) {
            return
        }
        $emit = $text.Substring(0, $lastNewline)
        $consumed = [System.Text.Encoding]::UTF8.GetByteCount($emit) + 1
        $Offsets[$Path] = $offset + $consumed
        foreach ($line in ($emit -split "`r?`n")) {
            if ($line -ne '') {
                Write-Raw $line $MirrorLog
            }
        }
    } catch {
        Write-Log "  warning: could not read $Path`: $($_.Exception.Message)" 'Yellow'
    } finally {
        if ($stream) { $stream.Dispose() }
    }
}

function Invoke-Monitored {
    param(
        [string]$FilePath,
        [string[]]$Arguments = @(),
        [string]$WorkingDirectory = $null,
        [string]$StdOutFile,
        [string]$StdErrFile,
        [string]$MirrorLog,
        [switch]$GuardDisk,
        [string]$VolumeRoot = $null,
        [double]$ReserveGb = 0
    )
    $display = "$FilePath $(Get-ArgumentString $Arguments)"
    Write-Raw "    > $display" $MirrorLog
    $offsets = @{}
    $offsets[$StdOutFile] = [long]0
    $offsets[$StdErrFile] = [long]0
    $process = Start-Process -FilePath $FilePath -ArgumentList (Get-ArgumentString $Arguments) `
        -WorkingDirectory $WorkingDirectory -NoNewWindow -PassThru `
        -RedirectStandardOutput $StdOutFile -RedirectStandardError $StdErrFile
    $lastDiskCheck = [DateTime]::UtcNow
    $diskBreach = $false
    Write-NewFileLines -Path $StdOutFile -Offsets $offsets -MirrorLog $MirrorLog
    Write-NewFileLines -Path $StdErrFile -Offsets $offsets -MirrorLog $MirrorLog
    while (-not $process.HasExited) {
        Start-Sleep -Seconds 2
        Write-NewFileLines -Path $StdOutFile -Offsets $offsets -MirrorLog $MirrorLog
        Write-NewFileLines -Path $StdErrFile -Offsets $offsets -MirrorLog $MirrorLog
        if ($GuardDisk -and ((Get-Date).ToUniversalTime() - $lastDiskCheck).TotalSeconds -ge 30) {
            $lastDiskCheck = (Get-Date).ToUniversalTime()
            $freeGb = Get-FreeSpaceGb $VolumeRoot
            if ($freeGb -ge 0 -and $freeGb -lt $ReserveGb) {
                $diskBreach = $true
                Write-Log ''
                Write-Log "!! free disk on $VolumeRoot fell to $freeGb GB - below the $ReserveGb GB reserve" 'Red'
                Write-Log '!! stopping the build so the machine never fills its disk' 'Red'
                & taskkill /T /F /PID $process.Id 2>&1 | ForEach-Object { Write-Log "   $_" }
                break
            }
        }
    }
    try {
        $process.WaitForExit()
    } catch {
    }
    Start-Sleep -Milliseconds 300
    Write-NewFileLines -Path $StdOutFile -Offsets $offsets -MirrorLog $MirrorLog
    Write-NewFileLines -Path $StdErrFile -Offsets $offsets -MirrorLog $MirrorLog
    $exitCode = $process.ExitCode
    if ($null -eq $exitCode) { $exitCode = 1 }
    if ($diskBreach) {
        $reason = "stopped by the disk guard: free space on $VolumeRoot dropped below the $ReserveGb GB reserve"
        Write-FailureNote $reason
        throw $reason
    }
    if ($exitCode -ne 0) {
        Write-FailureNote "stage command failed with exit code $exitCode`: $display"
        throw "command failed with exit code $exitCode`: $display (see $LastErrorFile)"
    }
    return $exitCode
}

# ---------------------------------------------------------------- gate ------

function Invoke-EnvironmentGate {
    param(
        [string]$EnvironmentPath,
        [bool]$Experiment
    )
    $node = Get-NodePath
    if (-not $node) {
        Write-Log 'error: Node.js was not found on PATH; install Node.js 20+ (22.4+ for the smoke test)' 'Red'
        return 2
    }
    $reportArguments = @($LowResourceTool, '--environment', $EnvironmentPath)
    if ($Experiment) { $reportArguments += '--low-resource-experiment' }
    $report = Invoke-NativeCaptured -FilePath $node -Arguments $reportArguments -LogFile $BootstrapLog
    Write-Log ''
    foreach ($line in ($report.Output -split "`n")) {
        Write-Log $line
    }
    $jsonArguments = $reportArguments + '--json'
    $verdictCapture = Invoke-NativeCaptured -FilePath $node -Arguments $jsonArguments -LogFile $BootstrapLog
    $exitCode = [int]$verdictCapture.ExitCode
    if ($exitCode -ne 0) {
        Write-Log ''
        Write-Log 'The machine does not meet the necessary prerequisites above.' 'Red'
        if (-not $Experiment) {
            Write-Log 'If this is a deliberate attempt on a below-reference machine, re-run with -LowResourceExperiment.' 'Yellow'
        }
        return 2
    }
    $script:Verdict = ($verdictCapture.Output | ConvertFrom-Json)
    return 0
}

# ----------------------------------------------------------- planning -------

function Get-ModeStages {
    param([string]$ModeName)
    $stages = @()
    foreach ($stage in $StageSets[$ModeName]) {
        $stages += $stage
    }
    return $stages
}

function Get-StagedRuntimeDirectory {
    param([string]$DestPath)
    return (Join-Path $DestPath 'artifacts\staged')
}

function Invoke-BuildMode {
    param(
        [string]$ModeName,
        [string]$DestPath,
        [string]$Profile,
        [int]$Jobs,
        [string]$AureliaRevision,
        [string]$VolumeRoot,
        [double]$ReserveGb,
        [switch]$DryRun
    )
    $node = Get-NodePath
    if (-not $node) {
        Write-Log 'error: Node.js was not found on PATH' 'Red'
        return 1
    }
    $stages = Get-ModeStages $ModeName
    $stageList = $stages -join ','
    $stagedDirectory = Get-StagedRuntimeDirectory $DestPath

    if ($ModeName -eq 'SMOKE' -or $ModeName -eq 'PACKAGE') {
        $binary = Join-Path $stagedDirectory 'chrome.exe'
        if (-not (Test-Path -LiteralPath $binary)) {
            Write-Log "error: $binary does not exist - run -Mode BUILD (or -Mode ALL) first" 'Red'
            Write-FailureNote "mode $ModeName needs a built browser at $binary"
            return 1
        }
    }

    $arguments = @(
        $BuildDriver,
        '--dest', $DestPath,
        '--profile', $Profile,
        '--log-dir', $LogDir,
        '--stage', $stagedDirectory,
        '--only', $stageList
    )
    # Only the low-resource profile limits ninja: a reference builder must keep
    # using every core autoninja decides to use.
    if ($Profile -eq 'low-resource' -and $Jobs -gt 0) {
        $arguments += @('--jobs', "$Jobs")
    }
    if ($AureliaRevision -and $AureliaRevision -notlike '<*') {
        $arguments += @('--aurelia-revision', $AureliaRevision)
    }
    if ($DryRun.IsPresent) {
        $arguments += @('--dry-run')
    }

    $longRunning = (-not $DryRun.IsPresent) -and ((Test-StageListContains $stages 'compile') -or (Test-StageListContains $stages 'package'))
    if ($longRunning) {
        $stdOutFile = Join-Path $LogDir 'child.stdout.log'
        $stdErrFile = Join-Path $LogDir 'child.stderr.log'
        Invoke-Monitored -FilePath $node -Arguments $arguments -WorkingDirectory $RepoRoot `
            -StdOutFile $stdOutFile -StdErrFile $stdErrFile -MirrorLog $BuildLog `
            -GuardDisk -VolumeRoot $VolumeRoot -ReserveGb $ReserveGb | Out-Null
    } else {
        Invoke-NativeChecked -FilePath $node -Arguments $arguments -WorkingDirectory $RepoRoot -LogFile $BuildLog | Out-Null
    }
    return 0
}

function Test-StageListContains {
    param([string[]]$Stages, [string]$Stage)
    foreach ($entry in $Stages) {
        if ($entry -eq $Stage) { return $true }
    }
    return $false
}

# ------------------------------------------------------------ cleanup -------

function Get-DirectorySizeGb {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return 0 }
    try {
        $sum = (Get-ChildItem -LiteralPath $Path -Recurse -Force -File -ErrorAction SilentlyContinue |
            Measure-Object -Property Length -Sum).Sum
        if (-not $sum) { return 0 }
        return [math]::Round(([double]$sum) / $script:GiB, 2)
    } catch {
        return 0
    }
}

function Invoke-Cleanup {
    param(
        [string]$DestPath,
        [string]$Target,
        [bool]$AssumeYes
    )
    $targets = @()
    if ($Target -eq 'checkout' -or $Target -eq 'all') {
        if ($DestPath) {
            $targets += (Join-Path $DestPath 'src')
            $targets += (Join-Path $DestPath 'depot_tools')
            $targets += (Join-Path $DestPath '.gclient')
            $targets += (Join-Path $DestPath '.gclient_entries')
            $targets += (Join-Path $DestPath '.gclient_previous_custom_vars')
        }
    }
    if ($Target -eq 'artifacts' -or $Target -eq 'all') {
        if ($DestPath) { $targets += (Join-Path $DestPath 'artifacts') }
    }
    if ($Target -eq 'logs' -or $Target -eq 'all') {
        $targets += $LogDir
    }

    # Guard rails: only ever delete paths that exist, are not a volume root and
    # live under the destination or under the repository's artifacts directory.
    $safePrefixes = @()
    if ($DestPath) { $safePrefixes += ($DestPath.TrimEnd('\') + '\') }
    $safePrefixes += ((Join-Path $RepoRoot 'artifacts').TrimEnd('\') + '\')
    $existing = @()
    foreach ($target in $targets) {
        if (-not (Test-Path -LiteralPath $target)) { continue }
        $full = (Resolve-Path -LiteralPath $target).Path
        $root = [System.IO.Path]::GetPathRoot($full)
        if ($full.TrimEnd('\') -eq $root.TrimEnd('\')) {
            Write-Log "refusing to delete the volume root: $full" 'Red'
            return 1
        }
        $safe = $false
        foreach ($prefix in $safePrefixes) {
            if ($full.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) { $safe = $true }
        }
        if (-not $safe) {
            Write-Log "refusing to delete outside the build destination: $full" 'Red'
            return 1
        }
        $existing += $full
    }

    Write-Log ''
    Write-Log "CLEANUP ($Target) - nothing is ever deleted implicitly" 'Yellow'
    if ($existing.Count -eq 0) {
        Write-Log '  nothing to delete.'
        return 0
    }
    $totalGb = 0
    Write-Log '  this will permanently delete (measuring sizes can take a moment):'
    foreach ($path in $existing) {
        $sizeGb = Get-DirectorySizeGb $path
        $totalGb = $totalGb + $sizeGb
        Write-Log ("    {0}  ({1} GB)" -f $path, $sizeGb)
    }
    Write-Log ("  total: {0} GB" -f [math]::Round($totalGb, 2))
    Write-Log '  the Chromium checkout can be rebuilt by re-running -Mode SYNC'
    Write-Log ''
    if (-not $AssumeYes) {
        $answer = Read-Host 'Type DELETE to confirm'
        if ($answer -ne 'DELETE') {
            Write-Log 'cancelled; nothing was deleted.'
            return 0
        }
    }
    Close-Logs
    foreach ($path in $existing) {
        try {
            Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction Stop
            Write-Host "  deleted $path"
        } catch {
            Write-Host "  could not delete $path`: $($_.Exception.Message)" -ForegroundColor Red
            return 1
        }
    }
    Write-Host ''
    Write-Host 'cleanup complete.'
    return 0
}

# --------------------------------------------------------------- main -------

$exitCode = 0
$startedAt = (Get-Date).ToUniversalTime()

try {
    Write-Log ''
    Write-Log '================================================================'
    Write-Log ' Aurelia Browser (codename) - local Windows build bootstrap'
    Write-Log '================================================================'
    Write-Log "  mode:      $Mode"
    Write-Log "  repository $RepoRoot"
    Write-Log "  logs:      $LogDir"
    Write-Log "  started:   $($startedAt.ToString('yyyy-MM-dd HH:mm:ss')) UTC"

    if ($Mode -eq 'CLEANUP') {
        if ([string]::IsNullOrWhiteSpace($Dest) -and $CleanupTarget -ne 'logs') {
            Write-Log "error: -Dest <directory> is required to clean up the '$CleanupTarget' target" 'Red'
            $exitCode = 2
        } else {
            $exitCode = Invoke-Cleanup -DestPath $Dest -Target $CleanupTarget -AssumeYes $Yes.IsPresent
        }
    } else {
        if ([string]::IsNullOrWhiteSpace($Dest)) {
            Write-Log 'error: -Dest <directory> is required (or set AURELIA_CHROMIUM_DEST)' 'Red'
            Write-FailureNote 'no destination was given'
            $exitCode = 2
        } else {
            $Dest = $Dest.TrimEnd('\')
            $profile = 'dev'
            if ($LowResourceExperiment) { $profile = 'low-resource' }

            # 1. detect + print before anything large happens
            $environment = New-EnvironmentReport -DestPath $Dest
            # Node must be able to parse this file, and its JSON.parse rejects a
            # UTF-8 BOM - which is exactly what Set-Content -Encoding UTF8 writes
            # in Windows PowerShell 5.1. Write the bytes explicitly instead.
            Write-Utf8NoBom -Path $EnvironmentFile -Text ($environment | ConvertTo-Json -Depth 10)
            Show-MachineReport -Report $environment
            Write-Log ''
            Write-Log "environment report: $EnvironmentFile"

            # 2. gate: prerequisites + disk policy + job count
            $gate = Invoke-EnvironmentGate -EnvironmentPath $EnvironmentFile -Experiment $LowResourceExperiment.IsPresent
            if ($gate -ne 0) {
                $exitCode = $gate
            } else {
                $jobs = 0
                if ($null -ne $script:Verdict -and $script:Verdict.jobs) {
                    $jobs = [int]$script:Verdict.jobs
                }
                # Every floor and reserve comes from tools/chromium/low-resource.mjs:
                # the script must not hold a second copy of the policy numbers.
                $reference = $script:Verdict.referenceBuilder
                $reserveGb = 10
                $diskFloorGb = [double]$reference.freeDiskGb
                if ($profile -eq 'low-resource') {
                    $reserveGb = [double]$script:Verdict.disk.reserveGb
                    $diskFloorGb = [double]$script:Verdict.disk.hardMinimumFreeGb
                }
                $volumeRoot = $environment.disk.volume
                $aureliaRevision = Get-AureliaRevision

                if ($profile -eq 'low-resource') {
                    Write-Log ''
                    Write-Log '##################################################################' 'Yellow'
                    Write-Log '#  LOW_RESOURCE_EXPERIMENT - NOT A PRODUCTION BUILDER             #' 'Yellow'
                    Write-Log '#  This machine is below the documented builder minimum           #' 'Yellow'
                    Write-Log '#  (docs/BUILDING-CHROMIUM.md); the build proceeds only because   #' 'Yellow'
                    Write-Log '#  -LowResourceExperiment was given. Expect a multi-hour compile  #' 'Yellow'
                    Write-Log '#  and expect that it may fail. What it produces is a normal      #' 'Yellow'
                    Write-Log '#  development build: the sandbox, site isolation, TLS            #' 'Yellow'
                    Write-Log '#  verification and process isolation are untouched. It is not    #' 'Yellow'
                    Write-Log '#  release material and no runtime performance is claimed for it. #' 'Yellow'
                    Write-Log '##################################################################' 'Yellow'
                    Write-Log ("  documented minimum: {0} logical cores / {1} GB RAM / {2} GB free on one volume" -f $reference.cpuCores, $reference.ramGb, $reference.freeDiskGb)
                    Write-Log ''
                }

                Write-Log 'Plan'
                Write-Log '----'
                Write-Log "  profile:        $profile"
                if ($profile -eq 'low-resource') {
                    Write-Log ("  compile jobs:   {0} (autoninja -j {0}), links serialized by concurrent_links = 1" -f $jobs)
                }
                Write-Log ("  disk guard:     stop if free space on {0} falls below {1} GB (floor: {2} GB free)" -f $volumeRoot, $reserveGb, $diskFloorGb)
                Write-Log "  aurelia commit: $aureliaRevision"
                Write-Log "  modes:          $Mode"
                Write-Log ''

                if ($Mode -eq 'CHECK') {
                    Write-Log 'CHECK complete: nothing was downloaded, compiled or changed.' 'Green'
                } else {
                    $completed = @(Get-CompletedModes -DestPath $Dest -Profile $profile)
                    $modesToRun = @()
                    if ($Mode -eq 'ALL') {
                        foreach ($modeName in $ModeOrder) {
                            if (-not $Force.IsPresent -and ($completed -contains $modeName)) {
                                Write-Log "skipping $modeName (already completed for this destination and profile; use -Force to repeat)"
                            } else {
                                $modesToRun += $modeName
                            }
                        }
                    } else {
                        $modesToRun = @($Mode)
                    }

                    $completedNow = @($completed)
                    foreach ($modeName in $modesToRun) {
                        Write-Log ''
                        Write-Log "=== $modeName ===" 'Cyan'
                        $stages = Get-ModeStages $modeName
                        Write-Log ("  stages: {0}" -f ($stages -join ', '))
                        $result = Invoke-BuildMode -ModeName $modeName -DestPath $Dest -Profile $profile `
                            -Jobs $jobs -AureliaRevision $aureliaRevision -VolumeRoot $volumeRoot -ReserveGb $reserveGb `
                            -DryRun:$DryRun.IsPresent
                        if ($result -ne 0) {
                            $exitCode = $result
                            break
                        }
                        if ($DryRun.IsPresent) {
                            continue
                        }
                        if (-not ($completedNow -contains $modeName)) {
                            $completedNow += $modeName
                        }
                        Save-BuildState -DestPath $Dest -Profile $profile -Jobs $jobs `
                            -CompletedModes $completedNow -AureliaRevision $aureliaRevision
                        Write-Log "$modeName complete" 'Green'
                    }

                    if ($exitCode -eq 0 -and $DryRun.IsPresent) {
                        Write-Log ''
                        Write-Log 'Dry run: nothing was downloaded, compiled or changed.' 'Green'
                    } elseif ($exitCode -eq 0) {
                        Write-Log ''
                        Write-Log 'All requested modes completed.' 'Green'
                        if ($profile -eq 'low-resource') {
                            Write-Log 'Reminder: this is an unsigned, low-resource development build - not a release.' 'Yellow'
                        }
                        $staged = Get-StagedRuntimeDirectory $Dest
                        $artifactDirectory = Join-Path $Dest 'artifacts'
                        if (Test-Path -LiteralPath $staged) {
                            Write-Log "  staged runtime: $staged"
                        }
                        if (Test-Path -LiteralPath $artifactDirectory) {
                            $zips = @(Get-ChildItem -LiteralPath $artifactDirectory -Filter *.zip -File -ErrorAction SilentlyContinue)
                            foreach ($zip in $zips) {
                                Write-Log "  artifact:       $($zip.FullName)"
                            }
                        }
                        Write-Log "  build log:      $BuildLog"
                        Write-Log ''
                        Write-Log 'What this does NOT prove: the build-state ladder still needs the'
                        Write-Log 'smoke-test result (implemented) and a run on a physical supported'
                        Write-Log 'Windows machine before anything is called VERIFIED. See'
                        Write-Log 'docs/PROJECT-STATUS.md and docs/LOCAL-WINDOWS-BUILD.md.'
                    }
                }
            }
        }
    }
} catch {
    Write-Log ''
    Write-Log "FAILED: $($_.Exception.Message)" 'Red'
    Write-Log "See $LastErrorFile and $BuildLog" 'Red'
    if ($exitCode -eq 0) { $exitCode = 1 }
} finally {
    $finishedAt = (Get-Date).ToUniversalTime()
    $elapsed = [math]::Round(($finishedAt - $startedAt).TotalMinutes, 1)
    Write-Log ''
    Write-Log "finished: $($finishedAt.ToString('yyyy-MM-dd HH:mm:ss')) UTC ($elapsed minutes), exit code $exitCode"
    Close-Logs
}

exit $exitCode
