# Building Aurelia Browser

The authoritative guide is [docs/BUILDING-CHROMIUM.md](docs/BUILDING-CHROMIUM.md).

## Work on Aurelia code without Chromium

```bash
npm ci
npm test
node tools/ci/fast-checks.mjs
node tools/chromium/cli.mjs status
node tools/chromium/cli.mjs verify-patches --online
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the UI development harness
and other repository tooling.

## Chromium validation and compilation

Chromium validation is **manual-only** in
`.github/workflows/chromium-build.yml`. It runs on GitHub-hosted Windows x64
runners and offers `gn` (default), `targeted`, and explicitly selected `full`
levels. `full` re-runs the earlier checks in the same job and reaches
`autoninja chrome` only if those checks pass.

The standard `windows-2025` runner is expected to be blocked before Chromium
source sync: Aurelia requires 8 CPU cores, 32 GB RAM, and 150 GB free on the
Chromium destination volume. An eligible organization must configure the
GitHub-hosted Windows larger-runner label `windows-latest-8-cores`; the workflow
measures actual resources and never falls back silently. See
[docs/CI-BUILD-FEASIBILITY.md](docs/CI-BUILD-FEASIBILITY.md) for runner specs and
[docs/BUILDING-CHROMIUM.md](docs/BUILDING-CHROMIUM.md) for stages, evidence,
artifacts, and troubleshooting.

All Chromium compilation must run on GitHub-hosted Actions runners. Local and
self-hosted compilation is blocked by the build tooling. No successful
Chromium compilation or runtime smoke test has been recorded yet; neither may
be claimed until its required compiler/run evidence exists.
