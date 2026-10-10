# Local Windows Chromium build path (retired)

> **Retired:** Aurelia no longer permits Chromium compilation on local or
> self-hosted machines. All Chromium compilation must run on GitHub-hosted
> Actions runners through `.github/workflows/chromium-build.yml`.

The former `LOW_RESOURCE_EXPERIMENT`, local bootstrap, and resumable Windows
build instructions are intentionally withdrawn. A low-resource profile is not a
fallback around the current 8-core / 32-GB RAM / 150-GB free-disk gate. The
legacy `tools/windows/bootstrap-build.ps1` entry point exits without doing
work, and `tools/chromium/build.mjs` keeps only its dry-run plan; its legacy
executor always throws. Neither path can sync or compile Chromium.

Use [CI-BUILD-FEASIBILITY.md](CI-BUILD-FEASIBILITY.md) for runner requirements
and [BUILDING-CHROMIUM.md](BUILDING-CHROMIUM.md) for the current manual workflow,
validation levels, logs, artifacts, and evidence policy. No local Chromium
compilation has been attempted or claimed.
