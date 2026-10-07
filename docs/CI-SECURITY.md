# CI and release infrastructure threat model

CI is part of the product's attack surface: it compiles the browser, handles
update metadata and will eventually sign artifacts. This document states the
threats, the controls, and what is deliberately not automated.

## Assets

| Asset                                      | Why it matters                                                      |
| ------------------------------------------ | ------------------------------------------------------------------- |
| The pinned Chromium revision and patch set | A tampered pin or patch ships someone else's code in Aurelia's name |
| Build artifacts                            | `chrome.exe` is what users run                                      |
| Signing keys (future)                      | Compromise means undetectable malicious updates                     |
| `GITHUB_TOKEN` and any repository secret   | Write access to the repository                                      |
| Self-hosted builder                        | Persistent machine with a reusable checkout                         |

## Threats and controls

| Threat                                              | Control                                                                                                                                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Third-party action is compromised or a tag is moved | Every action is pinned to a full commit SHA, and the SHA must appear in `tools/ci/actions-pins.json`. `tools/ci/workflow-policy.mjs` fails the build otherwise.                                                     |
| Untrusted fork code runs with a privileged token    | `pull_request_target` is forbidden (policy check). Workflows triggered by `pull_request` never reference `secrets.*`.                                                                                               |
| Excessive token scope                               | Every workflow declares an explicit `permissions:` block; the default is `contents: read`. `write-all` is a policy failure.                                                                                         |
| Secret exfiltration through logs                    | No workflow prints secrets. `tools/ci/secret-scan.mjs` blocks credentials in the repository, including a scan of tracked files and forbidden file names.                                                            |
| Malicious PR modifies a workflow to exfiltrate      | Workflow files are covered by the same PR review as code, and the policy check runs on every PR (including PRs that change workflows, since the check reads the working tree).                                      |
| Self-hosted runner executes fork code               | Self-hosted runners are restricted to `schedule`, `workflow_dispatch`, `push` and `release` events (policy check). The heavy build is not triggered by `pull_request`.                                              |
| Poisoned build artifact is published as a release   | The heavy build uploads only a **build report**; no binary is published by CI yet. Release publishing is a separate, manually approved workflow (M8), and artifacts from untrusted events are never consumed by it. |
| Cache poisoning                                     | No build cache is shared between the heavy builder and hosted runners; the checkout directory is local to the builder.                                                                                              |
| Upstream file fetched from the wrong origin         | Upstream fetching is pinned to a commit SHA and verified by SHA-256 digest; `tools/chromium/lib/config.mjs` rejects unexpected upstream origins.                                                                    |
| Toolchain (`depot_tools`) drifts silently           | `DEPOT_TOOLS_UPDATE=0` is set by `tools/chromium/sync.mjs`, and the revision is recorded in `config/chromium_version.json`.                                                                                         |
| Automated update pulls unreviewed Chromium code     | `updatePolicy.automaticMerge` must be `false`; the bot only opens an issue.                                                                                                                                         |

## Workflows

> **Deployment status:** the definitions below are committed at
> `tools/ci/workflows/` and deployed with
> `node tools/ci/install-workflows.mjs`. They are not yet installed under
> `.github/workflows/`, because the GitHub credential that pushed this branch
> lacks the `workflows` permission (GitHub rejects pushes containing
> `.github/workflows/*` without it). Until a credential with that permission
> runs the deployment — or a maintainer copies the three files across — nothing
> runs on GitHub, and the checks in this document are enforced locally by
> `node tools/ci/fast-checks.mjs` only.
>
> Deployment is one-way and never silent: `install-workflows.mjs` reports what is
> missing, refuses to overwrite a file that differs from the canonical copy
> without `--force`, and `fast-checks.mjs` verifies that any installed copy is
> byte-identical. That way CI cannot drift away from the reviewed definitions.

| Workflow                                 | Trigger                    | Runner                                                            | Permissions                       | Purpose                                                                                                                                                                          |
| ---------------------------------------- | -------------------------- | ----------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci-fast.yml`                            | push, pull_request, manual | GitHub-hosted                                                     | `contents: read`                  | Format, lint, typecheck, unit tests, repository checks, online patch verification, update report                                                                                 |
| `chromium-heavy-build-windows.yml`       | schedule (nightly), manual | **self-hosted** (`[self-hosted, windows, x64, aurelia-chromium]`) | `contents: read`                  | Capability probe, sync pinned tree, verify patches, install overlay, fork-delta check, `gn gen`, build, stage runtime, sandboxed smoke test, package unsigned artifact + reports |
| `chromium-hosted-windows-experiment.yml` | manual only                | GitHub-hosted (`windows-latest`)                                  | `contents: read`                  | Measure the hosted runner against the documented minimums; stop before syncing when too small; at most one controlled build attempt                                              |
| `chromium-update-watch.yml`              | schedule (daily), manual   | GitHub-hosted                                                     | `contents: read`, `issues: write` | Detect a newer Chromium build and open an issue                                                                                                                                  |

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
- [ ] Self-hosted runner only on trusted events.
- [ ] Any new download has an HTTPS origin, a version pin and an integrity check.
- [ ] No secret is echoed, even in `set -x` debug output.

## Reporting

A CI/infrastructure vulnerability is a security issue: report it privately per
[SECURITY.md](../SECURITY.md), not in a public issue.
