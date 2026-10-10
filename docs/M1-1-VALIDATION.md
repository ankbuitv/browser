# M1.1 — Chromium build and runtime validation (sandbox report)

Status legend: **PASS** · **FAIL** · **BLOCKED** (cannot run here, reason given) ·
**NOT TESTED** (not attempted).

This document records what was verified in the development sandbox and what was
not. Nothing here claims that Aurelia compiles or runs as a Chromium browser.

## 1. Baseline

| Check                                                                                                                | Result        | Evidence                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| PR #19 merged into `main`                                                                                            | PASS          | `gh pr view 19` → `MERGED`, merge commit `f666ba9`                                                                                      |
| `main` contains Aurelia WebUI, New Tab WebUI, Command Palette, C++ controllers, GN, patch set, GRIT wiring, tests/CI | PASS (static) | `chromium/overlay/**`, `chromium/patches/0001-*.patch`, `tools/gritsettings/resource_ids.spec` edits, `tests/**`, `.github/workflows`   |
| Session branch                                                                                                       | NOTE          | Work is on `arena/342cb302-aurelia` (fixed for this session), not the `arena/m1-1-chromium-validation` name requested in the directive. |

## 2. Build environment

| Tool / resource                     | Available here?        | Notes                                                                                      |
| ----------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------ |
| `depot_tools`, `gclient`            | NO                     | Needs `chromium.googlesource.com`, which is not reachable (TLS failure / not allowlisted). |
| `gn`, `autoninja`, `ninja`, `clang` | NO                     | Not installed.                                                                             |
| Python                              | YES (3.11)             |                                                                                            |
| Node / npm                          | YES                    | Used for the repository's own tooling.                                                     |
| CPU                                 | 2 cores                | Reference builder: 8+ cores (`config/chromium_version.json`).                              |
| RAM                                 | 3.8 GB                 | Reference builder: 32 GB+.                                                                 |
| Free disk                           | 19.1 GB                | Reference builder: 150 GB+ on one volume.                                                  |
| Network                             | GitHub, npm, PyPI only | `codeload.github.com` is reachable, but a full Chromium tree does not fit on disk.         |

`node tools/ci/check-builder.mjs --dest /home/user` reports the same three
failures and exits with "BUILDER TOO SMALL".

## 3. Pinned Chromium

| Check                                                            | Result  | Evidence                                                                                                    |
| ---------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| Pin unchanged                                                    | PASS    | `config/chromium_version.json`: `155.0.8059.40` @ `cfaadc5a132d78e1828635aa8405a499f3e14864` (not modified) |
| Offline patch verification                                       | PASS    | `node tools/chromium/cli.mjs verify-patches`                                                                |
| Online patch verification (pre-images, `git apply`, post-images) | PASS    | `verify-patches --online` against the pinned revision                                                       |
| Full Chromium checkout (`sync.mjs`)                              | BLOCKED | Requires depot_tools and `chromium.googlesource.com`, plus disk and RAM above.                              |

## 4. GN generation and GRIT/resource validation

| Check                                                                                                           | Result        | Evidence                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gn gen`                                                                                                        | BLOCKED       | No `gn` binary and no Chromium checkout.                                                                                                                                                                                                                                                          |
| `gn check`                                                                                                      | BLOCKED       | Same as above.                                                                                                                                                                                                                                                                                    |
| Static GN/GRIT/WebUI consistency                                                                                | PASS (static) | `tools/ci/check-webui-resources.mjs`, `tests/tools/webui-resources.test.mjs`                                                                                                                                                                                                                      |
| Upstream template names (`build_webui` → `:resources`, `grit_output_dir` → `root_gen_dir/chrome`, `.pak` names) | PASS (static) | Read at the pinned revision via the GitHub API: `ui/webui/resources/tools/build_webui.gni`, `chrome/chrome_paks.gni`                                                                                                                                                                              |
| C++ APIs used by the controllers exist in pinned headers                                                        | PASS (static) | `DefaultInternalWebUIConfig`, `MojoWebUIController(web_ui, bool)`, `OverrideContentSecurityPolicy`, `webui::SetupWebUIDataSource`, `WEB_UI_CONTROLLER_TYPE_DECL`                                                                                                                                  |
| Generated GRIT headers committed by hand                                                                        | PASS          | None are checked in.                                                                                                                                                                                                                                                                              |
| GRIT resource ID allocation (`resource_ids.spec` 2870 / 4452)                                                   | NOT TESTED    | The M1-FINALIZATION notes describe these as placeholder start IDs assigned at build time. The `newtab` base sits 3 IDs before upstream's `aim_eligibility_extension` base (4455). Whether that collides depends on the real GRIT allocator, which needs a Chromium build to check. **Open risk.** |
| TypeScript resources (`ts_deps` for `//resources/js/load_time_data.js`)                                         | PASS (static) | `aurelia_app.ts` imports resolve through `ts_deps`; `newtab` has no external imports.                                                                                                                                                                                                             |

## 5. Compilation

| Target                         | Result  | Reason                                          |
| ------------------------------ | ------- | ----------------------------------------------- |
| Aurelia C++ controllers        | BLOCKED | No Chromium toolchain or source tree.           |
| WebUI resource targets / GRIT  | BLOCKED | Same.                                           |
| Smallest test target           | BLOCKED | Same.                                           |
| Full `chrome` / browser target | BLOCKED | Same; also far beyond the sandbox disk and RAM. |

No compile result is claimed.

## 6. Runtime (`chrome://aurelia`, `chrome://aurelia-newtab`)

