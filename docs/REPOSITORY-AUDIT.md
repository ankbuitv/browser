# Repository audit (initial)

Performed before any change was made, as the first step of the project.

## What existed

| Item                                        | Finding                                                         |
| ------------------------------------------- | --------------------------------------------------------------- |
| Contents                                    | A single `README.md` containing the text `# browser` (10 bytes) |
| Commits                                     | 1 (`6fea37a Initial commit`)                                    |
| Branches                                    | `main` only                                                     |
| Tags, releases                              | none                                                            |
| Issues, pull requests, milestones, projects | none                                                            |
| GitHub Actions workflows                    | none                                                            |
| License                                     | none                                                            |
| Git history                                 | no large files, no binaries, no vendored sources                |
| Secrets                                     | none found (there was nothing to hold one)                      |
| Useful prior work to preserve               | nothing beyond the repository name and the initial commit       |

Conclusion: **greenfield**. There was no existing architecture to preserve, no
tech stack to keep, and nothing to migrate. The audit's main value is that it
removed several risks up front: no legacy build system to drag along, no
credential to rotate, and no licensing ambiguity from prior code.

## Capabilities of the scaffolding environment

Recorded because it shaped the strategy:

| Capability | Reality                                                                                                                | Consequence                                                                                                                                                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Disk       | ~20 GB free                                                                                                            | Cannot hold a Chromium checkout (≥ 150 GB).                                                                                                                                                              |
| CPU / RAM  | 2 cores / ~4 GB                                                                                                        | Cannot build Chromium.                                                                                                                                                                                   |
| Network    | `github.com`, `api.github.com`, `codeload.github.com`, `registry.npmjs.org`, `pypi.org`, `files.pythonhosted.org` only | Upstream files are fetched via the GitHub API; `chromium.googlesource.com` and `chromiumdash` are unreachable, which is why the pin is verified against upstream tags rather than the release dashboard. |
| Tooling    | Node.js 22, npm 10, Python 3.11, git 2.39, `gh` (authenticated)                                                        | Enough for tooling, tests and verification; not for compilation.                                                                                                                                         |

## Decisions taken as a result

1. **Thin-fork strategy**: Chromium is pinned and never vendored; the delta is a
   small patch plus an overlay of new files.
2. **Generated, not hand-edited patches**: patches are produced from declarative
   edits and verified against pristine pre-images at the pinned commit.
3. **Lightweight verification instead of a local build**: the environment can
   prove the patch applies to the exact upstream revision, but cannot prove it
   compiles. The manual GitHub-hosted validation workflow is the compile path;
   it blocks standard runners and requires an adequately sized hosted runner.
4. **Toolchain pin honesty**: `depot_tools` cannot be reached from here, so its
   revision is `null` with an explicit recording procedure rather than an
   invented SHA.
5. **Node.js is tooling only**: no Node dependency is introduced into the
   browser or its build. Enforced by a repository test.

## Follow-ups created from this audit

| Follow-up                                                                                      | Where                                     |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Configure an eligible GitHub-hosted Windows larger runner and record its measured requirements | milestone M0 issue                        |
| Confirm the pinned channel on a networked machine (`chromiumdash`)                             | milestone M0 issue                        |
| Record the `depot_tools` revision                                                              | milestone M0 issue                        |
| Naming/trademark review before public release                                                  | [NAMING.md](NAMING.md) + owner escalation |
