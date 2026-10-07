# Privacy

Aurelia is a privacy-oriented browser. This document states exactly what leaves
your device, why, and how to stop it. It is written to be checkable against
`docs/NETWORK-CONNECTIONS.md` and the code, not to be reassuring.

**No claim of "100% privacy" is made anywhere in this project.** A browser that
resolves names and loads pages necessarily talks to the network. What matters is
that every conversation is intentional, disclosed and switchable.

## Summary

| Question                                                         | Answer                                                                                         |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Does Aurelia send telemetry to Aurelia infrastructure?           | **No.** There is no telemetry endpoint, and the product preference ships `false`.              |
| Does Aurelia ever receive your browsing history or visited URLs? | **No.** Nothing is sent to Aurelia-operated servers.                                           |
| Does Aurelia proxy your searches?                                | **No.** Search goes directly to the provider you selected.                                     |
| Is crash reporting on?                                           | **No.** Off by default, no endpoint configured.                                                |
| Is there an account requirement?                                 | **No.** The browser is fully functional offline and signed out.                                |
| Is cloud sync on?                                                | **No.** Off by default; nothing syncs until you enable it, and then only end-to-end encrypted. |
| Are there ads, sponsored tiles or news feeds?                    | **No.** The new tab page is a wallpaper, a clock and nothing else.                             |
| Is there a VPN?                                                  | **No.**                                                                                        |
| Is there an AI assistant?                                        | **No.** Translation is the only network-backed "smart" feature, and it is off by default.      |

## Local data

| Data                                                                      | Where it lives                                                                              | Notes                                                                                                                                                         |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| History, bookmarks, downloads, sessions                                   | Profile directory on your device                                                            | Never uploaded unless you explicitly enable sync                                                                                                              |
| Passwords                                                                 | Encrypted vault, key protected by the OS secure store (DPAPI on Windows, Keychain on macOS) | Never in plaintext on disk; E2EE if synced                                                                                                                    |
| Cookies and site data                                                     | Profile directory                                                                           | Private windows are not persisted                                                                                                                             |
| Private-window data                                                       | Memory only                                                                                 | History, cookies and session state disappear when the window closes (tested)                                                                                  |
| Local statistics (blocked requests, DNS activity observed by the browser) | On your device                                                                              | For the local dashboard; never transmitted. Aurelia has no access to NextDNS server-side analytics unless you configure an API key yourself - and none ships. |

## Data-flow matrix

Every default outbound flow, what it exposes, and how to disable it.

| #   | Destination                                   | What is sent                                                                | Trigger                                                                              | Default                        | Disable with                                                                                              |
| --- | --------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| 1   | **NextDNS** (`dns.nextdns.io/cf9c1d`)         | DNS queries (hostnames you resolve) + your IP address, as with any resolver | Any name resolution                                                                  | **On** (encrypted DNS default) | Choose another provider, set a custom DoH URL, or turn secure DNS off; `dns.providerId`, `dns.secureMode` |
| 2   | **Quad9 / Google / Cloudflare DNS**           | Same as above                                                               | Only if the primary encrypted resolver is unreachable and encrypted redundancy is on | On (fallback only)             | `dns.encryptedRedundancy` = off                                                                           |
| 3   | **Search provider (default: Google)**         | The search terms you submit                                                 | You submit a search                                                                  | On (only when you search)      | Change the search engine; `search.engineId`                                                               |
| 4   | **Search provider (default: Google)**         | Partial query text as you type (suggestions)                                | Typing in the omnibox                                                                | On                             | `search.suggestions` = off, or High Privacy Mode                                                          |
| 5   | **Google Safe Browsing**                      | Truncated URL hash prefixes; enhanced mode sends more                       | A navigation needing a safety lookup                                                 | On (`standard`)                | `privacy.safeBrowsing` = off, or `standard` instead of `enhanced`                                         |
| 6   | **Sites you have not opened yet**             | The fact that a connection is anticipated (origin/hostname)                 | Prefetch, preconnect, DNS prefetch heuristics                                        | On                             | Turn each predictor off, or High Privacy Mode (all off)                                                   |
| 7   | **Translation provider** (none configured)    | The text you choose to translate                                            | Explicit action, or an auto-translate rule you created                               | **Off**                        | `translation.mode` = off, `translation.providerId` = none                                                 |
| 8   | **Sync backend** (none configured)            | End-to-end encrypted payloads + limited metadata                            | After you enable sync and sign in                                                    | **Off**                        | `sync.enabled` = off                                                                                      |
| 9   | **Extension update endpoints**                | Update requests for extensions you installed                                | Extension update checks                                                              | Only if you install extensions | Remove extensions; enterprise policy (planned)                                                            |
| 10  | **Chromium component updates** (CRLSet, etc.) | Inherited Chromium behaviour                                                | Background                                                                           | Inherited                      | Inherited Chromium switches                                                                               |