| Check                                            | Result            | Reason                                                                                                         |
| ------------------------------------------------ | ----------------- | -------------------------------------------------------------------------------------------------------------- |
| Browser launches                                 | BLOCKED           | No Chromium build.                                                                                             |
| Pages load / resources served                    | BLOCKED           | No Chromium build.                                                                                             |
| No critical console errors                       | BLOCKED           | No Chromium build.                                                                                             |
| WebUI controllers initialize                     | BLOCKED           | No Chromium build.                                                                                             |
| Theme switching                                  | NOT TESTED        | Not implemented as a feature in the overlay; no runtime.                                                       |
| Command Palette opens (within implemented scope) | PASS (jsdom only) | `tests/tools/aurelia-page.test.mjs` runs the page module under jsdom. This is **not** a Chromium runtime test. |

The sandbox has no browser binary, and the WebUI pages cannot run outside
Chromium because they import `//resources/js/load_time_data.js`.

## 7. Defects found and fixed

### 7.1 Command Palette was built but never mounted (fixed)

- **Symptom:** `command_palette.ts` and `command_palette.css` were listed in the
  GN resource lists, so they were compiled into the pak. But `aurelia_app.ts` did
  not import the palette, `aurelia.html` did not link its stylesheet, and no
  element was created. Nothing on `chrome://aurelia` could open the palette.
- **Fix** (overlay only, no upstream file touched):
  - `aurelia_app.ts`: imports `./command_palette.js`, mounts
    `<aurelia-command-palette>`, adds a visible opener button, binds Ctrl/Cmd+K
    (toggle), and removes the document listener on disconnect.
  - `aurelia.html`: links `command_palette.css`.
  - `aurelia.css`: style for the opener button, using existing design tokens.
- **Regression test:** `tests/tools/aurelia-page.test.mjs` (4 tests). Three of
  them fail on the previous overlay, and all four pass with the fix.

## 8. Security triage (npm audit)

`npm audit` reports **6 advisories, all in development-only dependencies**.
`npm audit --omit=dev` reports **0**.

| Package          | Severity | Scope            | Advisory                                                                                                                                                                   | Available fix                                  |
| ---------------- | -------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `vitest` 2.1.9   | critical | dev (direct)     | When the Vitest UI server listens, arbitrary file read/execute (GHSA-5xrq-8626-4rwp); mocker path traversal (GHSA-82fw-gwwq-j7x9)                                          | `vitest@4.1.11` or `5.0.3` — **major version** |
| `tinypool`       | critical | dev (transitive) | Prototype pollution gadget to RCE in `run()` options (GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr)                                                                            | Via vitest major bump                          |
| `vite` 5.4.21    | high     | dev (transitive) | Path traversal in optimized deps; `server.fs.deny` bypass on Windows; `launch-editor` NTLM hash disclosure (GHSA-4w7w-66w2-5vf9, GHSA-fx2h-pf6j-xcff, GHSA-v6wh-96g9-6wx3) | Via vitest major bump; no patched 5.x exists   |
| `esbuild` 0.21.5 | moderate | dev (transitive) | Dev server accepts cross-origin requests (GHSA-67mh-4wv8-2f99)                                                                                                             | Via vitest major bump                          |
| `@vitest/mocker` | moderate | dev (transitive) | Path traversal via redirect mock (GHSA-82fw-gwwq-j7x9)                                                                                                                     | Via vitest major bump                          |
| `vite-node`      | moderate | dev (transitive) | Inherits vite                                                                                                                                                              | Via vitest major bump                          |

**Decision:** not applied. Every fix is a semver-major upgrade of the test
runner (vitest 2 → 4 or 5). Those are not "safe compatible" updates, and
`npm audit fix --force` was not run. These advisories concern the development
server and test tooling, not the shipped browser. They should be handled in a
separate PR that runs the full test suite against vitest 4 or 5. The
`vitest` UI server should not be started on untrusted networks until then.

## 9. Repository checks

| Check                           | Result                                       |
| ------------------------------- | -------------------------------------------- |
| `npm run format:check`          | PASS                                         |
| `npm run lint`                  | PASS                                         |
| `npm run typecheck`             | PASS                                         |
| `npm test`                      | PASS (329 tests, 28 files; baseline was 325) |
| `npm run build`                 | PASS                                         |
| `node tools/ci/fast-checks.mjs` | PASS                                         |
| Pin verification (online)       | PASS                                         |

## 10. Remaining blockers

1. **Builder hardware:** 2 cores, 3.8 GB RAM and 19 GB disk. The reference builder
   needs 8+ cores, 32 GB+ RAM and 150 GB+ disk.
2. **Network:** `chromium.googlesource.com` and `depot_tools` are not reachable from
   this sandbox. Only `github.com`, `codeload.github.com`, `api.github.com`,
   `registry.npmjs.org`, `pypi.org` and `files.pythonhosted.org` are allowed.
3. **Toolchain:** `gn`, `autoninja`, `clang` and `ninja` are not installed.
4. **GRIT IDs:** the real numeric resource IDs for `aurelia` and `aurelia_newtab`
   need a GRIT run to confirm there is no collision.
5. **Vitest major upgrade:** needed to clear the dev-tooling advisories (separate PR).

## 11. Next steps to reach real build evidence

On a machine that meets the reference builder requirements (Windows x64 is the
primary target, per `docs/BUILDING-CHROMIUM.md`):

1. `node tools/ci/check-builder.mjs --dest <parent>` must pass.
2. `node tools/chromium/sync.mjs --dest <path> --install`, then `gn gen out/Default`.
3. Build `aurelia_resources` / `aurelia_newtab_resources` GRIT targets first, then `chrome`.
4. Launch the browser and check `chrome://aurelia` and `chrome://aurelia-newtab`,
   the console, the resource loads and the palette (Ctrl+K).
