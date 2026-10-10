# GitHub-hosted Chromium validation

## Policy and current status

Chromium validation is a **manual GitHub Actions workflow** and all Chromium
compilation must run on GitHub-hosted Windows x64 runners. There is no
self-hosted, local, external-cloud, containerized, Electron, CEF, or WebView2
compile path. The legacy build plan remains for dry-run/history tests only; its
executor and local bootstrap are retired. The unified GitHub-hosted workflow is
the only supported compilation entry point.

No Chromium compilation has succeeded yet. A source sync, patch check, GN
configuration, or unit test is not compiler evidence. A compile is claimed only
when the corresponding `autoninja` command exits with code `0` in the
GitHub Actions run; runtime integration and smoke testing require separate
evidence.

The authoritative workflow is `.github/workflows/chromium-build.yml` (canonical
source: `tools/ci/workflows/chromium-build.yml`). It has only the
`workflow_dispatch` trigger. It does not run on `push`, `pull_request`, or a
schedule, and `gn` is the default validation level.

## Dispatch inputs

| Input              | Options                            | Behavior                                                                                                                                                                                               |
| ------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `validation_level` | `gn` (default), `targeted`, `full` | `targeted` and `full` must be chosen explicitly. Every level runs all earlier checks in the same job. `full` compiles `chrome` only after GN, WebUI resources, and targeted C++ pass in that same run. |
| `runner_size`      | `standard` (default), `larger`     | `standard` targets GitHub-hosted `windows-2025` and is expected to report `BLOCKED` before Chromium source sync. `larger` targets the configured GitHub-hosted label `windows-latest-8-cores`.         |

The organization must provision a GitHub-hosted Windows larger runner, grant
repository access, and configure the label before `larger` can start. The
workflow does not silently fall back if the label is unavailable. Its preflight
also confirms the runner reports `GITHUB_ACTIONS=true` and
`RUNNER_ENVIRONMENT=github-hosted`; a local or self-hosted invocation is
blocked.

## Resource policy

The reviewed Aurelia first-build gate is **8 logical CPU cores, 32 GB RAM, and
150 GB free on the exact volume that will hold Chromium**. This is deliberately
not lowered for standard runners. `tools/ci/check-builder.mjs` checks the
resource and Windows toolchain requirements, and the validation driver repeats
the destination-volume and platform checks before source sync. The same 150 GB
disk floor is enforced by `tools/chromium/sync.mjs`.

GitHub's published public standard Windows runner is 4 vCPUs, 16 GB RAM, and
14 GB SSD. Its exact usable space can vary; the live runner is measured rather
than assumed. GitHub documents a Windows larger-runner tier with 8 vCPUs,
32 GB RAM, and 300 GB SSD, but availability, labels, and billing depend on the
organization's configuration. See [CI-BUILD-FEASIBILITY.md](CI-BUILD-FEASIBILITY.md)
for the published-resource references, historical runner measurement, and
preflight policy.

## Validation stages

When the measured runner passes preflight, `tools/chromium/ci-validation.mjs`
uses Aurelia's pinned tooling in this order:

1. Sync the configured Chromium revision and pinned `depot_tools` with at most
   four sync jobs; verify both resulting SHAs.
2. Verify the patch set against the pristine pinned checkout, apply the patch
   and overlay, and check the reviewed fork-delta budget.
3. Validate the reviewed Windows GN arguments, run `gn gen`, require the
   generated `out/Aurelia/args.gn`, then validate those effective arguments.
4. Resolve every selected label using `gn desc`; run scoped `gn check` for the
   two Aurelia C++ controller targets.
5. Build `build_ts`, `build_grd`, and `resources` for both Aurelia WebUI pages;
   verify expected TypeScript, GRIT, resource-map, and `.pak` outputs.
6. For `targeted` and `full`, compile the two overlay `source_set` targets and
   their C++ dependencies.
7. For `full` only, compile Chromium's `chrome` target. This stage is reached
   only after all previous stages in the same run pass.

