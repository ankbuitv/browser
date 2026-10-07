# Fork delta

How much of Chromium Aurelia changes, why, and how hard it is to rebase.

Keeping this number small is a product requirement, not a style preference: a
small delta is what makes security updates land quickly. Aurelia is built as
**isolated code plus a handful of one-line build registrations**, never as a
patched-up copy of a Chromium subsystem.

- Pinned base: Chromium `155.0.8059.40`
  (`cfaadc5a132d78e1828635aa8405a499f3e14864`, stable channel)
- Patch set version: `0.1.0`

> **Verification state:** the numbers below are measured by
> `node tools/chromium/cli.mjs fork-delta` and the patch set is verified against
> the pinned upstream revision by
> `node tools/chromium/cli.mjs verify-patches --online`.
> **The tree has not been compiled yet** - there is no buildable builder in the
> scaffolding environment. See [Status](#status) at the bottom of this file and
> `tools/ci/workflows/chromium-heavy-build-windows.yml`.

## Measured delta

| Metric                                          | Value        |
| ----------------------------------------------- | ------------ |
| Patch files                                     | 1            |
| Modified upstream files                         | 6            |
| Lines added to upstream files                   | 7            |
| Lines removed from upstream files               | 0            |
| Overlay files added (new files, no rebase risk) | 10           |
| Overlay size                                    | 23,691 bytes |

Reproduce with:

```bash
node tools/chromium/cli.mjs fork-delta --json
node tools/chromium/cli.mjs status
```

## Modified upstream files

Every entry is an insertion, in an area upstream rarely rewrites. None of them
changes Chromium behaviour; they register Aurelia code that lives in
`chromium/overlay/`.

| #   | File                                               | Δ   | Component             | Reason                                                                                               | Rebase difficulty | Could become an overlay? | Upstreamable?         |
| --- | -------------------------------------------------- | --- | --------------------- | ---------------------------------------------------------------------------------------------------- | ----------------- | ------------------------ | --------------------- |
| 1   | `chrome/common/webui_url_constants.h`              | +1  | `webui-url-constants` | Declare the `chrome://aurelia` host constant next to the other WebUI hosts.                          | trivial           | no                       | no (Aurelia-specific) |
| 2   | `chrome/browser/resources/BUILD.gn`                | +1  | `resources`           | Include `aurelia:resources` in the browser resources group.                                          | trivial           | no                       | no                    |
| 3   | `chrome/browser/ui/webui/BUILD.gn`                 | +1  | `webui`               | Add `//chrome/browser/ui/webui/aurelia` to the desktop WebUI deps.                                   | trivial           | no                       | no                    |
| 4   | `chrome/browser/ui/BUILD.gn`                       | +1  | `browser-ui`          | Link the controller into `//chrome/browser/ui`.                                                      | trivial           | no                       | no                    |
| 5   | `chrome/browser/BUILD.gn`                          | +1  | `browser`             | Link the controller into `//chrome/browser`.                                                         | trivial           | no                       | no                    |
| 6   | `chrome/browser/ui/webui/chrome_web_ui_configs.cc` | +2  | `webui`               | `#include` the controller header and call `map.AddWebUIConfig(std::make_unique<AureliaUIConfig>())`. | trivial           | no                       | no                    |

Machine-readable version of this table (including the exact anchor text each
edit inserts at, pre-image and post-image digests):
`chromium/patches/0001-aurelia-webui-and-resources.meta.json`.

## Overlay files (added, not patched)

These are plain new files. They carry no rebase cost: if upstream moves, the
only thing that can break is an API they call, not a conflict.

| File                                                      | Purpose                                                                                             |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `chrome/browser/ui/webui/aurelia/BUILD.gn`                | GN target for the controller, modelled on `webui_gallery`.                                          |
| `chrome/browser/ui/webui/aurelia/aurelia_ui.h`            | `AureliaUIConfig` + `AureliaUI` controller declaration.                                             |
| `chrome/browser/ui/webui/aurelia/aurelia_ui.cc`           | Serves `chrome://aurelia` from the resource pak; exposes only compile-time provenance strings.      |
| `chrome/browser/ui/webui/aurelia/aurelia_version.h`       | **Generated** from `config/chromium_version.json`; single place product identity is defined in C++. |
| `chrome/browser/resources/aurelia/BUILD.gn`               | `build_webui()` target: pak, grit map, TypeScript compilation.                                      |
| `chrome/browser/resources/aurelia/aurelia.html`           | Page shell.                                                                                         |
| `chrome/browser/resources/aurelia/aurelia_app.ts`         | `<aurelia-app>` page element.                                                                       |
| `chrome/browser/resources/aurelia/aurelia_status_card.ts` | `<aurelia-status-card>` component.                                                                  |
| `chrome/browser/resources/aurelia/aurelia.css`            | Page styles (tokens only, accessibility fallbacks).                                                 |
| `chrome/browser/resources/aurelia/design_tokens.css`      | **Generated** from `packages/design-tokens/tokens.json`.                                            |

## Known integration caveat (must be re-checked on the first heavy build)

The `AureliaUIConfig` registration lands inside the
`#else  // BUILDFLAG(IS_ANDROID)` / `#if !BUILDFLAG(IS_CHROMEOS)` block of
`RegisterChromeWebUIConfigs()`. That is correct for Windows, macOS and Linux
desktop builds, and means `chrome://aurelia` is **not** registered on ChromeOS
or Android builds. If Aurelia later targets those platforms, the registration
moves to a platform-appropriate block; this is recorded here so it is not
forgotten during review.

## What would grow the delta (and why we avoid it)

| Temptation                                                                 | Why it is refused                                                                                                                                                                                      |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Editing Chromium's tab strip / toolbar Views code for the shell design     | Every upstream UI change becomes a conflict. Prefer WebUI surfaces and supported extension points; treat Views edits as a last resort with a documented reason.                                        |
| Carrying a Manifest V2 patch to claim legacy extension support             | Long-term security and maintenance liability. Targeted at Manifest V3 only.                                                                                                                            |
| Vendoring a filter engine into `//components`                              | Adds a dependency fork. Prefer building on Chromium's `subresource_filter` component and properly licensed filter components (see `docs/THREAT-MODEL.md`, ad blocker licensing notes in `PRIVACY.md`). |
| Patching the network stack for DoH policy                                  | Chromium already expresses the required policy through Secure DNS configuration; we only choose configuration, not behaviour.                                                                          |
| Disabling a Chromium security or privacy feature to make something simpler | Prohibited. See the security rules in `SECURITY.md`.                                                                                                                                                   |

## Status

| Item                                                          | State            |
| ------------------------------------------------------------- | ---------------- |
| Patch/overlay mechanism                                       | IMPLEMENTED      |
| Patch verifies against the pinned revision (offline + online) | TESTED           |
| Tooling unit tests                                            | TESTED           |
| Overlay compiles inside a Chromium tree                       | **NOT VERIFIED** |
| `chrome://aurelia` runs in a built browser                    | **NOT VERIFIED** |

`NOT VERIFIED` here means exactly that: no evidence exists yet, and no claim of
integration is made. The heavy build workflow exists to produce that evidence;
its output must be attached to the milestone issue before M1 is called done.

## Update procedure

See [CHROMIUM-UPSTREAM.md](CHROMIUM-UPSTREAM.md#update-procedure). Summary:
detect → open issue → regenerate and verify the patch set → heavy build +
smoke test → maintainer merge. Nothing merges automatically.
