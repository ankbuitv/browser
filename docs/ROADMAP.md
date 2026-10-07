# Roadmap

Milestones are tracked as GitHub milestones. Status language is defined in
[PROJECT-STATUS.md](PROJECT-STATUS.md) and is used strictly:
**NOT STARTED · SCAFFOLDED · IMPLEMENTED · INTEGRATED · TESTED · VERIFIED**.

Security updates take priority over feature work at every point on this list.

## M0 — Repository & Chromium architecture

| Item                                                               | State                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository audit                                                   | TESTED (recorded in [REPOSITORY-AUDIT.md](REPOSITORY-AUDIT.md))                                                                                                                                                                                                                                             |
| Chromium pin (`155.0.8059.40`, exact SHA)                          | TESTED (config validated, digest-verified)                                                                                                                                                                                                                                                                  |
| Reproducible checkout tooling                                      | IMPLEMENTED (never executed against a real checkout)                                                                                                                                                                                                                                                        |
| Overlay + patch mechanism                                          | TESTED (patch verified against the pinned revision)                                                                                                                                                                                                                                                         |
| Patch-application test                                             | TESTED (offline + online)                                                                                                                                                                                                                                                                                   |
| GN integration strategy                                            | SCAFFOLDED (pattern taken from upstream `webui_gallery`; **not compiled**)                                                                                                                                                                                                                                  |
| Full build command documentation                                   | IMPLEMENTED ([BUILDING-CHROMIUM.md](BUILDING-CHROMIUM.md))                                                                                                                                                                                                                                                  |
| Heavy build workflow + required runner                             | IMPLEMENTED (never executed; runner not yet provisioned)                                                                                                                                                                                                                                                    |
| One Aurelia-owned component wired into Chromium                    | SCAFFOLDED (code written, **not compiled**)                                                                                                                                                                                                                                                                 |
| Local low-resource Windows path (`LOW_RESOURCE_EXPERIMENT`)        | IMPLEMENTED (one command, policy gate, disk guard, resumable modes; **never executed on Windows**)                                                                                                                                                                                                          |
| Fast CI                                                            | TESTED                                                                                                                                                                                                                                                                                                      |
| Supply-chain policy checks + secret scan                           | TESTED                                                                                                                                                                                                                                                                                                      |
| Documentation set (architecture, security, privacy, build, policy) | TESTED                                                                                                                                                                                                                                                                                                      |
| **Exit criteria**                                                  | a builder that meets the documented minimums produces a runnable binary and the smoke test passes → then M1 can be called complete. A local `LOW_RESOURCE_EXPERIMENT` run does not satisfy this by itself: it is an attempt on an explicitly below-reference machine, and its result is reported either way |

## M1 — Desktop shell

| Item                                                                     | State                                                       |
| ------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Original Aurelia UI shell (top tabs + omnibox, glass-lite visual system) | NOT STARTED                                                 |
| Horizontal tabs (default)                                                | NOT STARTED                                                 |
| Omnibox behaviour (classification logic)                                 | IMPLEMENTED (unit-tested; not wired to a browser)           |
| Command palette (Ctrl+K / Cmd+K)                                         | NOT STARTED                                                 |
| Light / dark / system appearance                                         | SCAFFOLDED (design tokens generated; preferences defined)   |
| New tab wallpapers (original/built-in, no news/ads/AI)                   | NOT STARTED                                                 |
| Settings foundation                                                      | SCAFFOLDED (preference schema + validation)                 |
| Accessibility baseline (focus, contrast, reduced motion, forced colours) | SCAFFOLDED (rules written for the first WebUI; needs audit) |

## M2 — Core browser UX

Vertical tabs (collapsible rail) · tab groups · split view (up to 3) ·
persistent workspaces · session restore control · compact/focus modes · theme
system with import/export · custom browser-UI CSS · opt-in per-site website CSS
(with [threat model](threat-models/CUSTOM-CSS.md) first). All NOT STARTED.

## M3 — Privacy and blocking

Ad/tracker blocking at the Chromium network layer (filter-list compatible) ·
EasyList/EasyPrivacy support · cosmetic filtering · per-site controls and
temporary disable · blocked-request counts · third-party cookie controls ·
tracking-parameter stripping (implemented, unit-tested) · Global Privacy Control
· HTTPS-only mode · WebRTC policy · Safe Browsing controls ·
High Privacy Mode (policy implemented; enforcement in the browser pending) ·
local DNS/blocking dashboard · automated network/privacy tests.

## M4 — Browser data

Profiles · bookmarks · history · downloads · password manager (threat model
first) · autofill · imports from Chrome/Edge/Firefox where licensing and
platform support allow · reader mode · PDF viewer · media controls ·
picture-in-picture · screenshots · memory saver / tab sleeping · battery saver ·
task manager surface.

## M5 — Sync (optional, off by default)

Provider abstraction → Supabase reference implementation **if** its terms are
verified without a payment card → E2EE ([architecture](SYNC-ARCHITECTURE.md),
[threat model](threat-models/SYNC.md)) → recovery keys → device management →
account deletion → tests that prove plaintext never leaves the device.

## M6 — Extensions and compatibility

Manifest V3 focus · Chromium extension compatibility baseline · Web Store
feasibility under current Chromium licensing/policy (documented, never
circumvented) · compatibility test matrix. No long-term MV2 patches. No separate
Aurelia extension marketplace.

## M7 — Enterprise

Chromium policy integration · managed bookmarks · URL allow/blocklists ·
extension allow/blocklists · managed DNS and privacy/ad-block policy ·
Windows Group Policy / registry policies · macOS managed preferences (later) ·
MSI/PKG deployment · organization model and audit-log architecture ·
web admin console (later). Privacy is never weakened silently; the browser
always shows "managed by your organization" when policy is active.

## M8 — Installer and updates

Original animated installer experience (own artwork, reduced motion, high DPI,
accessibility, no bundled software, no pre-ticked offers) · Windows packaging
(Burn/WiX and MSI for enterprise) · update architecture with Stable/Beta/Nightly
channels · notify-first behaviour with urgent security updates surfaced ·
unsigned development release flow · signing documentation. Signing material
stays out of the repository; unsigned builds are labelled as such and SmartScreen
is never bypassed.

## M9 — Desktop MVP

Security review · performance benchmarks · accessibility audit · regression
suite · privacy documentation audit · distributable Windows development preview.
Definition of the MVP: a real, usable Chromium browser with the MVP feature list
in the README, honest statuses and no unverified claims.

## Later

macOS (Intel + Apple Silicon; signing/notarisation requires an Apple Developer
account) · Linux · Android · iOS/iPadOS (Apple's engine and distribution rules
are respected; Blink is never promised where platform policy prevents it).
