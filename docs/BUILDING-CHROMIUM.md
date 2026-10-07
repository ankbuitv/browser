# Building Aurelia from Chromium sources

This document is the authoritative build guide. It is written to be honest about
one thing up front: **building Chromium is a large operation.** Do not expect a
laptop or a small CI runner to do it.

## Before you start: what "build" means here

| Task                                                  | Needs a Chromium checkout? | Time                 |
| ----------------------------------------------------- | -------------------------- | -------------------- |
| Verify the patch set against the pinned revision      | no (fetches a few files)   | seconds              |
| Run fast CI checks (format, lint, unit tests, policy) | no                         | ~1 minute            |
| Compile a full browser                                | **yes**                    | hours on first build |

If you only want to work on Aurelia's own WebUI/resources, start with
[DEVELOPMENT.md](DEVELOPMENT.md) (harness + fast checks) instead.

## Measured and expected requirements

| Resource  | Minimum                                                                   | Recommended | Notes                                                                                                            |
| --------- | ------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------- |
| CPU cores | 8                                                                         | 16-32       | Ninja parallelises heavily; link steps are memory-bound.                                                         |
| RAM       | 32 GB                                                                     | 64 GB       | A parallel link of `chrome` can exceed 32 GB.                                                                    |
| Free disk | 150 GB                                                                    | 300 GB+     | Source + `depot_tools` + `.git` + `out/` + symbol files. Component builds and incremental rebuilds grow quickly. |
| Network   | HTTPS to `chromium.googlesource.com`, `chrome-infra-packages.appspot.com` | same        | CI environments behind restrictive egress may need proxy configuration.                                          |
| OS        | Windows 10/11 x64 (primary), Linux x64 (builder), macOS 13+ (later)       | -           | Windows ARM64 requires the corresponding GN target and toolchain.                                                |

These numbers are **expectations**, not measurements: nothing in this repository
has been compiled yet. `docs/BUILDING-CHROMIUM.md` must be updated with real
measurements (and `config/chromium_version.json` ->
`buildRequirements.referenceBuilder`) after the first successful build. See the
build-report artifact produced by
`tools/ci/workflows/chromium-heavy-build-windows.yml` (deployed to `.github/workflows/` with `node tools/ci/install-workflows.mjs`, see docs/CI-SECURITY.md).

## One-time setup

### 1. Get the repository

```bash
git clone https://github.com/ankbuitv/browser.git
cd browser
```

### 2. Check the pin

```bash
node tools/chromium/cli.mjs status
```

You should see the pinned Chromium version and revision, the patch set, and the
fork-delta summary.

### 3. Provision `depot_tools`

```bash
git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git
export PATH="$PWD/depot_tools:$PATH"
export DEPOT_TOOLS_UPDATE=0   # never update behind our back
git -C depot_tools rev-parse HEAD
```

Record that SHA so future builds are reproducible:

```bash
node tools/chromium/sync.mjs --record-depot-tools <sha>
```

On Windows: run these commands from a **Developer Command Prompt** (or ensure
`gclient` has a valid Visual Studio environment - Chromium requires MSVC,
`vswhere`, and the Windows 10/11 SDK; `gclient` will report what is missing).

### 4. Sync the pinned checkout

```bash
node tools/chromium/sync.mjs --dest /srv/aurelia-chromium --check-only   # preflight
node tools/chromium/sync.mjs --dest /srv/aurelia-chromium --install      # sync + overlay
```

The script:

1. checks free disk before doing anything destructive;
2. ensures `depot_tools` exists (and checks out the pinned revision if recorded);
3. writes a `.gclient` solution for `chromium/src`;
4. runs `gclient sync --revision src@<pin> --with_branch_heads --with_tags`;
5. **verifies `HEAD` equals the pin** and refuses to continue otherwise;
6. with `--install`, copies the overlay into place and applies the patch set
   with `git apply --check` first.

Never build a tree that this tooling has not produced: an unpinned tree cannot
be reproduced, and an unattributed failure wastes hours.

## Building

On a provisioned builder, one command runs the whole pipeline (the same stages
the heavy-build workflow runs, in the same order):

```bash
node tools/chromium/build.mjs --dest <checkout-parent>          # full pipeline
node tools/chromium/build.mjs --dest <checkout-parent> --dry-run # print the plan
node tools/chromium/build.mjs --dest <checkout-parent> --skip-sync
```

It runs preflight → sync → verify patches → install overlay → fork-delta budget
→ GN argument policy → `gn gen` → `autoninja` → stage → smoke test → record,
and prints which ladder state the run reached. Nothing is skipped silently and
no stage weakens the browser.

The same steps by hand, with the reviewed argument set - do not invent
arguments per machine.

```bash
cd /srv/aurelia-chromium/src

# The arguments live in config/gn/win-x64-dev.gn and are validated against an
# allowlist by tools/chromium/gn-args.mjs before they are used.
gn gen out/Release --args="$(node <repo>/tools/chromium/gn-args.mjs --print <repo>/config/gn/win-x64-dev.gn)"
autoninja -C out/Release chrome
```

Windows x64 - the first target platform - from a shell in the checkout:

```powershell
$env:PATH = "$env:AURELIA_CHROMIUM_DEST\depot_tools;$env:PATH"
$gnArgs = (node "$env:GITHUB_WORKSPACE\tools\chromium\gn-args.mjs" --print "$env:GITHUB_WORKSPACE\config\gn\win-x64-dev.gn")
gn gen out\Release "--args=$gnArgs"
autoninja -C out\Release chrome
```

Notes:

