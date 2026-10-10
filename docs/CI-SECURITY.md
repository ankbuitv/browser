# CI and release infrastructure threat model

CI is part of the product's attack surface: it compiles the browser, handles
update metadata and will eventually sign artifacts. This document states the
threats, the controls, and what is deliberately not automated.

## Assets

| Asset                                      | Why it matters                                                        |
| ------------------------------------------ | --------------------------------------------------------------------- |
| The pinned Chromium revision and patch set | A tampered pin or patch ships someone else's code in Aurelia's name   |
| Build artifacts                            | `chrome.exe` is what users run                                        |
| Signing keys (future)                      | Compromise means undetectable malicious updates                       |
| `GITHUB_TOKEN` and any repository secret   | Write access to the repository                                        |
| GitHub-hosted build runner                 | Ephemeral VM, pinned checkout, compiler outputs, and uploaded reports |

## Threats and controls

| Threat                                              | Control                                                                                                                                                                                                    |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Third-party action is compromised or a tag is moved | Every action is pinned to a full commit SHA, and the SHA must appear in `tools/ci/actions-pins.json`. `tools/ci/workflow-policy.mjs` fails the build otherwise.                                            |
| Untrusted fork code runs with a privileged token    | `pull_request_target` is forbidden (policy check). Workflows triggered by `pull_request` never reference `secrets.*`.                                                                                      |
| Excessive token scope                               | Every workflow declares an explicit `permissions:` block; the default is `contents: read`. `write-all` is a policy failure.                                                                                |
| Secret exfiltration through logs                    | No workflow prints secrets. `tools/ci/secret-scan.mjs` blocks credentials in the repository, including a scan of tracked files and forbidden file names.                                                   |
| Malicious PR modifies a workflow to exfiltrate      | Workflow files are covered by the same PR review as code, and the policy check runs on every PR (including PRs that change workflows, since the check reads the working tree).                             |
| Untrusted code reaches a Chromium compiler          | The Chromium validation workflow is `workflow_dispatch`-only, has `contents: read`, does not reference secrets, and checks out without persisting credentials.                                             |
| Resource exhaustion during source sync or compile   | A preflight enforces 8 cores / 32 GB RAM / 150 GB free; sync/build concurrency is capped; live disk/RAM monitoring, a 330-minute internal deadline, and a 360-minute job timeout stop runaway work.        |
| Poisoned build artifact is published as a release   | A browser zip is uploaded only after `autoninja chrome` exits 0, the runtime passes staging checks, and it is no larger than 450 MiB. It is unsigned development output and is not published as a release. |
| Cache poisoning                                     | Chromium source and compiler outputs are not cached or uploaded. Every manual run starts with a fresh GitHub-hosted VM and verifies the configured source pins.                                            |
| Upstream file fetched from the wrong origin         | Upstream fetching is pinned to a commit SHA and verified by SHA-256 digest; `tools/chromium/lib/config.mjs` rejects unexpected upstream origins.                                                           |
| Toolchain (`depot_tools`) drifts silently           | `DEPOT_TOOLS_UPDATE=0` is set by `tools/chromium/sync.mjs`, and the revision is recorded in `config/chromium_version.json`.                                                                                |
| Automated update pulls unreviewed Chromium code     | `updatePolicy.automaticMerge` must be `false`; the bot only opens an issue.                                                                                                                                |

## Workflows

