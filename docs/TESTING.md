# Testing strategy

Testing is organised by _what proves what_, because the levels are easy to
confuse and the confusion is how projects end up claiming a feature works when
it does not.

## The rule

> A screenshot is not integration. A Vite preview is not the browser. A passing
> unit test is not a compiling browser. A compiling browser is not a working
> feature.

Each level below states what it proves and - explicitly - what it does not.

## Levels

### 1. Unit tests (fast CI) - prove logic

`vitest`, no browser, no network. Covers Aurelia-owned logic and tooling:

| Area                                                                                   | File                                                |
| -------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Omnibox input classification (incl. blocked schemes, host:port)                        | `packages/core/src/url/classify.test.ts`            |
| Secure DNS policy (fail-closed, redundancy, template validation)                       | `packages/core/src/net/secure-dns.test.ts`          |
| Tracking-parameter stripping (allowlists, non-http inputs)                             | `packages/core/src/privacy/tracking-params.test.ts` |
| Preference schema, store, derived values, invariants                                   | `packages/core/src/prefs/*.test.ts`                 |
| Chromium pin validation                                                                | `tests/tools/config.test.mjs`                       |
| Patch parsing/rejection rules                                                          | `tests/tools/patch.test.mjs`                        |
| Workflow policy, secret scanning, generated-file freshness, offline patch verification | `tests/tools/repository.test.mjs`                   |

Run: `npm test`.

_Proves:_ the logic is right. _Does not prove:_ anything about Chromium.

### 2. Repository invariants (fast CI) - prove the artifacts agree

`node tools/ci/fast-checks.mjs` plus `tests/tools/repository.test.mjs`:

- the pin is exact, immutable, and its `baseRevision` matches the patch set;
- generated files (version header, design tokens) match their generators;
- the patch set verifies offline, touching only expected paths;
- the overlay contains only Chromium-native files and no Node.js runtime files;
- workflows are SHA-pinned, minimally privileged and policy-compliant;
- no credentials are present in tracked files.

_Proves:_ the repository is internally consistent. _Does not prove:_ it compiles.

### 3. Patch verification against upstream (CI, network) - proves the delta applies

`node tools/chromium/cli.mjs verify-patches --online`:

1. fetches each upstream pre-image at the exact pinned revision;
2. compares SHA-256 digests against `chromium/verification/pre-images.json`;
3. applies the patch to those pre-images with `git apply`;
4. compares every resulting file against the recorded post-image digest.

_Proves:_ the patch targets that revision and applies cleanly to unmodified
upstream files. _Does not prove:_ compilation (a GN dependency or a C++
signature could still be wrong).

### 4. Runtime smoke test (heavy builder) - proves integration

`node tools/chromium/smoke-test.mjs --binary <built browser>`:

launches the binary, drives it over the DevTools Protocol, and asserts:

- `chrome://aurelia` loads, with the expected title and element;
- both stylesheets load from the browser's resource pak;
- the status cards render;
- the page reports the pinned Chromium revision;
- the binary's reported version matches the pin.

_Proves:_ the overlay is compiled into a real browser and its WebUI works.
_Does not prove:_ that navigation, tabs, blocking, or sync work.

### 5. Feature tests (planned) - prove the product

To be added per milestone, in the same spirit (real browser, real assertions):

**Browser features**

- navigation: typed URL, search, back/forward, redirects, error pages
- tabs: create/close/reorder, pinned tabs, restore after crash, tab groups
- split view: 1-3 panes, focus handling, closing panes
- workspaces: persistence across restarts, tab assignment
- sessions: `ask` vs `restore` vs `newtab`, unclean shutdown behaviour
- profiles: isolation of cookies/history/settings, profile switching
- history/bookmarks/downloads: write, read, search, delete
- **private mode (security-relevant):** nothing persisted - history, cookies,
  session restore state, form data, and no trace in the normal profile after
  closure

**Privacy features**

- ad/tracker blocking: filter parsing, per-site counters, per-site disable,
  cosmetic filtering
- DNS: each mode's actual resolver behaviour, custom template validation,
  encrypted-only fallback
- privacy toggles: High Privacy Mode disables suggestions/prefetch/preconnect/
  DNS prefetch and nothing else
- search: engine switching, suggestions off, Google default per owner request
- tracking-parameter stripping: navigations lose `utm_*`/`fbclid`, unknown
  parameters survive

**Product polish**

- command palette: open, search, tab switch, bookmark jump, history, commands
- themes: light/dark/system, accent, import/export, custom CSS scoping
- translation: opt-in only, provider absent by default, disable-all works
- enterprise policy: managed bookmarks, URL allow/blocklists, managed DNS,
  "managed by your organization" surface
- updates: channel selection, notify-vs-install behaviour, integrity failure
  handling (must refuse, never install)

**Negative/adversarial cases** (required for security-sensitive features)

- `javascript:`/`data:`/`vbscript:` input never navigates
- a page cannot reach `chrome://aurelia` or any internal page
- site CSS cannot execute script or reach browser APIs
- wrong-key and tampered sync payloads are rejected
- password autofill never crosses origins
- a modified patch file fails verification
- a stale pin fails fast CI

### 6. Privacy and network tests (planned, M3)

Automated detection of unexpected outbound requests in: first launch, new tab,
normal browsing, private mode, High Privacy Mode, sync off. The allowlist is
derived from [NETWORK-CONNECTIONS.md](NETWORK-CONNECTIONS.md). Any request
outside the allowlist fails the test.

## Manual test checklists

Some things are genuinely manual (visual quality, OS integration). Checklists
live beside the relevant milestone issues and must be executed on a real Windows
build before an MVP claim; results are posted in the issue, not assumed.

## CI mapping

| Level                   | Where                                                 | Trigger                        |
| ----------------------- | ----------------------------------------------------- | ------------------------------ |
| 1 Unit tests            | `.github/workflows/ci-fast.yml`                       | every push/PR                  |
| 2 Repository invariants | `.github/workflows/ci-fast.yml`                       | every push/PR                  |
| 3 Patch verification    | `.github/workflows/ci-fast.yml`                       | every push/PR                  |
| 4 Runtime smoke test    | `tools/ci/workflows/chromium-heavy-build-windows.yml` | nightly + manual (self-hosted) |
| 5 Feature tests         | same as 4, per feature                                | as implemented                 |
| 6 Privacy/network tests | same as 4                                             | as implemented                 |

## Coverage expectations

Coverage percentage is not a goal. The expectations are:

- every security-sensitive rule has a **negative test**;
- every generated file has a freshness check;
- every documented guarantee that can be tested is tested, and every one that
  cannot be is labelled `NOT VERIFIED` rather than implied to work.
