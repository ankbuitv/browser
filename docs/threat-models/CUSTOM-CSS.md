# Threat model: custom CSS

**Status: design only. Custom CSS is not implemented.** The threat model comes
first because CSS customisation is a classic route from "theming" to
"arbitrary code execution in a privileged context".

## The two mechanisms are separate, and must stay separate

|                        | Browser-UI CSS                                                        | Website CSS                                                 |
| ---------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------- |
| Applies to             | Aurelia's own WebUI surfaces (`chrome://aurelia`, future shell pages) | Web pages the user visits                                   |
| Scope                  | Global, opt-in, per-profile                                           | Off by default; opt-in per site or deliberately global      |
| Privilege              | Runs in a privileged browser-UI context                               | Runs in the page's own renderer, with the site's privileges |
| Site can influence it? | No                                                                    | It is the site's own document                               |
| Preference             | `appearance.customUiCss` (local, not synced)                          | `appearance.siteCss` = `off` \| `per-site` \| `global`      |

Neither mechanism may ever expose: `chrome://` privileged objects, browser
process IPC, extension APIs, the filesystem, or credentials. Treat "CSS that can
reach the browser process" as a vulnerability, not a feature request.

## Why CSS is not "just styling"

| Attack                                                           | How it would work                                                                             | Mitigation                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data exfiltration via selector/attribute probing                 | CSS selectors + `background: url(...)` leak attribute values to a remote server               | Website CSS runs inside the page's renderer with the page's CSP applied, so no new exfiltration primitive is created; browser-UI CSS is not exposed to remote content, and untrusted CSS is disallowed from loading remote URLs (see below) |
| `@import` / `url()` remote fetch from a privileged surface       | Browser-UI stylesheet silently reports activity to a server                                   | Remote fetches from **browser-UI** CSS are blocked; only local/bundled resources are allowed                                                                                                                                                |
| Escaping into script                                             | Historically, some engines allowed expression-like syntax or `javascript:` URLs in odd places | Stylesheets are treated as CSS only; no script execution path is created, and `javascript:`/`data:` URL values are rejected                                                                                                                 |
| `-webkit-user-modify`, `behavior:`, `-moz-binding` style escapes | Legacy engine-specific properties that cross the script boundary                              | Explicit denylist for script-adjacent properties, plus a test that they are inert                                                                                                                                                           |
| Selector abuse causing a UI bypass                               | Hiding security indicators (e.g. the lock icon) via browser-UI CSS                            | Browser-UI CSS may not target security-critical chrome (a denylisted set of selectors/IDs); violation disables the stylesheet and explains why                                                                                              |
| Denial of service                                                | Enormous/pathological stylesheet                                                              | Size limits, parse-error tolerance, and the stylesheet is dropped on failure rather than crashing the page                                                                                                                                  |

## Trust boundary

```
user-authored CSS  ──>  [scoping + sanitising layer]  ──>  WebUI (privileged)
website CSS        ──>  [per-site opt-in]             ──>  page renderer (unprivileged)
```

The sanitising layer is a security boundary: it is the only component that may
turn user text into something the privileged context accepts, and it is tested
adversarially (`docs/TESTING.md`, negative cases).

## Rules for implementation

1. **Opt-in.** Website CSS is off until enabled, and `per-site` is the default
   when enabled, so a global stylesheet is a deliberate second step.
2. **Obvious scope.** The settings UI states plainly which sites a stylesheet
   applies to, and shows a persistent indicator on affected sites.
3. **No script.** No path from either mechanism to script execution. No
   `eval`, no dynamic `import`, no `innerHTML` from CSS content.
4. **No privileged reach.** Browser-UI CSS may not reference `chrome://`
   internals beyond the page's own resources, may not load remote URLs, and may
   not address security-critical elements.
5. **Local-only by default.** Browser-UI stylesheet text is stored in the local
   profile and marked `sync: none` in the preference schema, so it is never
   uploaded.
6. **Failure is graceful.** A broken stylesheet is disabled with an explanation,
   not allowed to render the browser unusable (and never the only recovery path:
   safe mode must also revert custom CSS).

## Explicit non-goals

- No user JavaScript in the browser UI. That is a different product with a very
  different risk profile, and it is not planned.
- No CSS from a website influencing Aurelia's own UI.
- No remote stylesheet installation from a marketplace.

## Planned tests

- a site stylesheet cannot reach browser-UI elements or privileged objects;
- browser-UI CSS with `@import url(https://...)` is rejected;
- denylisted critical selectors are neutralised and reported;
- `javascript:`/`data:` values and script-adjacent properties are inert;
- pathological input (100k selectors, deep nesting) fails safely;
- disabling custom CSS in safe mode always restores a usable browser;
- per-site grants are visible and revocable, and revocation takes effect
  immediately.
