# Development

Two very different workflows live in this repository. Pick the right one before
you start, because one of them takes a minute and the other takes hours.

## A. Work on Aurelia's own code (no Chromium build)

This is the common case: policy code, design tokens, WebUI resources, tooling.

```bash
git clone https://github.com/ankbuitv/browser.git
cd browser
npm ci                     # development tooling only

node tools/chromium/cli.mjs status     # what is pinned
node tools/ci/fast-checks.mjs          # repository invariants
npm test                               # unit tests
```

Useful commands:

| Command                                               | Purpose                                              |
| ----------------------------------------------------- | ---------------------------------------------------- |
| `npm test`                                            | Unit tests (`vitest`)                                |
| `npm run test:watch`                                  | Watch mode                                           |
| `npm run format` / `format:check`                     | Prettier                                             |
| `npm run lint`                                        | ESLint (flat config)                                 |
| `npm run typecheck`                                   | TypeScript (no emit)                                 |
| `node tools/design/generate-tokens.mjs`               | Regenerate design-token outputs                      |
| `node tools/design/check-contrast.mjs`                | WCAG 2.1 AA check for every declared token pair      |
| `node tools/chromium/build.mjs --dry-run`             | Print the full build pipeline without running it     |
| `node tools/chromium/cli.mjs generate-version`        | Regenerate the compiled-in version header            |
| `node tools/chromium/cli.mjs verify-patches --online` | Prove the patch still applies to the pinned revision |
| `node tools/chromium/cli.mjs fork-delta --json`       | Measured fork delta                                  |

Editing rules that CI enforces:

- generated files (`design_tokens.css`, `tokens.generated.ts`,
  `aurelia_version.h`) must be regenerated, never hand-edited;
- the overlay may only contain Chromium-native file types - no `package.json`,
  no `node_modules`, no `tsconfig.json`;
- workflows must pin actions to SHAs listed in `tools/ci/actions-pins.json`;
- the NextDNS endpoint literal lives in exactly one module;
- every token pair declared in `check-contrast.mjs` meets its WCAG threshold.

### The UI development harness

`packages/ui-lab` is a **development harness, not the Aurelia browser**. It
exists to iterate on components that are intended to become real Chromium WebUI
resources, so it consumes the same design tokens. Anything it renders must be
labelled in the UI itself as a harness preview; a harness screenshot must never
be presented as evidence that a feature works in the browser.

Its rules:

- it is never shipped, never part of the browser build, and never referenced by
  the overlay;
- components that are _also_ shipped as Chromium resources keep the Chromium
  code as their source of truth - the harness copies, never the reverse;
- when a component is integrated into Chromium, the harness is updated to load
  the shipped implementation where practical, so the harness tests the real
  thing rather than a lookalike.

## B. Build a real browser

Only when you need to see Aurelia inside Chromium (integration work, smoke
tests, milestone evidence). See [BUILDING-CHROMIUM.md](BUILDING-CHROMIUM.md).

```bash
node tools/chromium/sync.mjs --dest /srv/aurelia-chromium --check-only
node tools/chromium/sync.mjs --dest /srv/aurelia-chromium --install
cd /srv/aurelia-chromium/src
gn gen out/Aurelia --args='is_component_build=true symbol_level=1'
autoninja -C out/Aurelia -j"$(nproc)" chrome
node <repo>/tools/chromium/smoke-test.mjs --binary out/Aurelia/chrome
```

Requirements: ≥ 8 cores, ≥ 32 GB RAM, ≥ 150 GB free disk.

## Making changes

1. Create a branch (or, for tiny documentation fixes, commit straight to
   `main`).
2. Keep commits coherent and use Conventional Commits
   (`feat:`, `fix:`, `docs:`, `build:`, `ci:`, `refactor:`, `test:`,
   `perf:`, `chore:`, `security:`).
3. Reference the issue you are working on.
4. Run `npm run ci`-equivalent checks locally:
   `npm run format:check && npm run lint && npm run typecheck && npm test && node tools/ci/fast-checks.mjs`.
5. Open a pull request. Significant or high-risk work always goes through a PR.

## Security-sensitive changes

Anything touching key material, password storage, sync crypto, custom CSS
scoping, the update mechanism or the installer requires:

- a threat-model section (existing ones live in `docs/threat-models/`);
- tests, including negative/adversarial cases;
- a review note in the pull request describing what could go wrong.

See [SECURITY.md](../SECURITY.md) for the rules that are never negotiable.

## Publishing the CI workflows

The workflow definitions are ordinary, reviewed files at `tools/ci/workflows/`.
GitHub only runs workflows installed under `.github/workflows/`, and pushing
files to that path requires a credential with the `workflows` permission.

```bash
node tools/ci/install-workflows.mjs           # deploy the definitions
node tools/ci/install-workflows.mjs --check   # verify deployed copies match
```

The installer never overwrites a file that differs from the canonical copy
unless `--force` is given, and `fast-checks.mjs` fails when an installed copy
drifts. If a push is rejected with `without workflows permission`, the
definitions can also be added through GitHub's web editor by a maintainer; they
are plain YAML with pinned action SHAs (see `tools/ci/actions-pins.json`).

## Creating issues from a restricted environment

Issue creation works with the repository's GitHub integration, but labels,
milestones, comments and state changes may be rejected (`Resource not accessible
by integration`) depending on the credential's permissions. A label or milestone
passed at creation time is silently dropped in that case, so an issue must never
rely on them being applied.

Write the intended milestone and labels into the issue body itself, for example:

```markdown
**Milestone:** M3 — Privacy & blocking
**Labels:** area:privacy, verification
```

Trackers and reports should treat the body as the source of truth until a
credential with issue-write permission applies the metadata. When organising the
tracker, verify with `gh api repos/OWNER/REPO/issues/N --jq .milestone` rather
than assuming the request succeeded.

## Working with the Chromium pin

Never edit `chromium/patches/*.patch` by hand. Edit
`tools/chromium/lib/upstream-edits.mjs` and regenerate:

```bash
node tools/chromium/cli.mjs generate-patch
node tools/chromium/cli.mjs verify-patches --online
```

If the generator reports `anchor not found`, upstream moved those lines:
see the rebase instructions in
[CHROMIUM-UPSTREAM.md](CHROMIUM-UPSTREAM.md#rebasing-an-edit-that-moved).
