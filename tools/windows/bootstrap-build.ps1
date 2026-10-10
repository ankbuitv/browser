#Requires -Version 5.1
<#
.SYNOPSIS
    Retired local Chromium build bootstrap.

.DESCRIPTION
    Chromium compilation is now allowed only through the manual
    .github/workflows/chromium-build.yml workflow on GitHub-hosted Windows x64
    runners. This compatibility entry point performs no preflight, source sync,
    checkout, build, cleanup, or artifact operation; it prints the replacement
    workflow and exits with a failure status.

    The former low-resource local-build experiment is not supported. Runner
    resource requirements are documented in docs/CI-BUILD-FEASIBILITY.md.

.PARAMETER Mode
    Accepted for compatibility with existing invocations; no mode is executed.

.PARAMETER Dest
    Accepted for compatibility with existing invocations; the path is untouched.

.EXAMPLE
    powershell -File tools\windows\bootstrap-build.ps1
    # Prints the retirement notice. Dispatch chromium-build.yml in GitHub Actions.
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

Write-Host 'The local Windows Chromium build path is retired.'
Write-Host 'No Chromium source is synced and no compiler is invoked.'
Write-Host 'Use .github/workflows/chromium-build.yml on a GitHub-hosted runner.'
exit 1
