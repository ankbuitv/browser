# Architecture

Aurelia Browser is a **thin, reproducible fork of Chromium** with an isolated
Aurelia layer. This document describes the moving parts and, just as
importantly, the parts that are deliberately _not_ there.

## Layered view

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Chromium (upstream, pinned to one revision, never edited in place        │
│ except for 7 inserted lines in 6 build/registration files)               │
│   Views UI · WebUI infrastructure · network stack · sandbox · DevTools   │
├──────────────────────────────────────────────────────────────────────────┤
│ Aurelia overlay (chromium/overlay/**) - NEW files only                   │
│   chrome/browser/ui/webui/aurelia/**     WebUI controller (C++)          │
│   chrome/browser/resources/aurelia/**    WebUI page + components (TS/CSS)│
├──────────────────────────────────────────────────────────────────────────┤
│ Aurelia policy code (packages/core) - pure, unit-tested, no DOM/Node     │
│   omnibox input classification · secure DNS policy · tracking-parameter  │
│   stripping · preference schema, store, derived values, invariants       │
├──────────────────────────────────────────────────────────────────────────┤
│ Design system (packages/design-tokens) - one source, generated outputs   │
├──────────────────────────────────────────────────────────────────────────┤
│ Tooling (tools/**) - not part of the product                             │
│   Chromium pin/sync/overlay/patch/verify · design-token generator ·      │
│   CI policy + secret scanning · runtime smoke test                       │
└──────────────────────────────────────────────────────────────────────────┘
```

## Design principles

1. **Thin delta.** Aurelia's value is fast security updates, which is only
   possible if the delta stays small. Measured and tracked in
   [FORK-DELTA.md](FORK-DELTA.md).
2. **Isolation over patching.** New behaviour lives in new files. Patching
   Chromium is a last resort with a documented reason.
3. **No new runtime.** The browser is Chromium: C++/Views/WebUI, its own V8, its
   own network stack. Node.js is development tooling only and never ships.
   (Enforced by a repository test that fails if a Node runtime artifact appears
   in the overlay.)
4. **Policy as testable code.** Rules like "never navigate to `javascript:`",
   "secure DNS fails closed", "unknown URL parameters are never stripped" are
   pure functions in `packages/core`, covered by negative tests.
5. **One source of truth per fact.** The Chromium pin, product identity and
   design tokens each have exactly one canonical file; everything else is
   generated and checked for freshness in CI.
6. **Fail loudly.** A stale pin, an ambiguous patch anchor, a missing generated
   file, an unpinned action, or a credential in the tree fails the build rather
   than warning.

## Components

### Chromium pin and checkout (`config/`, `tools/chromium/`)

| Piece                                | Responsibility                                                                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `config/chromium_version.json`       | The pin: version, exact commit SHA, channel, milestone, patch-set version, update policy, builder requirements. Validated on every CI run.    |
| `tools/chromium/sync.mjs`            | Reproducible checkout: preflight (disk), pinned `depot_tools`, `.gclient` solution, `gclient sync --revision src@<pin>`, `HEAD` verification. |
| `tools/chromium/install-overlay.mjs` | Copies `chromium/overlay/**` into the tree (refusing to clobber local edits) and applies the patch set with `git apply --check` first.        |
| `tools/chromium/generate-patch.mjs`  | Regenerates the patch from pristine pre-images fetched at the pinned SHA, using declarative edits. Records pre/post digests.                  |
| `tools/chromium/verify-patches.mjs`  | Offline checks (structure, digests, policy) and online verification (fetch at pin → apply → compare digests).                                 |
| `tools/chromium/smoke-test.mjs`      | CDP-driven runtime verification of a built binary.                                                                                            |
| `tools/chromium/cli.mjs`             | Single entry point for all of the above.                                                                                                      |

### Aurelia WebUI (`chromium/overlay/chrome/browser/**`)

`chrome://aurelia` is the first integrated Aurelia surface. It is an _internal_
WebUI: web content cannot navigate to it. It has no message handlers, no Mojo
interface, performs no network requests and reads no profile data - it renders
compile-time provenance (product codename/version, Chromium pin, patch-set
version) and the Chromium version the binary actually reports, which makes a
pin/build mismatch visible in the UI.

Registration is 7 inserted lines across 6 upstream files (see
`chromium/patches/`). The C++ controller is modelled on upstream's
`webui_gallery` so rebases follow a familiar shape.

### Policy code (`packages/core`)

Pure TypeScript, no DOM, no Chromium, no Node APIs. This is where rules are
tested:

| Module                       | Rules                                                                                                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url/classify.ts`            | Omnibox classification; blocked schemes (`javascript:`, `vbscript:`, `data:`, `blob:`, `filesystem:`); `scheme://` vs `host:port` disambiguation; `data:` only via explicit opt-in |
| `net/secure-dns.ts`          | Modes, fail-closed semantics, encrypted redundancy order, strict template validation                                                                                               |
| `privacy/tracking-params.ts` | Known tracker parameters and prefixes; allowlists; never removes unknown parameters                                                                                                |
| `prefs/schema.ts`            | All user settings with scope, sync class, sensitivity, privacy note, defaults                                                                                                      |
| `prefs/store.ts`             | Validation, managed-pref protection, change notification                                                                                                                           |
| `prefs/derived.ts`           | High Privacy Mode overrides (with reasons), cross-preference invariants (`sync` requires E2EE)                                                                                     |

The overlay's Chromium TypeScript does not import this package directly at build
time; rules that must run inside the browser are mirrored into the overlay with
the same tests, and the WebUI layer stays thin. This avoids adding a bundler or
a Node dependency to the Chromium build.

### Design system (`packages/design-tokens`)

One `tokens.json` generates the overlay CSS, a TypeScript module and the
development harness stylesheet. CI fails if a generated file is stale, so the
browser and the harness cannot drift.

### Development harness (`packages/ui-lab`)

An explicitly-labelled "UI development harness - not the Aurelia browser",
served by `tools/dev/serve-ui-lab.mjs` (zero dependencies, no build step). Its
only reason to exist is to iterate on components that will ship as Chromium
WebUI resources, so it consumes the same tokens and (where practical) the same
component code. It is never shipped and never referenced by the overlay.

## What this architecture deliberately does not contain

| Absent                                                    | Why                                                                                |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Electron / CEF / WebView shell                            | The product is a real Chromium fork.                                               |
| A Node.js runtime in the browser                          | Node is tooling; shipping it would add a runtime dependency and an attack surface. |
| A patched-up copy of Chromium subsystems                  | Guarantees rebase pain and slow security updates.                                  |
| AI assistant, chatbot, LLM sidebar, autonomous agent, VPN | Out of scope by product decision.                                                  |
| An Aurelia extension marketplace                          | Chromium's extension system is used; a second store is not a goal.                 |
| A permanent Arc-style sidebar                             | The shell is top tabs + omnibox; vertical tabs are an option, not a fixture.       |
| Silent telemetry                                          | There is no telemetry endpoint.                                                    |

## Data flows

- **DNS:** resolver choice is Aurelia's; the mechanism is Chromium's. Details in
  [DNS-POLICY.md](DNS-POLICY.md).
- **Search:** straight to the selected provider, never proxied through Aurelia
  infrastructure.
- **Sync (planned):** E2EE blobs to a provider behind an adapter; the server
  never sees plaintext. [SYNC-ARCHITECTURE.md](SYNC-ARCHITECTURE.md).
- **Every default connection:** tabulated in
  [NETWORK-CONNECTIONS.md](NETWORK-CONNECTIONS.md).

## Verification chain

```
unit tests        →  logic is correct
repository checks →  artifacts agree with each other
patch verify      →  delta applies to the pinned upstream revision
heavy build       →  it compiles (self-hosted builder)
smoke test        →  the built browser runs an Aurelia surface
feature tests     →  the product behaves as documented
```

Each level states what it does _not_ prove in [TESTING.md](TESTING.md). Nothing
is called working until the appropriate level has produced evidence.
