# Contributing to Aurelia Browser

Thanks for helping. This project is early, small, and deliberate about how work
gets done — mostly because it is a browser fork, where an unverified claim can
cost someone their data.

## Before you start

- Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (how the fork is structured)
  and [docs/PROJECT-STATUS.md](docs/PROJECT-STATUS.md) (what actually exists).
- For anything touching security, privacy or cryptography, read
  [SECURITY.md](SECURITY.md) and the relevant document in `docs/threat-models/`.
- Find or open an issue before large work. Milestones define the current focus.

## Ground rules

These are not style preferences; changes that violate them are rejected:

1. **No feature work before the thing it depends on.** The browser comes before
   the installer; the shell comes before polish.
2. **Thin Chromium delta.** Prefer new isolated code, supported extension points
   and WebUI over patching Chromium. A patch needs a documented reason and the
   smallest possible footprint (see [docs/FORK-DELTA.md](docs/FORK-DELTA.md)).
3. **No unverified claims.** Use the status vocabulary (NOT STARTED ·
   SCAFFOLDED · IMPLEMENTED · INTEGRATED · TESTED · VERIFIED). A screenshot is
   not integration; a preview harness is not the browser; a unit test is not a
   compiling Chromium.
4. **No Node.js in the browser.** Node is development tooling only. CI fails if
   a Node runtime artifact appears in the Chromium overlay.
5. **Security rules are absolute.** Never disable the sandbox, site isolation or
   TLS verification; never add hidden telemetry; never write custom crypto.
6. **No secrets, ever.** No keys, tokens, certificates or credentials in the
   repository, tests, fixtures, workflows or issue text.

## Workflow

```bash
git switch -c feat/short-description
# ... work ...
npm ci
npm run format:check && npm run lint && npm run typecheck && npm test
node tools/ci/fast-checks.mjs
git commit -m "feat(scope): short description"
```

- Branch from `main`. Small, safe documentation or tooling fixes may go straight
  to `main`; everything else goes through a pull request.
- Open a PR against `main` and reference the issue.
- CI must be green: formatting, lint, types, unit tests, repository invariants,
  the online patch verification, and the supply-chain policy checks.

### Commit messages

[Conventional Commits](https://www.conventionalcommits.org/):

```
feat(webui): render the status cards from build provenance
fix(dns): refuse credential-bearing custom DoH templates
docs(privacy): add the sync metadata leakage section
ci: pin actions/upload-artifact to a reviewed SHA
test(prefs): negative cases for managed preference writes
security(sync): reject tampered payloads before decode
```

Keep commits coherent — one idea per commit, and never a single "implement
everything" commit. Reference issues (`Refs #12`, `Closes #34`).

## What good changes look like here

| Change type                           | Requirements                                                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Policy logic (`packages/core`)        | Pure functions, unit tests including **negative** cases, no DOM/Node APIs                                            |
| Chromium overlay (`chromium/overlay`) | Follow the upstream pattern you are mirroring; no Node runtime; no `innerHTML`; strict CSP-friendly                  |
| Patch set (`chromium/patches`)        | **Never hand-edit.** Edit `tools/chromium/lib/upstream-edits.mjs`, then `generate-patch` + `verify-patches --online` |
| Design tokens                         | Edit `packages/design-tokens/tokens.json`, regenerate; never hand-edit generated files                               |
| Documentation                         | Be precise about status; state what is _not_ verified                                                                |
| Workflows                             | Pin actions to a SHA approved in `tools/ci/actions-pins.json`; declare minimal `permissions`                         |
| Security-sensitive features           | Threat model first, then tests, then code                                                                            |

## Generated files

Never edit these by hand — CI fails when they are stale:

- `chromium/overlay/chrome/browser/ui/webui/aurelia/aurelia_version.h`
- `chromium/overlay/chrome/browser/resources/aurelia/design_tokens.css`
- `packages/design-tokens/src/tokens.generated.ts`
- `packages/ui-lab/src/tokens.generated.css`

## Verified work only

If your change is meant to make something work in the browser, it is not
finished until the appropriate evidence exists:

| Level       | Evidence                                             |
| ----------- | ---------------------------------------------------- |
| Logic       | unit tests (`npm test`)                              |
| Artifacts   | `node tools/ci/fast-checks.mjs`, patch verification  |
| Integration | heavy build + `smoke-test.mjs` output                |
| Feature     | feature tests per [docs/TESTING.md](docs/TESTING.md) |

When you cannot produce the evidence yet (for example, no builder access),
**say so explicitly** in the PR and use SCAFFOLDED/IMPLEMENTED rather than
claiming more. That is expected and welcome — pretending is not.

## Accessibility

Accessibility is a requirement, not a follow-up: keyboard reachability, visible
focus, sufficient contrast, screen-reader semantics, scalable UI, respect for
"reduce motion" and Windows high-contrast. Do not let transparency or blur make
text unreadable — include a fallback.

## Review

Reviews check, in order: correctness, security, delta size, tests, honesty of
documentation. Feedback is expected to be direct but about the code. If a change
is blocked by a design decision, bring it to the issue rather than working around
it in code.

## Reporting bugs and requesting features

- Bugs: include build/revision (`chrome://aurelia` shows the pin), steps, and
  whether it reproduces in a clean profile.
- Security problems: **never** a public issue — see [SECURITY.md](SECURITY.md).
- Feature requests: describe the user problem first. "Add an AI sidebar" is out
  of scope by product decision; a concrete privacy or usability problem is not.

## License

By contributing you agree your contribution is licensed under MPL-2.0
([LICENSE](LICENSE)). Do not paste code from sources whose license you have not
verified, and never copy proprietary UI or assets.