- `config/gn/win-x64-dev.gn` is a **development Release** configuration:
  `is_debug=false`, `is_component_build=true`, `symbol_level=1`. Every key was
  verified to exist at the pinned Chromium revision, and the allowlist rejects
  anything unknown, any instrumented build, and any security-relevant switch.
- An official build (`is_official_build=true`) needs Google's toolchain, PGO
  profiles and signing. It is not enabled here and must be a deliberate change.
- Nothing in the configuration disables the sandbox, site isolation,
  certificate validation or process isolation. Chromium does not expose
  supported GN switches for those; they can only be weakened at runtime, which
  the smoke test records explicitly.

## Build state ladder (never collapse these)

A step in this ladder is only earned by the evidence named next to it. A
workflow step name is not evidence; its output is.

| State                       | Earned when                                             |
| --------------------------- | ------------------------------------------------------- |
| INTEGRATION SOURCE VERIFIED | the patch set applies to the pristine pinned checkout   |
| CONFIGURATION VERIFIED      | `gn gen` completes                                      |
| COMPILED                    | `autoninja chrome` completes                            |
| RUNTIME INTEGRATED          | the browser process launches                            |
| TESTED                      | the smoke test passes on the packaged staging directory |
| VERIFIED                    | a physical, supported Windows machine runs the artifact |

## Stage, verify and package the artifact

```bash
# 1. Stage the complete runtime directory (fails if the browser cannot start).
node tools/chromium/stage-runtime.mjs \
  --out <checkout>/out/Release \
  --dest <artifacts>/staged \
  --aurelia-revision "$(git rev-parse HEAD)" \
  --gn-args <checkout>/out/Release/args.gn

# 2. Smoke test the staged browser - the artifact that will be shipped, not the
#    raw build directory.
node tools/chromium/smoke-test.mjs --binary <artifacts>/staged/chrome.exe \
  --report <artifacts>/smoke-test.json

# 3. Record the result in the manifest, then zip the staged directory.
node tools/chromium/stage-runtime.mjs --dest <artifacts>/staged \
  --record-smoke-test <artifacts>/smoke-test.json
```

The artifact is named `aurelia-windows-x64-dev-<aurelia-short-sha>-UNSIGNED.zip`
and contains the complete browser directory plus `build-manifest.json` and
`SHA256SUMS.txt`. `signed` and `productionReady` are both `false`: SmartScreen
will warn about it, and that warning is never bypassed. The manifest records the
Aurelia revision, Chromium version and revision, patch-set version, pinned
`depot_tools` revision, OS, architecture, GN arguments, configuration, build
timestamp, signing state and smoke-test state.

## Runtime compatibility targets (not builders)

The owner has two low-end Windows machines for runtime and compatibility
testing. They are explicitly **not** Chromium builders:

| Target          | Hardware                                                  | Purpose                                                                 |
| --------------- | --------------------------------------------------------- | ----------------------------------------------------------------------- |
| `WIN10_LOW_END` | Intel i3 (4th generation), 8 GB RAM                       | does the artifact start, navigate and stay responsive on a slow machine |
| `WIN10_LEGACY`  | ThinkPad T530, Intel 3rd-generation mobile CPU, ~6 GB RAM | older-driver and low-memory behaviour                                   |

Results from these machines are what promote a build from TESTED to VERIFIED,
and they are run by the owner after the artifact is published - never as part of
the build job.

## Verify what you built

```bash
node tools/chromium/smoke-test.mjs --binary /srv/aurelia-chromium/src/out/Aurelia/chrome
```

The smoke test launches the binary, opens `chrome://aurelia` through the
DevTools Protocol and asserts that:

- the page renders (`<aurelia-app>`, status cards);
- both stylesheets load from the browser's own resource pak;
- the page reports the pinned Chromium revision;
- the binary's reported version matches the pin.

It does **not** prove that every feature works. It proves the integration
exists. Feature-level tests live in `tests/` and `docs/TESTING.md`.

## Where the outputs never go

- Build outputs are never committed (`.gitignore`: `out/`, `artifacts/`).
- Chromium sources are never committed (`chromium/`, `chromium-src/`).
- Signing material is never committed (`.github/workflows/*` never reference
  secrets in `pull_request` events; see `docs/CI-SECURITY.md`).

## Common problems

| Symptom                                               | Cause                                                                           | Fix                                                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `checkout is at <sha> but the pinned revision is ...` | tree drifted (manual `git checkout`, or a previous partial run)                 | re-run `tools/chromium/sync.mjs --dest <dir>`                                                                    |
| `patch 0001-... does not apply`                       | upstream file moved, or the tree is not at the pin                              | verify `HEAD`; if it is at the pin, regenerate the patch (`generate-patch`) and open an issue - the anchor moved |
| `refusing to overwrite local changes in: ...`         | the overlay was edited inside the checkout rather than in this repository       | re-clone, or copy changes back into `chromium/overlay/` first                                                    |
| GN error about a missing target                       | the overlay was not installed, or you are building a target other than `chrome` | run `install-overlay.mjs`; build `chrome`                                                                        |
| Out-of-memory during link                             | too many parallel links                                                         | `-j` lower, or reduce `symbol_level`                                                                             |

## Continuous integration

- Fast checks (no checkout): `.github/workflows/ci-fast.yml`.
- Heavy build (self-hosted runner, nightly + manual):
  `tools/ci/workflows/chromium-heavy-build-windows.yml`. The runner label set is
  `[self-hosted, linux, x64, aurelia-chromium]`, and the persistent checkout
  directory is the repository variable `AURELIA_CHROMIUM_DEST`.
- CI security model: `docs/CI-SECURITY.md`.

GitHub-hosted runners cannot build Chromium: disk and time limits make it
fail predictably, which is why this repository deliberately does not try.
