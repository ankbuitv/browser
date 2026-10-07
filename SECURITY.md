# Security policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Use GitHub's private vulnerability reporting on this repository:
**Security → Report a vulnerability** (Security Advisories). If that is
unavailable to you, contact the maintainer (`@ankbuitv`) through GitHub and ask
for a private channel - do not include details in a public thread.

Please include:

- affected component (browser build, tooling, CI, docs claim);
- reproduction steps or a proof of concept;
- impact assessment: what an attacker gains;
- whether it also affects upstream Chromium (if so, it should also be reported
  to the Chromium project).

### What to expect

| Stage                                | Target                                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Acknowledgement                      | within 7 days                                                                                  |
| Initial assessment (severity, repro) | within 14 days                                                                                 |
| Fix or documented mitigation         | depends on severity; security-critical issues in the delta take priority over all feature work |
| Disclosure                           | coordinated; you will be credited unless you prefer otherwise                                  |

There is no bug bounty at this time. Good-faith research is welcome; testing must
not harm other users, degrade services, or access other people's data.

## Scope

In scope:

- Aurelia's own code: `packages/`, `chromium/overlay/`, `tools/`;
- the patch set (`chromium/patches/`) and the pin/verification tooling;
- CI/CD configuration and the release process;
- security-relevant documentation claims that are false (a false security claim
  is a vulnerability here).

Out of scope (report upstream instead, but tell us if it affects how we build):

- vulnerabilities in Chromium itself that are not caused by Aurelia's delta;
- vulnerabilities in upstream web platform behaviour;
- the user's own machine being compromised while a vault is unlocked
  (documented in `docs/threat-models/PASSWORD-MANAGER.md`).

## Security rules for this project

These are non-negotiable. A change that violates one of them will be rejected:

1. Never disable the Chromium sandbox to make a feature work.
2. Never disable site isolation for convenience.
3. Never weaken TLS/certificate verification, or add certificate-error bypasses.
4. No hidden remote control, hidden telemetry, or silent data collection.
5. Never download or execute unsigned arbitrary code as part of the product's
   update path.
6. Never expose privileged browser APIs to web content.
7. Never store passwords or tokens in plaintext.
8. No home-grown cryptography. Reviewed libraries and standard primitives only.
9. Never bypass OS security warnings, and never instruct users to bypass
   SmartScreen or Gatekeeper.
10. Never weaken a Chromium security or privacy mechanism to make theming,
    extensions or customisation easier.

## How this repository enforces security by construction

| Control                                                                        | Where                                                        |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Pin cannot be a moving ref; upstream origin must be expected                   | `tools/chromium/lib/config.mjs` + tests                      |
| Patches cannot touch `third_party/`, `sandbox/`, `crypto/`, `base/allocator/`  | `tools/chromium/lib/patch.mjs` + tests                       |
| Patch must apply to the exact pinned revision, byte-for-byte                   | `cli.mjs verify-patches --online` (fast CI)                  |
| No Node runtime artifacts in the browser overlay                               | `tools/ci/fast-checks.mjs` + tests                           |
| Actions pinned to SHAs on an approved list                                     | `tools/ci/workflow-policy.mjs`, `tools/ci/actions-pins.json` |
| Minimal CI token permissions; no `pull_request_target`; no secrets on fork PRs | `tools/ci/workflow-policy.mjs`                               |
| No credentials in the repository                                               | `tools/ci/secret-scan.mjs`                                   |
| Internal WebUI not reachable from web content; strict CSP; no `innerHTML`      | `docs/THREAT-MODEL.md`, `chromium/overlay/**`                |
| Overlay never disables a security switch                                       | `tests/tools/repository.test.mjs`                            |
| Security-sensitive features require a threat model first                       | `docs/threat-models/**`                                      |

## Supported versions

Nothing is released yet; there are no supported versions and no security update
channel. Once a Stable build exists, this section will state the support window
and the update policy (notify-first, security updates surfaced urgently, integrity
failure refuses to install).

## Disclosure of design decisions

Where Aurelia makes a privacy/security trade-off (for example, NextDNS as the
default resolver, or Google Safe Browsing lookups), it is documented in
[PRIVACY.md](PRIVACY.md) and `docs/NETWORK-CONNECTIONS.md` rather than left for
users to discover.