> **Deployment status:** the definitions below are committed at
> `tools/ci/workflows/` and deployed to `.github/workflows/` with
> `node tools/ci/install-workflows.mjs`. The deployed copies are byte-identical
> to the canonical files, and both `install-workflows.mjs --check` and
> `fast-checks.mjs` verify that on every run. Deployment is one-way and never
> silent: the installer reports what is missing and refuses to overwrite a file
> that differs from the canonical copy without `--force`, so CI cannot drift away
> from the reviewed definitions.
>
> **What the automation credential can and cannot do** (measured, not assumed):
> it can push to the repository, including `.github/workflows/*`, and it can read
> Actions state (`gh run list`, `gh api .../actions/runs`). It cannot create a
> workflow dispatch event — `POST .../actions/workflows/<id>/dispatches` returns
> `403 Resource not accessible by integration` — so a `workflow_dispatch`-only
> workflow is started by a maintainer from the Actions UI, or by a credential
> with the `actions: write` permission. GitHub also only offers "Run workflow"
> for a workflow whose file exists on the default branch.
>
> **Windows entry points:** both of the first hosted runs failed _inside_ a step
> although the tool it called exited 0. The cause was not the runner: every tool
> in `tools/` decided whether it was the entry point with
> `` import.meta.url === `file://${path.resolve(process.argv[1])}` ``, which is
> never true on Windows (`file://D:\...` never equals `file:///D:/...`). The
> tool silently did nothing, wrote no record, and the step died on the missing
> file. Entry detection now goes through `tools/lib/entry.mjs` and a test keeps
> the naive idiom out of the repository.
>
> **PowerShell and native commands:** steps that invoke node, gn or ninja set
> `$PSNativeCommandUseErrorActionPreference = $false` and check `$LASTEXITCODE`
> explicitly. Native commands write progress and warnings to stderr, and with
> `$ErrorActionPreference = 'Stop'` that interaction is PowerShell-version
> dependent; a test keeps both properties true for the experiment workflow.
>
> **Workflow files are validated by GitHub, not by us:** an invalid file is shown
> in the Actions list by its path instead of its `name:`, and the push that
> introduced it gets a zero-second "Invalid workflow file" failure with the exact
> parser error. The first hosted experiment hit this (`Unrecognized named-value:
'runner'` in a job-level `env:` block); rule 7 of `tools/ci/workflow-policy.mjs`
> now rejects that class of mistake before it reaches a push.

| Workflow                                 | Trigger                    | Runner                                                                        | Permissions                       | Purpose                                                                                                                                          |
| ---------------------------------------- | -------------------------- | ----------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ci-fast.yml`                            | push, pull_request, manual | GitHub-hosted standard                                                        | `contents: read`                  | Format, lint, typecheck, unit tests, repository checks, online patch verification, update report                                                 |
| `chromium-build.yml`                     | manual only                | GitHub-hosted Windows (`windows-2025` or configured `windows-latest-8-cores`) | `contents: read`                  | Measured preflight; pinned source and patch/overlay preparation; GN, WebUI resource, targeted C++, and explicitly selected full-build validation |
| `chromium-heavy-build-windows.yml`       | manual only                | GitHub-hosted `windows-2025`                                                  | `contents: read`                  | Retired notice; no checkout or compiler                                                                                                          |
| `chromium-hosted-windows-experiment.yml` | manual only                | GitHub-hosted `windows-2025`                                                  | `contents: read`                  | Retired notice; no checkout or compiler                                                                                                          |
| `chromium-update-watch.yml`              | schedule (daily), manual   | GitHub-hosted standard                                                        | `contents: read`, `issues: write` | Detect a newer Chromium build and open an issue                                                                                                  |

## Supply-chain rules for downloaded sources and tools

1. HTTPS sources from expected origins only
   (`github.com/chromium/chromium`, `chromium.googlesource.com`,
   `registry.npmjs.org`).
2. Version pinning: Chromium by commit SHA, `depot_tools` by commit SHA,
   npm dependencies by lockfile (`npm ci`, not `npm install`, in CI).
3. Integrity: upstream Chromium files are verified by SHA-256 digest
   (`chromium/verification/pre-images.json`); patches are verified by applying
   them to the pristine pre-images and comparing digests.
4. No unsigned binaries are downloaded and executed by CI.
5. No `curl | bash` patterns anywhere in the repository.

## What is intentionally not automated

- **Merging a Chromium update.** A human merges, after a build.
- **Publishing a release.** No workflow pushes a binary or tag today.
- **Signing.** No certificate exists yet; insecure workarounds are not created
  in its place (`docs/RELEASE.md`).
- **Uploading crash reports or telemetry from CI.** None exists.

## Review checklist for workflow changes

- [ ] New/changed action pinned to a full SHA **and** added to
      `tools/ci/actions-pins.json` with a purpose note.
- [ ] `permissions:` block present and minimal.
- [ ] No `pull_request_target`; no secrets on `pull_request`.
- [ ] Chromium compilation uses GitHub-hosted runners only; no self-hosted runner is selected.
- [ ] Any new download has an HTTPS origin, a version pin and an integrity check.
- [ ] No secret is echoed, even in `set -x` debug output.

## Reporting

A CI/infrastructure vulnerability is a security issue: report it privately per
[SECURITY.md](../SECURITY.md), not in a public issue.