Notes that matter:

- **Safe Browsing is not local.** Standard mode sends partial URL hashes to
  Google. Aurelia does not pretend otherwise. If you want no such lookups, turn
  it off and accept the reduced protection - the choice is yours, and the
  settings UI says so.
- **DNS is not "private" - it is encrypted to someone.** Encrypted DNS hides the
  query from your network, not from the resolver you chose. Provider privacy
  policies are linked in settings.
- **Search suggestions are a keystroke stream.** High Privacy Mode disables them
  by design (see `packages/core/src/prefs/derived.ts`).
- **Prefetching contacts sites you never chose.** High Privacy Mode disables
  prefetch, preconnect and DNS prefetch together, with an explanation attached
  to each disabled control.

## High Privacy Mode

One switch that turns off non-essential network chatter. It disables search
suggestions, prefetch, preconnect and DNS prefetch. Crucially, the browser does
not silently rewrite your stored preferences: it computes _effective_ values and
shows you why each control is off, so the setting is never mysterious.

High Privacy Mode does **not** claim to make you anonymous, does not disable
necessary traffic (DNS, the pages you load), and does not change your IP address.

## Crash reporting and diagnostics

- Crash reporting ships **off**. There is no endpoint configured, so even
  enabling the preference cannot upload anything to Aurelia infrastructure
  today.
- If a crash-reporting endpoint is ever added, this document will list what
  would be uploaded, and the default will remain off.
- Diagnostics export is always a manual action; the bundle uses an allowlist of
  fields (never "everything minus secrets") and excludes history, URLs, form
  data, and anything from the vault.

## Accounts, sync and deletion

- The browser works fully without an account. No feature requires one.
- Sync is optional and E2EE: the server receives ciphertext, not plaintext
  passwords or browsing data. Metadata leakage (blob sizes, timestamps) is
  documented in `docs/SYNC-ARCHITECTURE.md` rather than hidden.
- **Account deletion deletes cloud data**, and the client verifies it.
- "Sync off" is a real state: no sync traffic occurs at all.

## Anti-fingerprinting policy

Aurelia avoids techniques that make users _more_ identifiable. There is no
per-site randomisation of fingerprintable values, no fake User-Agent strings,
and no "random noise" canvas mode - those approaches create a distinctive,
detectable signature. Instead: block trackers, strip tracking parameters
(without breaking unknown parameters that sites rely on), restrict WebRTC to
public interfaces, block third-party cookies by default, and stay one consistent
identity per profile.

## Search

Google is the initial default search engine by product decision. It is a
default, not a lock-in:

- change it in settings, with custom engine support;
- disable suggestions independently;
- High Privacy Mode disables remote suggestions;
- queries are sent directly to the provider and never through Aurelia
  infrastructure.

## What this document promises you can check

| Claim                                               | How to check it                                                                                                |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| No telemetry endpoint                               | Search the source; there is no analytics or telemetry code, and `privacy.telemetryEnabled` defaults to `false` |
| Website CSS and custom UI CSS cannot execute script | `docs/threat-models/CUSTOM-CSS.md` + planned tests                                                             |
| Private windows are not persisted                   | Planned test: nothing appears in history or the profile after closing a private window                         |
| Secure DNS fails closed                             | `packages/core/src/net/secure-dns.test.ts`                                                                     |
| High Privacy Mode disables exactly what it says     | `packages/core/src/prefs/store.test.ts`                                                                        |
| Every default connection is listed                  | `docs/NETWORK-CONNECTIONS.md`, checked against an automated allowlist test (M3)                                |

Where a claim has no test yet, this project marks it as pending rather than
asserting it. See `docs/PROJECT-STATUS.md`.
