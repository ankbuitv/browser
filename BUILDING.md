# Building Aurelia Browser

This is the short version. The authoritative, detailed guide is
**[docs/BUILDING-CHROMIUM.md](docs/BUILDING-CHROMIUM.md)**.

> **Reality check:** building the browser requires a machine with roughly
> **8+ CPU cores, 32 GB RAM and 150 GB free disk**. It cannot be done on a
> laptop with limited space, in a small container, or on a GitHub-hosted CI
> runner. That is why this repository separates _fast checks_ (seconds) from the
> _heavy build_ (hours, self-hosted).

## 1. Working on Aurelia's own code (no Chromium needed)

```bash
git clone https://github.com/ankbuitv/browser.git
cd browser
npm ci

npm test                          # unit tests
node tools/ci/fast-checks.mjs     # repository invariants
node tools/chromium/cli.mjs status
node tools/chromium/cli.mjs verify-patches --online   # the delta still applies
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the full set of commands,
including the UI development harness.

## 2. Building the browser

### Prerequisites

| Requirement      | Detail                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| OS               | Windows 10/11 x64 (primary), Linux x64 (builder)                                                          |
| CPU / RAM / disk | 8+ cores / 32 GB / 150 GB free (300 GB+ recommended)                                                      |
| Toolchain        | `depot_tools`, GN, Ninja (`autoninja`), and on Windows: Visual Studio with the C++ workload + Windows SDK |
| Node.js          | Only for repository tooling — never a browser runtime dependency                                          |

### Steps

```bash
# 1. get the pinned checkout + install Aurelia's overlay and patch
node tools/chromium/sync.mjs --dest /srv/aurelia-chromium --check-only
node tools/chromium/sync.mjs --dest /srv/aurelia-chromium --install

# 2. configure and build
cd /srv/aurelia-chromium/src
gn gen out/Aurelia --args='is_component_build=true symbol_level=1'
autoninja -C out/Aurelia -j"$(nproc)" chrome

# 3. verify what you built
node <repo>/tools/chromium/smoke-test.mjs --binary out/Aurelia/chrome
```

`is_component_build=true` is fast but **not** a release build. Release-style
builds use `is_official_build=true is_component_build=false`.

### The pin is not optional

The tree must be at the exact revision in `config/chromium_version.json`.
`sync.mjs` verifies `HEAD` and refuses to continue otherwise; `install-overlay.mjs`
refuses to overwrite local edits. Never build an unpinned tree — it cannot be
reproduced, and a failure then proves nothing.

## 3. Unsigned builds

There is no code-signing certificate yet. Any build you produce is **unsigned**
and will trigger operating-system warnings. Label it accordingly, do not
redistribute it as a release, and never instruct users to bypass SmartScreen. See
[docs/RELEASE.md](docs/RELEASE.md).

## 4. Troubleshooting

| Symptom                                             | Fix                                                                                            |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `checkout is at ... but the pinned revision is ...` | re-run `sync.mjs --dest <dir>`                                                                 |
| `patch ... does not apply`                          | confirm `HEAD` is the pin; if it is, the anchor moved — regenerate the patch and open an issue |
| `refusing to overwrite local changes in ...`        | move your edits into `chromium/overlay/` in this repository first                              |
| GN error about a missing target                     | overlay not installed, or you are building a target other than `chrome`                        |
| Link step runs out of memory                        | lower `-j`, or reduce `symbol_level`                                                           |

Full troubleshooting table: [docs/BUILDING-CHROMIUM.md](docs/BUILDING-CHROMIUM.md#common-problems).
