# Third-party notices

This file records third-party code and assets that Aurelia uses, and the
licenses that apply. It is a living document: **update it in the same pull
request that introduces a dependency.**

Aurelia is a fork of Chromium. The vast majority of the code in a built browser
is Chromium's, under Chromium's own licenses.

## Upstream: Chromium

| Component | Version                                                             | License                 | Notes                                                                                                                                                                                                    |
| --------- | ------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chromium  | pinned `155.0.8059.40` (`cfaadc5a132d78e1828635aa8405a499f3e14864`) | BSD-3-Clause and others | Copyright The Chromium Authors. Full upstream notices are preserved in the checkout (`LICENSE`, `LICENSES/`), and are shipped with any distribution as required. Aurelia never relicenses upstream code. |

The pinned revision is the only version Aurelia builds. See
[docs/CHROMIUM-UPSTREAM.md](docs/CHROMIUM-UPSTREAM.md).

## Aurelia's own code

| Component                                                               | License                      |
| ----------------------------------------------------------------------- | ---------------------------- |
| Aurelia Browser (everything in this repository that is not third-party) | MPL-2.0 ([LICENSE](LICENSE)) |

**Why MPL-2.0 for Aurelia's own code:**

- it is file-level copyleft, so Aurelia's own components (the WebUI controller,
  resources, policy code, tooling) stay open, while Chromium's BSD-licensed
  files can be combined and redistributed without being relicensed — which is
  what Chromium's own licensing expects;
- it is compatible with the way a Chromium fork is assembled (BSD-3-Clause,
  Apache-2.0 and MIT dependencies can all be combined into a larger MPL work);
- it explicitly permits larger works under other terms, so enterprise and
  downstream distribution is unencumbered;
- it includes a patent grant, which permissive licenses such as MIT do not.

Alternative considered: Apache-2.0 (permissive, patent grant). Rejected because
it would allow a closed fork of Aurelia's own components without contributing
changes back — the project prefers to keep its own components open while
respecting Chromium's licensing completely.

## Development-time dependencies (not shipped in the browser)

These are used for building and testing Aurelia's own code. They are **not**
part of the browser, and no Node.js runtime is shipped.

| Package                                     | Purpose                                      | License    |
| ------------------------------------------- | -------------------------------------------- | ---------- |
| `vitest`                                    | unit test runner                             | MIT        |
| `typescript`                                | type checking for Aurelia-owned code         | Apache-2.0 |
| `eslint`, `@eslint/js`, `typescript-eslint` | linting                                      | MIT        |
| `prettier`                                  | formatting                                   | MIT        |
| `jsdom`                                     | DOM environment for tests (development only) | MIT        |
| `@types/node`                               | Node type definitions                        | MIT        |

Exact versions are pinned by `package-lock.json`; CI installs with `npm ci`.
Their full license texts ship inside each package in `node_modules/`.

## Assets

| Asset                                                        | Origin                                                                                                                                          | License        |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Aurelia design tokens (`packages/design-tokens/tokens.json`) | Authored for this project                                                                                                                       | MPL-2.0        |
| Wallpapers                                                   | **None added yet.** Any future wallpaper must be original, generated for the project, or legally redistributable with attribution recorded here | to be recorded |
| Installer artwork                                            | **Does not exist yet.** M8 requires original artwork; no third-party UI assets, no proprietary art, no copied layouts                           | to be recorded |
| Icons                                                        | Uses upstream Chromium icon infrastructure where possible; any Aurelia-specific icon must be original                                           | to be recorded |

No third-party wallpapers, fonts, sounds, logos or UI assets may be added
without a license record in this file.

## Planned dependencies (not yet integrated, listed for transparency)

Adding any of these requires verifying the exact license and preserving required
attribution **before** integration. None are in the repository today.

| Candidate                                      | Use                            | License to verify             | Notes                                                                                         |
| ---------------------------------------------- | ------------------------------ | ----------------------------- | --------------------------------------------------------------------------------------------- |
| Chromium `subresource_filter` component        | network-level content blocking | BSD-3-Clause (Chromium)       | Preferred over vendoring a third-party engine.                                                |
| Community filter lists (EasyList, EasyPrivacy) | blocking rules                 | CC BY-SA 3.0 / GPL (per list) | Lists are data; the project must record each list's terms and attribution. Not "uBlock code". |
| A reviewed AEAD/KDF library                    | sync and password encryption   | to be verified                | Reviewed cryptography only. No home-grown primitives.                                         |

### Wording rules for the blocker

Do **not** claim "uBlock Origin built in". uBlock Origin is GPL-3.0 licensed and
its code is not used here. Correct wording until (and unless) licensing says
otherwise:

> built-in content blocker compatible with common filter lists

## Reporting an attribution problem

If you believe this document is missing an attribution or licensing statement,
open an issue or contact the maintainer (`@ankbuitv`). Missing attribution is
treated as a bug.
