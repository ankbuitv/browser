# Local Windows build (`LOW_RESOURCE_EXPERIMENT`)

The documented builder minimum in [BUILDING-CHROMIUM.md](BUILDING-CHROMIUM.md) is
**8+ cores / 32 GB RAM / 150 GB free** on one volume. That is not lowered here.

This page documents a second, explicitly experimental path: building a real
Aurelia development browser on a machine that is _below_ that minimum - for
example an Intel i3 with 4 logical cores, 8 GB RAM and about 110 GB free. It
exists because the first Windows x64 build has to happen somewhere before a
provisioned builder is available, and because that attempt should be
reproducible, resumable and honest about its limits.

> **Status.** The scripts exist, are structurally checked in CI, and every
> command they run has an equivalent in the documented pipeline. **They have not
> been executed on Windows yet.** Nothing on this page is a measurement, and no
> performance claim is made. The build-state ladder in
> [PROJECT-STATUS.md](PROJECT-STATUS.md) stays in force: a low-resource run that
> finishes earns the states it earns and nothing more.

## Contents

- [When to use this path](#when-to-use-this-path)
- [Prerequisites](#prerequisites)
- [Disk policy (hard requirement)](#disk-policy-hard-requirement)
- [Quick start](#quick-start)
- [The pipeline](#the-pipeline)
- [The low-resource GN profile](#the-low-resource-gn-profile)
- [Compile jobs](#compile-jobs)
- [Pagefile (reported, never modified)](#pagefile-reported-never-modified)
- [Logs, state and resume](#logs-state-and-resume)
- [Cleanup](#cleanup)
- [Troubleshooting](#troubleshooting)
- [The artifact](#the-artifact)
- [What is not proven](#what-is-not-proven)

## When to use this path

Use it when all of the following are true:

- you want to know whether the pinned revision still builds and whether
  `chrome://aurelia` comes up, on a machine you control;
- the machine falls short of the builder minimum in RAM or CPU;
- the machine has enough disk for the checkout plus its build output, with a
  reserve you are not willing to give up.

Do **not** use it to produce anything you intend to distribute. The artifact is
an unsigned development build, and the low-resource profile trades build time
and debuggability - not security properties - for a smaller footprint.

## Prerequisites

`tools\windows\bootstrap-build.ps1 -Mode CHECK` prints every one of these before
anything large is downloaded.

| Requirement   | Minimum                                                                                                                          | Why                                                                          | Checked by                                    |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------- |
| Windows       | Windows 10 build 10240 or newer, 64-bit (Windows 11 included)                                                                    | Chromium's supported Windows baseline                                        | `windows.buildNumber`, `windows.architecture` |
| Logical cores | 2                                                                                                                                | At least one compile job and one link at a time                              | `cpu.logicalCores`                            |
| RAM           | 6 GB absolute floor (8 GB is the practical minimum)                                                                              | `cl.exe` needs 1-2 GB per job; the linker needs more                         | `memory.totalGb`                              |
| Free disk     | **100 GB** in experiment mode (150 GB normally)                                                                                  | See [disk policy](#disk-policy-hard-requirement)                             | `disk.freeGb`, `disk.filesystem`              |
| Filesystem    | NTFS                                                                                                                             | Long paths and hard links; exFAT/FAT32 cannot host a Chromium checkout       | `disk.filesystem`                             |
| Visual Studio | VS 2022 Build Tools or IDE with **Desktop development with C++** (component `Microsoft.VisualStudio.Component.VC.Tools.x86.x64`) | The MSVC toolchain and Windows SDK integration                               | `vswhere.exe`, `tooling.msvcToolsets`         |
| Windows SDK   | A 10.x SDK under `%ProgramFiles(x86)%\Windows Kits\10`                                                                           | Compiler headers and libraries                                               | `tooling.windowsSdks`                         |
| Git           | Any current Git for Windows (2.35+)                                                                                              | `depot_tools`, the pin, and patch verification                               | `tooling.git`                                 |
| Node.js       | 20+ (22.4+ for the smoke test)                                                                                                   | The repository's tooling is Node; the smoke test uses the global `WebSocket` | `tooling.node`                                |
| Python        | Not required; `depot_tools` bootstraps its own                                                                                   | Some Chromium scripts use Python                                             | `tooling.python`                              |

The script never installs anything, never edits the registry and never changes
system settings. If something is missing it prints what and stops.

## Disk policy (hard requirement)

Disk space is the one resource the experiment cannot trade away, and filling a
person's system drive is not an acceptable outcome. The policy is enforced
before the sync and again by a guard while the build runs.

| Mode                                                | Hard floor (free) | Estimated footprint | Reserve never consumed |
| --------------------------------------------------- | ----------------- | ------------------- | ---------------------- |
| Documented builder (`-Dest` run without the switch) | 150 GB            | -                   | -                      |
| `-LowResourceExperiment`                            | 100 GB            | about 85 GB         | 15 GB                  |

Where the space goes in experiment mode: the Chromium checkout with
`--with_branch_heads --with_tags` is large (tens of GB), `out\Release` for a
component build with `symbol_level = 0` is tens of GB more, and Ninja's
temporary files add more on top. The estimate is deliberately conservative.

Two mechanisms keep the promise:

1. **Before anything large**: the environment gate refuses to start when free
   space is below the floor, and prints the exact numbers it measured.
2. **During the build**: a guard samples free space every 30 seconds and, if it
   falls below the reserve, kills the build process tree, writes
   `artifacts\local-build\last-error.txt` and stops. The build is expected to
   fail loudly rather than fill the disk.

The reserve exists because Windows itself needs room to work: a completely full
system volume is a broken machine, not a failed build.

## Quick start

Run these from an **elevated or normal** PowerShell (elevation is not required
for the build; only if you choose to move the pagefile yourself). Use a short
destination such as `D:\aeb` unless long-path support is enabled.

```powershell
# 1. Look before you leap: machine report + prerequisite verdict. Downloads nothing.
powershell -ExecutionPolicy Bypass -File tools\windows\bootstrap-build.ps1 `
    -Dest D:\aeb -Mode CHECK

# 2. Same, with the experiment switch: RAM/CPU shortfalls become warnings.
powershell -ExecutionPolicy Bypass -File tools\windows\bootstrap-build.ps1 `
    -Dest D:\aeb -LowResourceExperiment -Mode CHECK

# 3. The whole thing: sync, verify, build, smoke test, package.
powershell -ExecutionPolicy Bypass -File tools\windows\bootstrap-build.ps1 `
    -Dest D:\aeb -LowResourceExperiment
```

The destination can also be set once for the session, which is what the
CI workflow uses:

```powershell
$env:AURELIA_CHROMIUM_DEST = 'D:\aeb'
```

Individual modes, for resuming or for keeping each step small:

```powershell
# Pin + depot_tools + gclient sync + verify HEAD (hours, mostly download)
... -Mode SYNC -LowResourceExperiment
# Patch set against the pristine checkout + fork-delta budget (minutes)
... -Mode VERIFY -LowResourceExperiment
# Overlay + patches + gn gen + autoninja chrome + stage (many hours)
... -Mode BUILD -LowResourceExperiment
# Launch chrome://aurelia, check the pin, verify a clean exit
... -Mode SMOKE -LowResourceExperiment
# Zip the staged directory + SHA-256 sidecar
... -Mode PACKAGE -LowResourceExperiment
```

## The pipeline

Every mode calls `tools/chromium/build.mjs`, which runs the same stages in the
same order as the self-hosted heavy-build workflow. There is no second
implementation of the pipeline for the low-resource path.

| Stage             | What it does                                                                      | Log                   |
| ----------------- | --------------------------------------------------------------------------------- | --------------------- |
| `preflight`       | Disk floor (100 GB in experiment mode) and toolchain sanity                       | `build.log`           |
| `sync`            | Pinned `depot_tools`, `.gclient`, `gclient sync --revision src@<pin>`, HEAD check | `sync.log`            |
| `verify-patches`  | The 6-file patch set applies cleanly to the pristine checkout                     | `verify-patches.log`  |
| `install-overlay` | Copies `chromium/overlay/` and applies the patch series                           | `install-overlay.log` |
| `fork-delta`      | Fails if the reviewed delta budget is exceeded                                    | `build.log`           |
| `gn-args`         | Every GN key/value must pass the allowlist in `gn-args.mjs`                       | `build.log`           |
| `gn-gen`          | `gn gen out\Release --args=<reviewed arguments>`                                  | `gn.log`              |
| `compile`         | `autoninja -C out\Release -j N chrome`                                            | `autoninja.log`       |
| `stage`           | Copies the complete runtime directory (never only `chrome.exe`)                   | `build.log`           |
| `smoke-test`      | Launches the staged browser, opens `chrome://aurelia`, checks the pin             | `smoke-test.log`      |
| `record`          | Writes the smoke-test result into `build-manifest.json`                           | `build.log`           |
| `package`         | `aurelia-windows-x64-dev-<sha>-UNSIGNED.zip` plus `.sha256`                       | `package.log`         |

## The low-resource GN profile

The two GN files differ in exactly two arguments, both about build cost:

| Argument           | Dev profile (`win-x64-dev.gn`) | Low-resource profile (`win-x64-low-resource.gn`) | Effect                                               |
| ------------------ | ------------------------------ | ------------------------------------------------ | ---------------------------------------------------- |
| `symbol_level`     | 1                              | 0                                                | Much smaller object files, no source-level debugging |
| `concurrent_links` | automatic (upstream decides)   | 1                                                | One link at a time; the link step is the RAM peak    |

The third lever is not a GN argument at all: the compile job count (`-j 1` / `-j 2`,
computed from measured RAM) is passed to `autoninja`, which accepts `-j N` as a
supported flag.

Everything else is identical, and the policy is enforced rather than trusted:
`tools/chromium/gn-args.mjs` validates both files against an allowlist, rejects
unknown keys, instrumented builds, and anything resembling a
security-weakening switch.

**Neither profile disables the sandbox, site isolation, certificate validation
or process isolation, and Chromium has no supported GN switch to do so.** Those
can only be weakened at runtime; the smoke test records any such flag as a
weakened run instead of accepting it silently. `-j 1` makes a build slow. It
does not make the browser different.

## Compile jobs

`tools/chromium/low-resource.mjs` computes the job count from the measured
machine, and the bootstrap script passes it to `autoninja` as a supported flag
(`-j N`). Nothing is guessed:

| Measured RAM | Compile jobs                |
| ------------ | --------------------------- |
| below 6 GB   | refused (no safe job count) |
| 6-8 GB       | 1                           |
| 8-15 GB      | 2                           |
| 16-23 GB     | 3                           |
| 24 GB+       | 4                           |

The result is capped at half the logical core count, so a 2-core machine is
never asked to context-switch through more compilers than it has cores. Links
are serialized independently by `concurrent_links = 1`.

If you want to know what the tool would decide before running anything:

```powershell
node tools\chromium\low-resource.mjs --environment artifacts\local-build\environment.json `
    --low-resource-experiment
```

## Pagefile (reported, never modified)

A 32 GB link step on an 8 GB machine will lean on virtual memory, so the report
includes the pagefile and the verdict warns when it is small. **The script never
changes it** - a build tool has no business editing system settings.

If you decide to change it yourself: _System Properties_ → _Advanced_ →
_Performance_ → _Settings_ → _Advanced_ → _Virtual memory_ → _Change_. Either
leave it system-managed (Windows sizes it from RAM and disk) or, for a build
machine, set a fixed size of at least the RAM size with room to grow - a fixed
8-16 GB pagefile on an 8 GB machine is a reasonable starting point. A reboot is
required. Guidance only: measure your own disk first, and remember that the
pagefile lives on a volume and competes with the checkout for space.

## Logs, state and resume

Everything lands in `artifacts\local-build\`:

| File               | Contents                                                      |
| ------------------ | ------------------------------------------------------------- |
| `bootstrap.log`    | What the bootstrap script did, including the machine report   |
| `environment.json` | The machine report, machine-readable (no BOM)                 |
| `build.log`        | Stage banners, commands and every tool's output               |
| `gn.log`           | The `gn gen` stage                                            |
| `sync.log`         | The `gclient sync` stage                                      |
| `last-error.txt`   | The failing stage, the exact command, the exit code, the time |
| `state.json`       | Which modes completed for this destination and profile        |

Resume is per mode. `-Mode ALL` skips a mode whose checkpoint is already
recorded for the same destination _and profile_, and says so. `-Force` repeats it
anyway. If a mode fails, fix the cause and re-run the same mode: the checkout is
never deleted, and `ninja` continues from the objects that already exist.

A failed compile can be re-run without re-syncing:

```powershell
... -Mode BUILD -LowResourceExperiment
```

## Cleanup

Nothing is deleted implicitly, ever - not on failure, not on re-run. Deletion is
its own mode and asks for confirmation:

```powershell
# Show what would be deleted and how large it is, then ask
... -Mode CLEANUP -CleanupTarget checkout

# Non-interactive (for a scripted machine)
... -Mode CLEANUP -CleanupTarget all -Yes
```

Targets: `checkout` (`src`, `depot_tools`, `.gclient*` under `-Dest`),
`artifacts` (`-Dest\artifacts`), `logs` (`artifacts\local-build`) and `all`. The
script refuses to delete a volume root or anything outside the destination and
the repository's own `artifacts\` directory.

## Troubleshooting

| Symptom                                                      | Cause                                                              | Fix                                                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `Visual Studio with the C++ x64 toolchain ... was not found` | VS installed without the **Desktop development with C++** workload | VS Installer → Modify → add that workload; re-run `-Mode CHECK`                                   |
| `no Windows 10/11 SDK found`                                 | SDK component missing                                              | VS Installer → Individual components → a Windows 10/11 SDK                                        |
| `the checkout volume is exFAT, not NTFS`                     | Destination volume is not NTFS                                     | Move the destination to an NTFS volume (Chromium needs long paths and hard links)                 |
| `free disk at D:\aeb: 92 GB is below 100 GB`                 | Experiment floor                                                   | Free space, or use a different volume; the floor is not lowered                                   |
| `stopped by the disk guard`                                  | Free space fell below the 15 GB reserve during the build           | Free space and re-run `-Mode BUILD`; Ninja continues from existing objects                        |
| `Ninja ... out of memory` / `cl.exe` killed                  | Too many parallel compilers for the RAM                            | Re-run with fewer jobs, or use the low-resource profile (`-LowResourceExperiment` defaults to it) |
| `autoninja is not recognized`                                | `depot_tools` is not on `PATH`                                     | `-Mode SYNC` installs it; the bootstrap script prepends it for its own runs                       |
| `gclient.bat` fails in a terminal                            | `depot_tools` not initialised (`.gclient` missing)                 | Run `-Mode SYNC` first                                                                            |
| `smoke test` cannot start the browser                        | Missing a runtime file, antivirus interference, or a broken build  | Read `artifacts\local-build\smoke-test.log`; the staged directory must contain `chrome.exe`       |
| Path too long errors                                         | Long paths disabled and a deep destination                         | Use `D:\aeb`-style short paths, or enable `LongPathsEnabled` and reboot                           |

## The artifact

`-Mode PACKAGE` produces, next to `-Dest\artifacts\staged`:

```
aurelia-windows-x64-dev-<short-aurelia-sha>-UNSIGNED.zip
aurelia-windows-x64-dev-<short-aurelia-sha>-UNSIGNED.zip.sha256
```

The zip contains the complete runtime directory (`chrome.exe`, the DLL set, the
`.pak` files, `locales\`, `icudtl.dat`, the manifest and `SHA256SUMS.txt`) - never
only `chrome.exe`. `build-manifest.json` records `signed=false` and
`productionReady=false`, the exact Chromium revision, the patch-set version, the
GN arguments and the smoke-test result.

This is a development build. It is not signed, Windows SmartScreen will warn
about it, and those warnings must not be bypassed or silenced - they are
correct.

## What is not proven

Recorded here so that nobody has to guess:

| Claim                                                         | State                                                                                   |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| The bootstrap script is syntactically valid PowerShell        | Checked (parser run during development; structural lint runs in CI)                     |
| The script runs correctly on Windows                          | **Not verified** - no Windows machine has run it yet                                    |
| The pinned Chromium revision syncs and builds on this machine | **Not verified** - first attempt still to be made                                       |
| The low-resource profile produces a working browser           | **Not verified** - depends on the build                                                 |
| The build behaves acceptably on low-end hardware at runtime   | **Not verified** - and no claim is made: a successful build is not a performance result |

After a completed run, record what actually happened - measured time, peak
disk, peak memory, and any failure - in this page and in
[PROJECT-STATUS.md](PROJECT-STATUS.md). The builder minimum in
[BUILDING-CHROMIUM.md](BUILDING-CHROMIUM.md) stays as it is until a real build
on a provisioned machine says otherwise; this page is not evidence that the
minimum can be lowered.

What _is_ checked automatically - the machine report format, the disk and
prerequisite policy, the compile-job arithmetic, the GN argument allowlist and
the structural quality of this script - is listed in
[TESTING.md](TESTING.md). That suite runs on every pull request; it cannot, and
does not claim to, run the build.
