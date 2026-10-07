# Can a GitHub-hosted runner build Aurelia?

The Windows x64 build pipeline runs on a **self-hosted** runner. This document
records why, what evidence the decision rests on, and what would have to change
for the answer to flip. It exists because the owner's instruction was explicit:
do not assume a standard hosted runner can build Chromium, and do not burn CI
quota finding out.

## The requirements being assessed

Taken from `config/chromium_version.json` (`buildRequirements`) and
`docs/BUILDING-CHROMIUM.md`, and enforced at runtime by the capability probe in
`tools/ci/workflows/chromium-heavy-build-windows.yml`:

| Requirement             | Minimum                                                              | Notes                                                                         |
| ----------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Logical cores           | 8                                                                    | compile parallelism, linker memory                                            |
| RAM                     | 32 GB                                                                | linking Chrome is the peak; lower values swap and crawl                       |
| Free disk on one volume | 150 GB                                                               | Chromium source + dependencies + build output; the checkout is **persistent** |
| Toolchain               | Visual Studio C++ x64 (VC.Tools.x86.x64), Windows SDK, Git, Python 3 | probe records what it found in `runner-capabilities.json`                     |
| Node.js                 | 22.4+                                                                | the smoke test uses the global WebSocket                                      |
| Wall clock              | hours, not minutes                                                   | a full sync is itself hours on a cold machine                                 |

These are **documented minimums for the first build**, not measurements. The
first successful heavy build replaces them with measured numbers (the workflow
records CPU, RAM and free disk in the build manifest).

## What a GitHub-hosted runner is

Read from `github.com/actions/runner-images` at commit
`5f7588b285eccc2edbeb1cd79d65ee0b577e4b4a`: the hosted Windows image
(`windows-latest` = Windows Server 2025, image version 20260927.275.1 at that
commit) is a large, preinstalled Visual Studio image. Two properties matter
more than any single number:

1. **It is ephemeral.** Every job starts on a fresh VM. Our pipeline depends on
   a persistent, pinned checkout: `AURELIA_CHROMIUM_DEST` is a directory that
   survives between runs, and `tools/chromium/sync.mjs` verifies `HEAD` equals
   the pinned revision before building. On a hosted runner, every run would
   re-sync tens of gigabytes of Chromium and its dependencies before compiling
   a single file.
2. **Job time and quota.** Hosted jobs have a wall-clock ceiling and consume
   the account's Actions minutes. A build that spends hours re-syncing before
   it can build is precisely the "known to exceed runner resources" attempt the
   owner ruled out.

The exact CPU/RAM/disk figures for hosted runners are published on
`docs.github.com`, which the environment that wrote this assessment could not
reach. Rather than assert numbers that cannot be checked here, the decision
rests on the two properties above: even a generously sized ephemeral runner
does not give a Chromium fork what it needs.

## Verdict

| Option                          | Verdict                                                                                                                                                                                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub-hosted `windows-latest`  | **Not used.** Ephemeral, no persistent checkout, quota-burning; requirements must be re-checked against GitHub's documentation before anyone revisits this.                                                                              |
| Larger hosted runners           | Would address size, **not** persistence or quota. Not attempted.                                                                                                                                                                         |
| Self-hosted Windows x64 builder | **Required.** Labels `[self-hosted, windows, x64, aurelia-chromium]`; the workflow refuses to start on a machine below the minimums, so a misprovisioned runner fails in seconds with a precise message instead of failing in hour five. |

## How the pipeline enforces this

- `runs-on: [self-hosted, windows, x64, aurelia-chromium]` — a hosted runner
  cannot pick the job up. A test asserts the workflow never names a hosted
  label.
- The first step probes cores, RAM, free disk on the volume holding
  `AURELIA_CHROMIUM_DEST`, and the Visual Studio C++ toolchain; it throws with
  a list of what is missing. The probe output is uploaded with the build.
- `sync.mjs` has its own 150 GB preflight and refuses to sync without it.

## Re-checking this assessment

```powershell
# What does the machine actually have?
Get-CimInstance Win32_Processor | Select-Object NumberOfLogicalProcessors
[math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
Get-PSDrive (Get-Item $env:AURELIA_CHROMIUM_DEST).PSDrive.Name

# What does GitHub document for its images?
#   https://docs.github.com/actions/using-github-hosted-runners/about-github-hosted-runners
# What is in the images themselves?
#   https://github.com/actions/runner-images (README + images/windows/*.md)
```

If a hosted option ever provides a persistent volume of 150+ GB attached to a
32 GB machine with hours of budget per run, this document is the place to
record that change - and to say who verified it and when.
