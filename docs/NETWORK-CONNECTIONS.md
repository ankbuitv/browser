# Default outbound connections

The goal of this document is that **every** connection a stock Aurelia build
makes can be found in a table, with a reason, and can be turned off. If a
connection is not in this table, it is a bug.

Scope note: Aurelia is a Chromium fork. This table lists only connections that
Aurelia's own configuration _introduces or changes_ relative to stock Chromium.
Chromium's own baseline (for example, component updater downloads) is inherited
and is out of scope here; it is also the reason `High Privacy Mode` and
per-feature toggles exist rather than a blanket "offline mode" claim.

Status legend: **NOT VERIFIED** means no build exists yet to observe traffic
from. Automated verification is planned in M3
(see [TESTING.md](TESTING.md#6-privacy-and-network-tests-planned-m3)).

## Intentional default connections

| #   | Destination                                                      | Purpose                                                | Trigger                                                          | Data potentially transmitted                                                                         | On by default                         | How to disable                                                    | Kill switch / preference                                     |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------ |
| 1   | `dns.nextdns.io` (NextDNS profile `cf9c1d`)                      | Encrypted DNS resolution (DoH)                         | Resolving a hostname                                             | Hostnames you resolve and your IP address (to the resolver)                                          | Yes                                   | Choose another provider, a custom DoH URL, or turn secure DNS off | `dns.secureMode`, `dns.providerId`                           |
| 2   | `dns.quad9.net`, `dns.google`, `cloudflare-dns.com`              | Encrypted DNS redundancy if the primary resolver fails | Primary DoH resolver unreachable                                 | Same as above                                                                                        | Yes (fallback only)                   | Disable encrypted redundancy, or select a single provider         | `dns.encryptedRedundancy`                                    |
| 3   | The selected search provider (default: `www.google.com`)         | Search queries submitted from the omnibox              | User submits a search                                            | The query text                                                                                       | Yes (only when a search is performed) | Change the search engine in settings                              | `search.engineId`, `search.template`                         |
| 4   | The selected search provider                                     | Search suggestions while typing                        | Typing in the omnibox                                            | Partial query text (typically few keystrokes)                                                        | Yes                                   | Turn suggestions off (also disabled by High Privacy Mode)         | `search.suggestions`, `privacy.highPrivacyMode`              |
| 5   | Google Safe Browsing (`safebrowsing.googleapis.com` and friends) | Phishing/malware protection                            | A navigation that requires a lookup                              | Truncated URL hash prefixes; see Chromium's documented protocol. Enhanced mode sends more            | Yes (`standard`)                      | Set Safe Browsing to off, or choose a level you accept            | `privacy.safeBrowsing`                                       |
| 6   | Sites you visit, before you "chose" them                         | Prefetch / preconnect / DNS prefetch                   | Chromium's prediction heuristics                                 | The fact of an anticipated connection (origin/hostname)                                              | Yes                                   | Turn the individual predictors off (all off in High Privacy Mode) | `search.prefetch`, `search.preconnect`, `search.dnsPrefetch` |
| 7   | The configured translation provider (none by default)            | Page/text translation                                  | Explicit user action, or an auto-translate rule the user created | The text being translated                                                                            | **No** (mode is `off`)                | Keep `translation.mode: off`, or set the provider to `none`       | `translation.mode`, `translation.providerId`                 |
| 8   | Supabase project (or self-hosted sync backend)                   | Optional cloud sync                                    | Only after the user enables sync and signs in                    | End-to-end encrypted payloads and metadata described in [SYNC-ARCHITECTURE.md](SYNC-ARCHITECTURE.md) | **No** (no account, sync off)         | Keep sync off; sync is never required by any feature              | `sync.enabled`                                               |
| 9   | Extension update endpoints                                       | Keeping installed extensions updated                   | Extension update check                                           | Extension update request (Chromium behaviour)                                                        | Only if the user installs extensions  | Remove extensions; enterprise policy can restrict them            | Future policy `ExtensionInstallBlocklist`                    |
| 10  | CRLSet / component updater (Chromium)                            | Security data updates                                  | Background                                                       | Inherited Chromium behaviour                                                                         | Inherited                             | Inherited Chromium switches; documented for completeness          | -                                                            |

## Explicitly not present

| Not present                                   | Why it matters                                                                                                                                           |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aurelia telemetry endpoint                    | There is none. `privacy.telemetryEnabled` ships `false`, and the documentation states plainly that the product has no telemetry infrastructure.          |
| Aurelia-hosted search proxy                   | Searches go directly to the selected provider. Aurelia never proxies queries through its own infrastructure.                                             |
| Aurelia sync by default                       | No account exists by default, and sync is off until the user turns it on.                                                                                |
| Crash-report upload                           | Off by default. No endpoint is configured, so `on` cannot silently upload to Aurelia infrastructure even if a user enables it before an endpoint exists. |
| Analytics, advertising or "engagement" pings  | Not a product goal; not implemented.                                                                                                                     |
| VPN                                           | Out of scope by design.                                                                                                                                  |
| AI assistant / LLM sidebar / autonomous agent | Out of scope by design. Translation is the only network-backed "smart" feature and it is opt-in (row 7).                                                 |

## Verification plan (M3)

Automated tests must detect unexpected requests in these states:

| Scenario                         | Expected outbound traffic                                                                          |
| -------------------------------- | -------------------------------------------------------------------------------------------------- |
| First launch (fresh profile)     | DNS only (encrypted), no search/suggestion traffic until the user types                            |
| New tab page                     | No network requests from Aurelia's new tab page (wallpaper is local or built in)                   |
| Normal browsing to a static site | DNS + the site's own requests                                                                      |
| Private (incognito) window       | Same as normal browsing, with nothing persisted locally                                            |
| High Privacy Mode                | DNS + explicitly requested pages only: no suggestions, no prefetch, no preconnect, no DNS prefetch |
| Sync off                         | No sync traffic at all                                                                             |

The tests will use the built browser with a proxy/CDP request capture, and will
fail on any request whose origin is not in an allowlist derived from this table.
This is deliberately a _test_, not a promise: today the table is a design
statement, and the `NOT VERIFIED` markers reflect that nothing has been measured.

## Changelog rule

Any pull request that adds a network feature must add a row here **and** to the
data-flow matrix in [PRIVACY.md](../PRIVACY.md#data-flow-matrix). Reviewers
should reject a connection that has no row.