The selected GN labels come from the checked-in Aurelia overlay and the
`build_webui()` template at the configured Chromium pin. A missing label or
resource output is a failure, not a warning. All Ninja invocations are capped at
four jobs. Resource usage is sampled every 30 seconds; the process tree is
stopped if free disk falls below the 15 GB reserve or available RAM falls below
1.5 GB. A 330-minute internal deadline leaves time for summary and artifact
handling under GitHub's 360-minute job timeout. Only one validation run per
repository is allowed at a time.

## Build states and evidence

| State                         | Required evidence                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `INTEGRATION SOURCE VERIFIED` | Patch verification and overlay/fork-delta checks pass.                                         |
| `CONFIGURATION VERIFIED`      | `gn gen` exits `0`, generated arguments pass policy, and selected targets resolve.             |
| `WEBUI RESOURCES VERIFIED`    | The WebUI Ninja targets exit `0` and expected TypeScript/GRIT/pak outputs exist.               |
| `TARGETED COMPILED`           | Both Aurelia C++ source-set Ninja targets exit `0` in `targeted` or `full` mode.               |
| `COMPILED`                    | `autoninja ... chrome` exits `0` in explicit `full` mode in the same run.                      |
| `RUNTIME INTEGRATED`          | Browser launches with Aurelia pages/resources available. Not established by compilation alone. |
| `TESTED`                      | A separate runtime smoke test passes. Not currently run by `chromium-build.yml`.               |
| `VERIFIED`                    | A supported physical Windows device passes the compatibility test.                             |

Workflow step names are not evidence. The build summary records stage statuses,
run URL, runner capabilities, pins, effective GN arguments, resource samples,
and per-stage logs. The driver writes `PASS` only after a zero compiler exit code
and any required stage postconditions.

## Artifacts and source-tree handling

The workflow uploads `artifacts/` only: logs, JSON resource samples, runner
capabilities, the effective GN arguments, and Markdown/JSON summaries. It never
caches or uploads the Chromium source tree. A browser runtime is packaged only
after a successful full `chrome` compile, staging checks, and confirmation that
the archive fits the 450 MiB upload budget. An oversized or otherwise ineligible
binary is omitted and explicitly reported; the Chromium source is never
included.

The browser artifact is unsigned development output. No release is published,
no signing secrets are used, and no security feature is weakened to make CI pass.
The workflow does not run a smoke test or claim the browser is tested.

## Troubleshooting

| Result                                          | Meaning / next action                                                                                                                                                                  |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BLOCKED` on `standard`                         | Expected when published or measured CPU/RAM/disk/toolchain values miss the gate. No Chromium source sync starts.                                                                       |
| `larger` remains queued                         | Confirm the GitHub-hosted Windows runner exists, the label is exactly `windows-latest-8-cores`, its group grants this repository access, and billing is enabled. There is no fallback. |
| `RESOURCE EXHAUSTED`                            | Inspect resource samples and the named stage log. The process tree is stopped; do not lower the reserve without review.                                                                |
| Pin, patch, overlay, GN, or target failure      | Treat as a real failure. Inspect the stage log and review the pinned Chromium/`depot_tools` config; no fallback to a moving revision occurs.                                           |
| `COMPILED` but no browser zip                   | The binary was too large or failed staging/postconditions. The summary explains why; this does not downgrade compiler evidence.                                                        |
| Full compiler succeeds but smoke test is absent | Compilation is established, runtime integration is not. Run and record the separate smoke test before claiming `TESTED`.                                                               |

## Related documentation

- [GitHub-hosted build feasibility and runner specifications](CI-BUILD-FEASIBILITY.md)
- [CI threat model and workflow permissions](CI-SECURITY.md)
- [Testing levels and coverage](TESTING.md)
- [Chromium pin and upstream update procedure](CHROMIUM-UPSTREAM.md)
- [Reviewed fork-delta budget](FORK-DELTA.md)
