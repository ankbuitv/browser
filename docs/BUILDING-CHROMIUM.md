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
`.github/workflows/chromium-heavy-build.yml`.

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

```bash
cd /srv/aurelia-chromium/src

# Developer build: faster to link, good enough to run Aurelia.
gn gen out/Aurelia --args='is_component_build=true symbol_level=1'

# Optimised build: slower, closer to a release.
gn gen out/Aurelia --args='is_official_build=true is_component_build=false symbol_level=0 blink_symbol_level=0'

autoninja -C out/Aurelia -j"$(nproc)" chrome
```

Notes:

- `is_component_build=true` links much faster but is **not** a release build and
  must never be published as one.
- Do not pass `is_debug=true` unless you need a debugger; it multiplies both
  build time and disk usage.
- Windows: the output binary is `out/Aurelia/chrome.exe`. Linux: `out/Aurelia/chrome`.

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
  `.github/workflows/chromium-heavy-build.yml`. The runner label set is
  `[self-hosted, linux, x64, aurelia-chromium]`, and the persistent checkout
  directory is the repository variable `AURELIA_CHROMIUM_DEST`.
- CI security model: `docs/CI-SECURITY.md`.

GitHub-hosted runners cannot build Chromium: disk and time limits make it
fail predictably, which is why this repository deliberately does not try.
