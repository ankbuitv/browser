# Threat model

This document covers the product-level threats. Feature-specific threat models
live in `docs/threat-models/`:

- [SYNC.md](threat-models/SYNC.md) - optional cloud sync and E2EE
- [PASSWORD-MANAGER.md](threat-models/PASSWORD-MANAGER.md) - password storage and autofill
- [CUSTOM-CSS.md](threat-models/CUSTOM-CSS.md) - browser-UI CSS and website CSS

Infrastructure: [CI-SECURITY.md](CI-SECURITY.md).

## What Aurelia is, in security terms

A Chromium-based browser with a small, auditable delta. Aurelia does **not**
reimplement browsing security: sandboxing, site isolation, TLS verification,
the certificate store and the network stack are Chromium's, and Aurelia's value
is that fixes arrive quickly because the delta is small and discoverable.

That framing matters, because it defines what we must protect: **the delta**.
Any change that makes the delta larger, harder to verify or slower to update is
a security regression even if it adds a nice feature.

## Assets

| Asset                                     | Consequence of compromise                               |
| ----------------------------------------- | ------------------------------------------------------- |
| Passwords and autofill data               | Account takeover on other sites                         |
| Cookies/session tokens                    | Account takeover without a password                     |
| Browsing history and bookmarks            | Profiling, coercion, disclosure                         |
| Sync encryption secrets and recovery keys | Decryption of everything synced                         |
| The update mechanism                      | Arbitrary code execution for all users                  |
| The installer                             | Same, before the browser ever runs                      |
| Extension capabilities                    | Everything the extension can reach                      |
| User trust in default settings            | Somewhat unquantifiable, and the thing most easily lost |

## Adversaries considered

| Adversary                                   | Capability                       | Primary defences                                                                                                                                                                                        |
| ------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remote website                              | Runs untrusted content           | Chromium sandbox, site isolation, strict WebUI CSP, no privileged APIs exposed to content                                                                                                               |
| Malicious or compromised extension          | Extension APIs                   | Manifest V3 scope, permission prompts, enterprise allow/blocklists, no privileged bridge from extensions into WebUI                                                                                     |
| Network attacker                            | Observes/modifies traffic        | HTTPS-only mode, fail-closed secure DNS, no TLS-verification weakening anywhere, HSTS                                                                                                                   |
| Malicious resolver                          | Sees DNS queries                 | DoH by default, encrypted-only fallback chain                                                                                                                                                           |
| Local unprivileged user                     | Can run processes on the machine | OS key protection for secrets (DPAPI/Keychain), profile separation                                                                                                                                      |
| Local admin / malware                       | Full local access                | **Out of scope for protection** - documented honestly: malware with the user's privileges can read browser data. We minimise it (locked password manager, key protection) but never claim to defeat it. |
| Server operator (sync backend)              | Stores synced blobs              | E2EE: server sees ciphertext and limited metadata only                                                                                                                                                  |
| Actor who compromises the sync backend      | Reads/writes stored data         | E2EE, authenticated encryption, key separation; metadata leakage is documented in `threat-models/SYNC.md`                                                                                               |
| Network attacker against the update channel | Redirects update checks          | HTTPS + signature verification (once signing exists); unsigned builds are labelled and never auto-updated silently                                                                                      |
| Malicious contributor / dependency          | Introduces code                  | Small delta, review requirement, pinned actions, lockfiles, no unsigned binaries, secret scanning                                                                                                       |
| State-level adversary with OS access        | Everything local                 | Not defended. No product should claim this.                                                                                                                                                             |

## Abuse cases we explicitly refuse

| Temptation                                                             | Why it is refused                                                                                                        |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Disabling the sandbox to make a feature work                           | Sandbox is non-negotiable.                                                                                               |
| Turning off site isolation for performance                             | Same.                                                                                                                    |
| Adding certificate-error bypasses for "convenience"                    | Would break the entire trust model.                                                                                      |
| Exposing privileged browser APIs to web content for a smoother feature | The reason `chrome://` WebUIs are internal pages.                                                                        |
| Silent telemetry "to improve the product"                              | No telemetry exists; defaults cannot flip silently because the default is `false` and the docs say there is no endpoint. |
| Randomised fingerprints that make each user unique                     | Aurelia never adds entropy. See the anti-fingerprinting section below.                                                   |
| Bypassing SmartScreen to ship unsigned builds quietly                  | Unsigned builds are labelled; no bypass is attempted or documented as a workaround.                                      |
| Home-grown cryptography for sync or passwords                          | Prohibited: reviewed libraries and established primitives only.                                                          |

## Anti-fingerprinting stance

Fingerprinting defences can backfire: randomising a value per-site can make a
user _more_ identifiable than leaving it at the browser default. Aurelia
therefore only uses techniques that reduce distinguishability or are
Chromium-supported and well understood:

- reduce the information surface (block trackers, strip tracking parameters,
  restrict WebRTC to public interfaces, block third-party cookies by default);
- keep one consistent identity per profile rather than random noise per site;
- never fake the User-Agent to a string no other browser sends;
- avoid per-session randomisation of values that sites aggregate over time.

`privacy.fingerprintProtection` offers `off` and `standard`; there is no "make
me random" mode, because that is not a defence.

## WebUI surface rules

Aurelia adds `chrome://aurelia`. Rules for it and every future internal page:

1. It is an **internal** WebUI (`DefaultInternalWebUIConfig`): web content
   cannot navigate to it.
2. It runs with the trusted-types CSP from `SetupWebUIDataSource()` and
   `frame-ancestors 'none'`.
3. No page may read profile data, browsing history or credentials without an
   explicit, reviewed Mojo interface. The current page has no message handler at
   all - it renders compile-time provenance strings only.
4. DOM is built programmatically (`createElement`/`textContent`), never with
   `innerHTML`, so trusted-types guarantees hold.
5. Any new privileged capability needs its own threat-model section here before
   review, and tests that prove the boundary.

## Reporting

Security issues go through [SECURITY.md](../SECURITY.md) - privately, never in a
public issue. There is no bug bounty at this time; credit is given in the
release notes of the fixing version unless the reporter prefers otherwise.
