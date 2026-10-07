# Secure DNS policy

Aurelia ships with encrypted DNS (DNS-over-HTTPS) **on by default** and is
deliberately conservative about fallback. This document explains the policy, the
default resolver, and the rules that keep a fallback from silently downgrading
privacy.

Implementation: `packages/core/src/net/secure-dns.ts` (pure, unit-tested) plus
Chromium's own Secure DNS preferences at the integration layer.

## Default configuration

| Setting              | Default                         | Preference                     |
| -------------------- | ------------------------------- | ------------------------------ |
| Mode                 | `secure`                        | `dns.secureMode`               |
| Provider             | Aurelia default                 | `dns.providerId`               |
| Endpoint             | `https://dns.nextdns.io/cf9c1d` | `AURELIA_DEFAULT_DOH_TEMPLATE` |
| Encrypted redundancy | on                              | `dns.encryptedRedundancy`      |
| Plaintext fallback   | **off**                         | `dns.allowPlaintextFallback`   |

`cf9c1d` is a **public product configuration identifier**, not a secret: it
selects a NextDNS configuration profile. It grants no administrative access and
requires no credential. It is nevertheless kept in exactly one place in the
source tree (enforced by a repository test that scans the code for the literal),
and it is a _default_, not a lock-in: the user can select another provider,
enter a custom DoH URL, or turn secure DNS off.

**DNS queries are sent to NextDNS when this provider is selected.** That is a
disclosure, not a footnote - it is documented in [PRIVACY.md](../PRIVACY.md#data-flow-matrix)
and surfaced in the settings UI next to the provider choice.

## Modes

| Mode               | Behaviour                                                                          | Plaintext possible?                                                     |
| ------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `secure` (default) | DoH only. If no encrypted resolver is reachable, **resolution fails**.             | **No.** Encrypted redundancy adds other DoH resolvers, never plaintext. |
| `automatic`        | DoH attempted first; Chromium may use the system resolver when DoH is unavailable. | **Yes** - shown as a warning in the UI.                                 |
| `off`              | System resolver only.                                                              | Yes - shown as a warning.                                               |

The core rule: **privacy-preserving modes never silently downgrade to plaintext
DNS.** In `secure` mode a failure is visible (a page fails to load), which is a
better outcome than a silent leak that the user cannot detect.

## Encrypted redundancy

The requested fallback order is honoured **without** leaving the encrypted
transport:

```
1. the configured provider        (default: Aurelia default / NextDNS)
2. Quad9        https://dns.quad9.net/dns-query
3. Google       https://dns.google/dns-query
4. Cloudflare   https://cloudflare-dns.com/dns-query
```

These are appended as additional DoH servers in Chromium's
`DnsOverHttpsConfig` (a whitespace-separated list of URI templates), so a
resolver outage cannot become a privacy downgrade. A resolver is skipped if it
duplicates an earlier entry, so the list can never contain the same server
twice. Users who do not want third-party resolvers involved can disable
`dns.encryptedRedundancy`, which leaves exactly one resolver and keeps
fail-closed behaviour.

The same chain is used in `automatic` mode, but there Chromium is _also_ allowed
to reach for the system resolver, which is why that mode warns.

## Custom URLs

A custom DoH template is rejected unless it is:

- HTTPS (`http:` would defeat the purpose);
- free of credentials (`https://user:pass@host/...` would leak a secret into
  preferences, sync and logs);
- free of whitespace and control characters;
- a parseable absolute URL with a host.

Validation lives in `validateDohTemplate()` and is covered by unit tests,
including negative cases.

## What we do not claim

- Not all DNS behaviour is local: it is _encrypted to a third party_, not
  private from everyone.
- Upstream resolvers may log queries according to their own policies; the
  provider list in settings links to each provider's privacy policy.
- The local DNS/ad-block dashboard shows **only** what the browser observes
  locally. Aurelia has no access to NextDNS server-side analytics unless a user
  configures an API key, and no such key ships with the product.

## Test coverage

`packages/core/src/net/secure-dns.test.ts` asserts, among other things:

- the default endpoint is the documented NextDNS profile;
- `secure` mode never reports `plaintextFallbackPossible: true`;
- redundancy never introduces a non-HTTPS server and never duplicates one;
- `off` and `automatic` modes warn;
- credential-bearing and HTTP templates are rejected;
- an unknown provider id is an error, not a silent fallback.
