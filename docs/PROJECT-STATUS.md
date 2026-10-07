# Project status

**Aurelia Browser is in early development and is not ready for daily use.**
There is currently no released binary. Nothing in this repository has been
compiled into a browser yet.

This document defines the status vocabulary and states, item by item, what is
actually true today.

## Status vocabulary

| State           | Meaning                                                                 | What must exist to claim it     |
| --------------- | ----------------------------------------------------------------------- | ------------------------------- |
| **NOT STARTED** | No work.                                                                | -                               |
| **SCAFFOLDED**  | Files, interfaces or structure exist, but the feature does not operate. | code review                     |
| **IMPLEMENTED** | The feature logic exists and is exercised by unit tests.                | unit tests pass                 |
| **INTEGRATED**  | The feature operates inside its intended Chromium integration.          | build + runtime evidence        |
| **TESTED**      | Automated or manual tests have passed.                                  | test output attached            |
| **VERIFIED**    | Tested on a real supported target build.                                | evidence on a released artifact |

A browser feature may never be called complete at SCAFFOLDED or IMPLEMENTED.
The distinction exists because "the code is written" is not "the browser works".

For the build itself the ladder is finer and is never collapsed: the patch
applying to the pinned tree is INTEGRATION SOURCE VERIFIED, a successful
`gn gen` is CONFIGURATION VERIFIED, a successful `autoninja` is COMPILED, a
browser process that launches is RUNTIME INTEGRATED, a passing smoke test is
TESTED, and only a physical supported Windows machine can make it VERIFIED
([BUILDING-CHROMIUM.md](BUILDING-CHROMIUM.md)).

## Current state (2026-10-07)

| Area                                      | State       | Evidence / gap                                                                                                                                            |
| ----------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository audit                          | TESTED      | [REPOSITORY-AUDIT.md](REPOSITORY-AUDIT.md)                                                                                                                |
| Chromium pin (exact revision)             | TESTED      | `155.0.8059.40` / `cfaadc5a…` confirmed stable via chromiumdash + `chrome/VERSION` at the revision; digests recorded; `depot_tools` pinned to `1e43ae34…` |
| Patch/overlay mechanism                   | TESTED      | `verify-patches --online` fetches the pinned pre-images, applies the patch, and matches post-image digests                                                |
| GN wiring strategy                        | SCAFFOLDED  | follows upstream `webui_gallery`; **not compiled**                                                                                                        |
| Reproducible checkout (`sync.mjs`)        | IMPLEMENTED | never executed against a real Chromium checkout                                                                                                           |
| Local build driver (`build.mjs`)          | SCAFFOLDED  | dry-run plan tested; never executed against a real checkout                                                                                               |
| Windows x64 heavy build workflow          | IMPLEMENTED | authored end-to-end (probe, sync, patches, `gn gen`, build, stage, smoke test, package); never executed; a self-hosted Windows builder does not exist yet |
| `chrome://aurelia` WebUI (C++)            | SCAFFOLDED  | code written, **not compiled**                                                                                                                            |
| Aurelia WebUI resources (TS/CSS)          | SCAFFOLDED  | code written, **not compiled, never rendered**                                                                                                            |
| Design tokens pipeline                    | TESTED      | generator + freshness checks in CI                                                                                                                        |
| Omnibox classification policy             | IMPLEMENTED | 31 unit tests                                                                                                                                             |
| Secure DNS policy                         | IMPLEMENTED | 19 unit tests                                                                                                                                             |
| Tracking-parameter stripping              | IMPLEMENTED | 23 unit tests                                                                                                                                             |
| Preference schema and invariants          | IMPLEMENTED | 33 unit tests                                                                                                                                             |
| Fast CI                                   | TESTED      | workflows written; first run pending                                                                                                                      |
| Supply-chain policy + secret scan         | TESTED      | repository tests                                                                                                                                          |
| Ad/tracker blocking                       | NOT STARTED | design only (M3)                                                                                                                                          |
| Browser shell UI (tabs, omnibox, palette) | NOT STARTED | M1                                                                                                                                                        |
| Sync                                      | SCAFFOLDED  | architecture + threat model only; nothing syncs                                                                                                           |
| Password manager                          | NOT STARTED | threat model written                                                                                                                                      |
| Installer                                 | NOT STARTED | design notes only (M8)                                                                                                                                    |
| Translation                               | NOT STARTED | policy defined (opt-in, provider abstraction)                                                                                                             |
| Enterprise policy                         | NOT STARTED | M7                                                                                                                                                        |
| Mobile                                    | NOT STARTED | architecture notes only                                                                                                                                   |

## Truthfulness rules

1. Documentation must not advertise a feature that is not at least TESTED.
2. The README carries a status table using the vocabulary above.
3. No screenshot, mockup or harness preview may be presented as a working
   browser.
4. `NOT VERIFIED` is an acceptable and expected state. Faking verification is
   not.

## Known blockers

| Blocker                                                                   | Impact                                                                                                                               | Workaround in place                                                                                                                                                                                           |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No Chromium build has ever been run for this project                      | Integration cannot be claimed                                                                                                        | Self-hosted heavy build workflow + smoke test are ready to produce evidence                                                                                                                                   |
| Building requires a machine with ≥ 8 cores / 32 GB RAM / 150 GB free disk | Cannot build in small sandboxes or hosted CI                                                                                         | Lightweight upstream verification instead; documented requirements                                                                                                                                            |
| No code-signing certificate                                               | Windows builds are unsigned and will prompt SmartScreen                                                                              | Unsigned development builds are labelled; no bypass is attempted                                                                                                                                              |
| No Apple Developer account                                                | macOS cannot be notarised                                                                                                            | macOS is non-blocking for the Windows-first plan                                                                                                                                                              |
| Supabase terms not yet verified for the free tier                         | Sync backend choice is conditional                                                                                                   | Provider is `none`; abstraction designed to keep options open                                                                                                                                                 |
| "Aurelia" naming conflict with an established JS framework                | Branding risk                                                                                                                        | Kept as a codename; branding centralised ([NAMING.md](NAMING.md))                                                                                                                                             |
| GitHub credential lacks the `workflows` permission                        | The CI definitions cannot be installed under `.github/workflows/`; nothing runs on GitHub yet                                        | Definitions are committed at `tools/ci/workflows/` and deployed with `node tools/ci/install-workflows.mjs` once a credential with the permission is available. Documented in [CI-SECURITY.md](CI-SECURITY.md) |
| GitHub credential cannot update issues                                    | Labels, milestones, states and comments cannot be set after creation, so the issue tracker cannot be organised or closed by an agent | Reconnect GitHub with issue-write permission (or apply labels/milestones manually); the intended milestone and labels for every open issue are tabulated in pull request #16. PRs are unaffected              |
