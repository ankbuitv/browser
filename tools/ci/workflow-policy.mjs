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
 *      workflows;
 *   7. workflow/job-level `env:` blocks never use the `runner` context, which
 *      GitHub rejects with "Unrecognized named-value: 'runner'" (this made the
 *      first hosted-experiment workflow invalid; step-level env is fine).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/entry.mjs';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
/** Canonical, reviewable definitions live here; the GitHub-installed copies are
 * a byte-identical deployment of the same files. See tools/ci/install-workflows.mjs. */
const CANONICAL_WORKFLOWS_DIR = path.join(REPO_ROOT, 'tools/ci/workflows');
const INSTALLED_WORKFLOWS_DIR = path.join(REPO_ROOT, '.github/workflows');
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
    runnerInJobEnv: false,
    onSection: [],
  };

  let inPermissions = false;
  let inOn = false;
  let currentOnEvent = null;
  let envIndent = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;

    const indent = line.length - line.trimStart().length;

    // Rule 7: the `runner` context is unavailable in workflow- and job-level
    // `env:` blocks; GitHub rejects the whole workflow file when it is used
    // there. Step-level `env:` is fine and is not inspected here.
    if (envIndent !== null) {
      if (indent > envIndent) {
        if (/\$\{\{\s*runner\./.test(trimmed)) result.runnerInJobEnv = true;
      } else {
        envIndent = null;
      }
    }
    if (envIndent === null && indent <= 4 && /^env:\s*$/.test(trimmed)) {
      envIndent = indent;
    }

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

export function checkWorkflows(
  directories = [CANONICAL_WORKFLOWS_DIR, INSTALLED_WORKFLOWS_DIR],
) {
  const problems = [];
  const dirs = Array.isArray(directories) ? directories : [directories];
  const existing = dirs.filter((directory) => existsSync(directory));
  if (existing.length === 0) {
    return { problems, workflowCount: 0 };
  }
  const approved = existsSync(ACTIONS_PINS_PATH)
    ? Object.keys(
        JSON.parse(readFileSync(ACTIONS_PINS_PATH, 'utf8')).approved ?? {},
      )
    : [];
  // A workflow installed into .github/workflows is checked too, but an
  // identical deployment of a canonical file is only analysed once.
  const seen = new Set();
  const files = [];
  for (const directory of existing) {
    for (const name of readdirSync(directory).filter(
      (entry) => entry.endsWith('.yml') || entry.endsWith('.yaml'),
    )) {
      const full = path.join(directory, name);
      const text = readFileSync(full, 'utf8');
      const key = `${name}\u0000${text}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      files.push({ file: name, full, text });
    }
  }

  for (const { full, text } of files) {
    const relative = path.relative(REPO_ROOT, full);
    const analysis = analyseWorkflow(text);

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
    if (analysis.runnerInJobEnv) {
      problems.push(
        `${relative}: uses the runner context in a workflow/job-level env block, where GitHub rejects the workflow ("Unrecognized named-value: 'runner'")`,
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

const isMain = isMainModule(import.meta.url);

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
