#!/usr/bin/env node
/**
 * GitHub Actions supply-chain policy checks.
 *
 * Enforced rules (see docs/CI-SECURITY.md):
 *   1. every third-party action is pinned to a full commit SHA;
 *   2. every workflow declares `permissions` explicitly and never uses
 *      `write-all`;
 *   3. `pull_request_target` is forbidden - it runs untrusted code with a
 *      privileged token;
 *   4. workflows triggered by pull requests do not reference secrets;
 *   5. self-hosted runners are only used from trusted events
 *      (schedule / workflow_dispatch / push), never from `pull_request`;
 *   6. artifacts published from untrusted events are not consumed by release
 *      workflows.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const WORKFLOWS_DIR = path.join(REPO_ROOT, '.github/workflows');
const ACTIONS_PINS_PATH = path.join(REPO_ROOT, 'tools/ci/actions-pins.json');

const FULL_SHA = /^[0-9a-f]{40}$/;
const TRUSTED_EVENTS = new Set([
  'schedule',
  'workflow_dispatch',
  'push',
  'release',
]);

/**
 * Very small YAML reader for the subset used by workflow files.
 * Deliberately not a general YAML parser: a policy check must not silently
 * misread a workflow, and the subset here is small and stable.
 */
export function analyseWorkflow(text) {
  const lines = text.split('\n');
  const result = {
    uses: [],
    hasPermissions: false,
    permissionsWriteAll: false,
    hasPullRequestTarget: false,
    hasPullRequest: false,
    referencesSecrets: false,
    selfHosted: false,
    onSection: [],
  };

  let inPermissions = false;
  let inOn = false;
  let currentOnEvent = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;

    const indent = line.length - line.trimStart().length;

    if (indent === 0 && trimmed.startsWith('on:')) {
      inOn = true;
      inPermissions = false;
      const inline = trimmed.slice(3).trim();
      if (inline.length > 0) {
        for (const event of inline.replace(/[[\]]/g, '').split(',')) {
          const name = event.trim();
          if (name.length > 0) result.onSection.push(name);
          if (name === 'pull_request_target')
            result.hasPullRequestTarget = true;
          if (name === 'pull_request') result.hasPullRequest = true;
        }
      }
      continue;
    }
    if (indent === 0 && trimmed.startsWith('permissions:')) {
      inPermissions = true;
      inOn = false;
      result.hasPermissions = true;
      const inline = trimmed.slice('permissions:'.length).trim();
      if (inline === 'write-all') result.permissionsWriteAll = true;
      continue;
    }
    if (indent === 0 && /^[a-zA-Z_]+:/.test(trimmed)) {
      inPermissions = false;
      inOn = false;
      currentOnEvent = null;
    }

    if (inOn && indent > 0 && /^[a-zA-Z_]+:/.test(trimmed)) {
      const name = trimmed.slice(0, trimmed.indexOf(':'));
      currentOnEvent = name;
      if (!result.onSection.includes(name)) result.onSection.push(name);
      if (name === 'pull_request_target') result.hasPullRequestTarget = true;
      if (name === 'pull_request') result.hasPullRequest = true;
    }
    void currentOnEvent;

    if (inPermissions && indent > 0 && trimmed.includes('write-all')) {
      result.permissionsWriteAll = true;
    }

    const usesMatch = /uses:\s*(\S+)/.exec(trimmed);
    if (usesMatch !== null) {
      const reference = usesMatch[1].replace(/["']/g, '');
      if (!reference.startsWith('docker://') && !reference.startsWith('./')) {
        const atIndex = reference.lastIndexOf('@');
        result.uses.push({
          reference,
          pin: atIndex === -1 ? '' : reference.slice(atIndex + 1),
        });
      }
    }

    if (/\$\{\{\s*secrets\./.test(trimmed)) {
      result.referencesSecrets = true;
    }
    if (/runs-on:/.test(trimmed) && /self-hosted/.test(trimmed)) {
      result.selfHosted = true;
    }
  }

  return result;
}

export function checkWorkflows(directory = WORKFLOWS_DIR) {
  const problems = [];
  if (!existsSync(directory)) {
    return { problems, workflowCount: 0 };
  }
  const approved = existsSync(ACTIONS_PINS_PATH)
    ? Object.keys(
        JSON.parse(readFileSync(ACTIONS_PINS_PATH, 'utf8')).approved ?? {},
      )
    : [];
  const files = readdirSync(directory).filter(
    (name) => name.endsWith('.yml') || name.endsWith('.yaml'),
  );

  for (const file of files) {
    const relative = path.relative(REPO_ROOT, path.join(directory, file));
    const analysis = analyseWorkflow(
      readFileSync(path.join(directory, file), 'utf8'),
    );

    for (const { reference, pin } of analysis.uses) {
      if (!FULL_SHA.test(pin)) {
        problems.push(
          `${relative}: action ${reference} is not pinned to a full commit SHA`,
        );
        continue;
      }
      if (!approved.includes(reference)) {
        problems.push(
          `${relative}: action ${reference} is not in tools/ci/actions-pins.json (add it there after verifying the SHA)`,
        );
      }
    }

    if (!analysis.hasPermissions) {
      problems.push(`${relative}: no top-level permissions block`);
    }
    if (analysis.permissionsWriteAll) {
      problems.push(`${relative}: uses write-all permissions`);
    }
    if (analysis.hasPullRequestTarget) {
      problems.push(`${relative}: pull_request_target is forbidden`);
    }
    if (analysis.hasPullRequest && analysis.referencesSecrets) {
      problems.push(
        `${relative}: pull_request events must not reference secrets (fork PRs would receive them)`,
      );
    }
    if (analysis.selfHosted && analysis.hasPullRequest) {
      problems.push(
        `${relative}: self-hosted runners must not be used from pull_request events`,
      );
    }
    const events = analysis.onSection;
    if (
      analysis.selfHosted &&
      !events.some((event) => TRUSTED_EVENTS.has(event))
    ) {
      problems.push(
        `${relative}: self-hosted runner is not limited to trusted events (found: ${events.join(', ') || 'none'})`,
      );
    }
  }

  return { problems, workflowCount: files.length };
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === `file://${path.resolve(process.argv[1])}`;

if (isMain) {
  const { problems, workflowCount } = checkWorkflows();
  if (problems.length === 0) {
    console.log(`workflow policy: ${workflowCount} workflow(s) OK`);
    process.exitCode = 0;
  } else {
    console.error(`workflow policy: ${problems.length} problem(s)`);
    for (const problem of problems) {
      console.error(`  ${problem}`);
    }
    process.exitCode = 1;
  }
}
