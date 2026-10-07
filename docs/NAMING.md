# Naming review: "Aurelia"

**Status: "Aurelia" is a development codename only.** This document records the
naming conflict search performed by the project, states what is known and not
known, and lists candidate alternatives. It makes **no legal claims** and is not
legal advice; a qualified professional must review any final name before
release.

## What we found

| Search                                | Result                                                                                                             | Risk to this project                                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Aurelia" JavaScript framework        | `aurelia/aurelia` - a long-established, widely used front-end framework (MIT), plus its docs site and npm packages | **High for a browser.** Developers will assume a connection, and the name is strongly associated with a different product in the web-adjacent space. |
| "Aurelia" as a product name generally | Used by various unrelated small businesses and products across industries                                          | Moderate; a generic-sounding Latin word, so broad usage exists                                                                                       |
| "Aurelia" web browser                 | No Chromium-based browser of that name found                                                                       | Low                                                                                                                                                  |
| Trademark registers                   | Not searched here. No register search was performed, and none should be inferred from this document                | **Unknown - requires a professional search**                                                                                                         |

Conclusion: the codename is **usable for development**, but shipping a browser
named "Aurelia" would collide with the established JavaScript framework in the
minds of exactly the audience a browser wants to reach. The project therefore:

1. keeps "Aurelia" as an internal codename;
2. **centralises branding so a rename is cheap** (see below);
3. recommends a formal name/trademark review before any public release;
4. does not yet use the name in irreversible identifiers where it can be
   avoided (see "Irreversible identifiers").

## Candidate alternatives (not vetted, not claimed as available)

Presented for discussion only; each needs the same professional review.

| Candidate                  | Rationale                                   | Concerns to check                            |
| -------------------------- | ------------------------------------------- | -------------------------------------------- |
| **Lumen**                  | Light, minimal, privacy-flavoured           | Very common word in software; likely crowded |
| **Vela**                   | Constellation (sails), short, pronounceable | Existing software projects                   |
| **Aureal**                 | Keeps a family resemblance to the codename  | Still close to "Aurelia"                     |
| **Northlight / Northwind** | Calm, directional, brandable                | Longer; corporate-sounding                   |
| **Solstice**               | Neutral, distinctive                        | Length, existing products                    |

No candidate is recommended yet. This table exists so the owner has a starting
point, not a decision.

## Centralised branding: how a rename stays cheap

| Surface                       | Where the name lives                                                                                                              | Rename cost                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| C++ compiled identity         | `chromium/overlay/.../aurelia_version.h` (generated from `config/chromium_version.json` -> `product.codename`)                    | regenerate one file                                    |
| WebUI strings                 | `chrome://aurelia` page reads `productCodename` from the same source; no hard-coded name in TS except test fixtures               | low                                                    |
| Design tokens CSS prefix      | `--aurelia-*` custom properties, generated from `packages/design-tokens/tokens.json`                                              | medium (mechanical rename + regeneration)              |
| Repository paths / GN targets | `chrome/browser/ui/webui/aurelia/`, `chrome/browser/resources/aurelia/`, target `//chrome/browser/ui/webui/aurelia`               | medium (paths appear in the patch and overlay)         |
| WebUI host                    | `chrome://aurelia` (`kChromeUIAureliaHost`)                                                                                       | medium; a second host can be aliased during transition |
| Preferences keys              | `aurelia.*` prefixes are deliberately **avoided** in the schema - prefs use functional groups (`privacy.*`, `dns.*`, `shields.*`) | none                                                   |
| Internal scheme               | `aurelia://` reserved in `packages/core` for future internal pages                                                                | medium if a page ships before the rename               |

## Irreversible identifiers (do not create these yet)

The following would make a rename expensive or impossible to do cleanly, so they
are deliberately **not** created while the codename is unconfirmed:

- public domain names and TLS certificates;
- Windows code-signing identities and MSIX/package identities
  (`Aurelia.Browser` as a stable publisher/product id);
- Windows registry keys, file-association ProgIDs and updater app GUIDs;
- the user-data directory name baked into a published build;
- extension/WebStore publisher identity;
- cloud sync bucket/project identifiers if they encode the name in a
  user-visible way.

When a name is chosen, this table changes and the migration cost is documented
before any of the above is created. Until then, development builds use the
codename and are clearly labelled as unsigned development builds
(`docs/RELEASE.md`).

## What is _not_ claimed

- No trademark search has been performed.
- No statement is made that any candidate name is available or safe.
- Nothing here asserts non-infringement.
