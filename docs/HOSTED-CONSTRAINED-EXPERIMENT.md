# HOSTED_CONSTRAINED_EXPERIMENT

One controlled attempt to compile the real Chromium+Aurelia browser on a
standard GitHub-hosted Windows runner, using a storage- and memory-conscious
configuration.

Status vocabulary is used strictly. Until this document says otherwise with a
run URL next to it, nothing here is COMPILED, TESTED or VERIFIED.

## Why this exists

`docs/CI-BUILD-FEASIBILITY.md` records what the standard hosted Windows runner
actually is, measured on 2026-10-07 ([run
37595986333](https://github.com/ankbuitv/browser/actions/runs/37595986333)):

| Item                    | Measured                                        | Reference minimum |
| ----------------------- | ----------------------------------------------- | ----------------- |
| Image                   | `win25-vs2026`, image `20260925.250.1`          | -                 |
| CPU                     | AMD EPYC 7763, **4 logical cores**              | 8+                |
| RAM                     | **16 GB** (13.3 GB available)                   | 32 GB+            |
| Free disk (best volume) | **147 GB** (`D:`; `C:` and `TEMP` 32.1 GB each) | 150 GB+           |

That verdict was **RESOURCE LIMIT against the documented reference minimums**,
and it stopped before syncing. It proved the runner is below the
recommendation. It did **not** prove Chromium cannot compile there: the
reference minimums are conservative _builder_ recommendations, and a machine
that misses them may still produce a browser — just slowly.

So one experiment answers the second question, with numbers.

## What is and is not changed

Not changed, anywhere, by anything in this experiment:

- **The documented reference builder minimums** (8 logical cores / 32 GB RAM /
  150 GB free) in `config/chromium_version.json`. The workflow still runs
  `tools/ci/check-builder.mjs` first and records the shortfall in
  `runner-capabilities.json`.
- **Security properties.** The sandbox, site isolation, TLS verification and
  process isolation are not GN switches Chromium exposes; they are not
  configured away here, and `tools/chromium/gn-args.mjs` rejects such keys
  outright. The smoke test never passes `--no-sandbox`.
- **The pin, the patch set, the fork delta budget, the pipeline order.**

Changed, deliberately and only in this experiment:

| What                 | How                                 | Why it is legitimate                                                                                   |
| -------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| What is fetched      | shallow clone (`--no-history`)      | documented by upstream at the pinned revision (`docs/windows_build_instructions.md`)                   |
| What is fetched      | `target_os = ["win"]`               | documented in `gclient.py` itself; Chromium's DEPS gates platform payloads on `checkout_*` vars        |
| What is fetched      | `checkout_configuration = "small"`  | documented in Chromium's DEPS: skip what "is not strictly needed to build chromium"                    |
| Compiler/linker work | `config/gn/win-x64-low-resource.gn` | upstream's own switches: `symbol_level = 0`, `concurrent_links = 1`, component build                   |
| Compile parallelism  | `autoninja -j 2`                    | computed by `tools/chromium/low-resource.mjs` from measured RAM and cores for a 16 GB / 4-core machine |

## GN arguments: verified against the pinned revision, not invented

Every key in `config/gn/win-x64-low-resource.gn` was checked against
`cfaadc5a132d78e1828635aa8405a499f3e14864` by reading the upstream file that
declares it.

| Argument                           | Present at the pin?                         | Default on Windows release | Effect                                                                          |
| ---------------------------------- | ------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------- |
| `symbol_level = 0`                 | yes, `build/config/compiler/compiler.gni`   | **2**                      | no symbols: less compile memory, faster links, smaller disk, worse crash stacks |
| `concurrent_links = 1`             | yes, `build/toolchain/concurrent_links.gni` | computed from the machine  | one link at a time; upstream calls linking "memory-intensive"                   |
| `is_component_build = true`        | yes                                         | false for release          | many small DLLs instead of two huge ones: lower peak link memory                |
| `is_debug = false`                 | yes                                         | -                          | optimised, no debug assertions                                                  |
| `treat_warnings_as_errors = false` | yes                                         | true                       | upstream warnings must not fail a downstream build                              |
| `target_cpu = "x64"`               | yes                                         | host                       | first target platform                                                           |

Two arguments that **look** like obvious wins were checked and deliberately
**not** added:

- **`blink_symbol_level`** and **`v8_symbol_level`**: upstream's own
  `docs/windows_build_instructions.md` still recommends both under "Faster
  builds", but neither is declared at the pinned revision.
  `build/config/compiler/compiler.gni` - where both historically lived -
  contains no such key, and none of the 26 `build/config/*.gni` files does.
  Passing an undeclared argument makes `gn gen` fail with "Unknown argument",
  so adding it would break the configure step rather than speed up the build.
  The documentation is stale.
- **`enable_precompiled_headers`**: `build/config/pch.gni` already defaults it
  to `true` for exactly this configuration (not official, no remote execution,
  no `cc_wrapper`, not Linux), so setting it would change nothing.

## Disk

Measured four times, always before the step that could fill the volume:

1. initial (every volume)
2. after the safe reclamation allowlist
3. after `gclient sync`
4. after `gn gen`, then sampled every 60 s during the compile

The compile stops before the build volume drops below an emergency reserve
(10 GB by default).

### The reclamation allowlist

Entries are preinstalled image data that a _Windows Chromium_ build provably
does not need. Nothing the build does need is on the list: no Visual Studio
component, no MSVC toolset, no Windows SDK, no Git, no Python, no Node.

| Path                                                         | Why                                                                                                                         |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `C:\Android`, `%LOCALAPPDATA%\Android`                       | Android SDK, emulator and three NDKs; DEPS gates them behind `checkout_android`, which is false for a Windows-only checkout |
| Haskell (`C:\Program Files\Haskell`, `C:\tools\ghc*`, cabal) | no part of the Chromium toolchain                                                                                           |
| `C:\hostedtoolcache\windows\Boost`                           | not a Chromium dependency                                                                                                   |
| Julia, Mercurial                                             | not Chromium dependencies                                                                                                   |
| `C:\ProgramData\Microsoft\VisualStudio\Packages`             | the VS **download cache**; the installation itself is untouched                                                             |
| pip / npm / yarn / NuGet caches                              | re-downloadable at worst                                                                                                    |

The checkout goes on the roomiest NTFS volume, not on `TEMP`: on the measured
image `C:` and `TEMP` had 32.1 GB free while `D:` had 147 GB. `TMP`/`TEMP` are
redirected to the same volume for the build steps.

## The pipeline

Identical to the production pipeline, driven by the same tools, in the same
order:

```
checkout Aurelia
  -> measure the runner and choose the volume
  -> classify against the documented minimums (never lowered)
  -> apply the experimental floor (tools/chromium/low-resource.mjs)
  -> reclaim disk from the allowlist
  -> constrained gclient sync at the pinned revision (--nohooks)
  -> install the pinned toolchain and run the remaining DEPS hooks
  -> verify HEAD, verify the Aurelia patches, install the overlay
  -> verify the fork delta
  -> gn gen with the reviewed low-resource arguments
  -> validate the effective args.gn
  -> autoninja -j 2 chrome   (bounded, monitored, sampled)
  -> if it compiled: stage -> smoke test -> record -> package
  -> always: collect the evidence and classify the failure
```

## The toolchain: what the pinned revision demands, and what is actually

## obtainable

Chromium builds against **one exact** Windows SDK, and demands it by name. At
the pinned revision `build/vs_toolchain.py` carries `SDK_VERSION =
'10.0.28000.0'`, `build/toolchain/win/setup_toolchain.py` carries the same
literal and passes it as the second argument to `vcvarsall.bat`, and no GN
argument changes either one. `build/config/win/visual_studio_version.gni` will
take a `windows_sdk_version` of your choosing — but only on the branch where
`visual_studio_path` is set too, which then also demands `wdk_path`, and the
`vcvarsall.bat` call still uses the hard-coded version.

Three things follow, each of them measured on a real runner:

1. **The packaged toolchain is not available to this repository.** depot_tools'
   own `win_toolchain` README says `get_toolchain_if_necessary.py` "uses gsutil
   to download the zip ... This requires authentication with @google.com
   credentials". Run 6 asked anonymously and got `401 Anonymous caller does not
have storage.objects.list access ... chrome-wintoolchain` — followed by
   Chromium's own advice to set `DEPOT_TOOLS_WIN_TOOLCHAIN=0`. So `0` is not a
   cost-saving measure here; with `1` there is no build at all outside Google.
2. **The SDK the pin demands is not on the image**, which ships 10.0.26100.0.
   It is a real, installable Visual Studio component, so the run installs
   `Microsoft.VisualStudio.Component.Windows10SDK.<pinned version>` before
   `gn gen` — reading the version out of the checkout rather than hard-coding
   it, so the step cannot drift from the pin.
3. **The hook that used to fetch all of this is the wrong place for it.** Run 5
   left it inside the sync; it failed after an hour of an otherwise clean
   checkout, and with the step's budget already spent there was nothing left to
   retry with. The sync now runs `--nohooks` and fetches sources and
   dependencies only, and the hooks get their own stage with three attempts, so
   a failure costs minutes instead of the run.

## Reading a run

The runner's logs are not reachable from every environment that has to audit
one of these runs: `gh run download` and `gh run view --log` both fail at the
blob store, and `gh api .../check-runs/<id> --jq .output` returns nothing for
an Actions job. **Job annotations are the only channel that survives**, so each
stage publishes what it knows through them:

- `tools/ci/publish-log-tail.ps1` echoes the tail of a failing log as `::error`
  annotations. It sends thirty lines as ten annotations of three, newest first,
  because the runner keeps a step's first ten annotations and drops the rest —
  a naive tail loses the lines nearest the failure, which is where the answer
  is.
- Every attempt announces itself (`::notice title=Sync attempt 1 of 3`), so how
  far a run got is visible even when nothing it produced can be downloaded.
- The evidence step ends with one `::error` carrying the classification and one
  `::notice` per recorded shape.

Read them with:

```
gh api repos/ankbuitv/browser/actions/runs/<run-id>/jobs --jq '.jobs[0].id'
gh api repos/ankbuitv/browser/check-runs/<job-id>/annotations
```

Two operational rules were bought with wasted runs:

- **Do not edit the workflow while one of its runs is in flight.** Changing the
  trigger set cancels it — run 3 was destroyed by the very commit that retired
  its temporary push trigger.
- **Do not ask a tool a question it cannot answer yet.** depot_tools does not
  exist until the sync has produced it, so `gclient help sync` in the sync step
  is a `CommandNotFoundException` that ends the step in about a second (run 4).
  `tools/chromium/sync.mjs` asks the same question after installing
  depot_tools, which is when it has an answer.

## Failure classification

Every run ends with one of these, written to
`artifacts/hosted-constrained-evidence.json` and into the job summary:

`RESOURCE LIMIT` · `TIME/QUOTA LIMIT` · `NETWORK` · `DEPOT_TOOLS` · `GCLIENT` ·
`TOOLCHAIN` · `PATCH` · `GN` · `AURELIA C++` · `AURELIA WEBUI/TYPESCRIPT` ·
`UPSTREAM CHROMIUM` · `LINK` · `PACKAGING` · `SMOKE TEST` · `UNKNOWN`

The report carries the run URL, CPU, RAM, disk at all four points, the Chromium
/ Aurelia / depot_tools SHAs, the exact effective `args.gn`, the elapsed time,
the last successful stage, and the first meaningful error line.

An Aurelia-owned failure (PATCH, GN, AURELIA C++, AURELIA WEBUI) gets fixed,
tested, committed, and earns **at most one** justified retry. A resource or
infrastructure limit is reported as evidence and is **not** retried unchanged.

## Result

_Filled in from the run. Until then: nothing in this repository has been
compiled on a hosted runner._
