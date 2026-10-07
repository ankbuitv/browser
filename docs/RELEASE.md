# Release engineering

**Current state: no release exists, and none can be produced yet.** This
document records the intended process, the constraints that block a real release
today, and the signing requirements that must be satisfied before one ships.

## Channels

| Channel     | Purpose                                                 | Chromium pin              | Audience                                  |
| ----------- | ------------------------------------------------------- | ------------------------- | ----------------------------------------- |
| **Nightly** | Bleeding edge, may be dev/canary based, unsupported     | may track a dev milestone | contributors, testers who accept breakage |
| **Beta**    | Feature preview, security-verified, one milestone ahead | current beta milestone    | early adopters                            |
| **Stable**  | Default; receives security updates first                | latest stable patch level | everyone                                  |

Channel is recorded in the build (`kBuildChannel` in the generated version
header) and surfaced on `chrome://aurelia` and in the updater UI.

## Update behaviour (product requirement)

1. Updates are **notify-first**. A background update must not tear down a busy
   browsing session mid-task.
2. **Security updates surface urgently**: visible, persistent, and explained as
   a security update - still without force-closing the browser or discarding
   open tabs.
3. The user can always check for updates manually and see the current channel,
   version and last check time.
4. An update that fails integrity verification **must refuse to install** and
   must say so.
5. Nightly builds never silently upgrade a user to Stable or vice versa.

## Windows artifacts (planned)

| Artifact                         | Purpose               | Notes                                                                                                       |
| -------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------- |
| `AureliaSetup-<version>-x64.exe` | Consumer installer    | Custom animated installer (M8). Burn/bootstrapper over an MSI, or MSIX where it fits enterprise deployment. |
| `Aurelia-<version>-x64.msi`      | Enterprise deployment | MSI properties for silent install, install location, shortcut control, default-browser intent.              |
| ARM64 equivalents                | Windows on ARM        | Only once the toolchain path is verified; do not promise it earlier.                                        |
| `SHA256SUMS`                     | Integrity             | Every artifact gets a checksum published alongside it.                                                      |
| `*-unsigned-dev` suffix          | Development builds    | Clearly labelled as unsigned.                                                                               |

macOS later (DMG/PKG), Linux later (packages per distro policy).

## Signing reality (documented, not worked around)

| Platform | Status                         | Consequence                                                                                                                                                                                    |
| -------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows  | **No certificate exists**      | Builds are unsigned: SmartScreen will warn, and users must decide for themselves. The project does not instruct anyone to bypass SmartScreen, and does not ship a "click here to ignore" flow. |
| macOS    | **No Apple Developer account** | No notarisation possible, therefore no supported macOS release yet. macOS is explicitly non-blocking for the Windows plan.                                                                     |

Signing material rules:

- never committed, never pasted into issues, never stored in the repository;
- consumed only from CI secrets (release workflow) or from a human's hardware
  token;
- a build that is not signed must never claim to be signed, and must not be
  labelled "stable".

## Release checklist (once signing exists)

1. Milestone complete: all exit criteria met, statuses accurate.
2. `node tools/chromium/cli.mjs status` shows the intended pin and patch set.
3. Heavy build green on the builder, including the runtime smoke test.
4. Feature tests for the milestone green; results linked in the release PR.
5. Privacy documentation audit: `PRIVACY.md`, `docs/NETWORK-CONNECTIONS.md` and
   `SECURITY.md` match what the build actually does.
6. Changelog generated from Conventional Commits since the last tag, with
   security fixes called out first.
7. Artifacts built **from a tagged commit** (reproducible: same pin, same
   commit), signed, checksummed.
8. Checksums and signatures published with the release.
9. Unsigned development builds published only with the `-unsigned-dev` label.

## Versioning

- Product version: `MAJOR.MINOR.PATCH` in
  `config/chromium_version.json` (`product.version`), currently `0.1.0`.
- The Chromium version is reported separately and never conflated with the
  product version.
- The patch-set version (`patchSet.version`) increments whenever the patch set
  changes, and is recorded in the binary so a support request can identify the
  exact delta.

## Reproducibility

A release must be reproducible from:

```
repository commit + Chromium pin + depot_tools revision + GN args
```

`tools/chromium/sync.mjs` writes those four facts into its output, and the
heavy build workflow records them in its build report. If a build cannot be
reproduced from those four facts, the build is not releaseable.

## Not automated yet, on purpose

- No workflow pushes a tag, a release or a binary.
- No automatic Chromium update merge (`updatePolicy.automaticMerge: false`).
- No auto-update server exists; the product's updater integration is part of M8
  and will not be switched on before signing exists, because an unsigned
  auto-update channel is a code-execution channel.
