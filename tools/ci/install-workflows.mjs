#!/usr/bin/env node
/**
 * Deploy the canonical workflow definitions into `.github/workflows/`.
 *
 * Why this exists: GitHub refuses to let a credential without the `workflows`
 * permission create or update anything under `.github/workflows/`. The
 * definitions therefore live in `tools/ci/workflows/` as ordinary, reviewable
 * files, and this script performs the one-way deployment once a maintainer (or
 * an agent with sufficient permission) is ready to publish them.
 *
 * Deployed copies are expected to be byte-identical to the canonical files.
 * A differing file is never silently overwritten: that is a policy question
 * (someone edited CI on GitHub directly), so `--force` is required and the
 * difference is reported.
 *
 * Usage:
 *   node tools/ci/install-workflows.mjs            # deploy, fail on differences
 *   node tools/ci/install-workflows.mjs --check    # report only, never writes
 *   node tools/ci/install-workflows.mjs --force    # overwrite differing files
 *
 * Exit codes: 0 when the deployment is complete and consistent, 1 otherwise.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/entry.mjs';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

export const CANONICAL_DIR = path.join(REPO_ROOT, 'tools/ci/workflows');
export const INSTALLED_DIR = path.join(REPO_ROOT, '.github/workflows');

const WORKFLOW_NAME = /\.ya?ml$/;

/**
 * Pending work between the canonical definitions and the installed copies.
 *
 * @param {object} [options]
 * @param {string} [options.sourceDir]
 * @param {string} [options.destDir]
 * @returns {{ workflows: string[], missing: string[], different: string[] }}
 */
export function compareWorkflows({
  sourceDir = CANONICAL_DIR,
  destDir = INSTALLED_DIR,
} = {}) {
  if (!existsSync(sourceDir)) {
    return { workflows: [], missing: [], different: [] };
  }
  const workflows = readdirSync(sourceDir)
    .filter((name) => WORKFLOW_NAME.test(name))
    .sort();
  const missing = [];
  const different = [];
  for (const name of workflows) {
    const installed = path.join(destDir, name);
    if (!existsSync(installed)) {
      missing.push(name);
      continue;
    }
    const same =
      readFileSync(path.join(sourceDir, name), 'utf8') ===
      readFileSync(installed, 'utf8');
    if (!same) {
      different.push(name);
    }
  }
  return { workflows, missing, different };
}

/**
 * Deploy the canonical definitions, or report what deployment would do.
 *
 * @param {object} [options]
 * @param {string} [options.sourceDir]
 * @param {string} [options.destDir]
 * @param {boolean} [options.check] report only, never write
 * @param {boolean} [options.force] overwrite differing files
 * @returns {{ workflows: string[], missing: string[], different: string[], written: string[], complete: boolean }}
 */
export function installWorkflows({
  sourceDir = CANONICAL_DIR,
  destDir = INSTALLED_DIR,
  check = false,
  force = false,
} = {}) {
  const { workflows, missing, different } = compareWorkflows({
    sourceDir,
    destDir,
  });
  const written = [];
  let complete;
  if (check) {
    complete = missing.length === 0 && different.length === 0;
  } else {
    if (missing.length > 0) {
      mkdirSync(destDir, { recursive: true });
      for (const name of missing) {
        copyFileSync(path.join(sourceDir, name), path.join(destDir, name));
        written.push(name);
      }
    }
    if (force) {
      for (const name of different) {
        copyFileSync(path.join(sourceDir, name), path.join(destDir, name));
        written.push(name);
      }
    }
    // Re-read: what matters is the state on disk after the deployment, not
    // what it looked like before it.
    const after = compareWorkflows({ sourceDir, destDir });
    complete = after.missing.length === 0 && after.different.length === 0;
  }
  return { workflows, missing, different, written, complete };
}

const isMain = isMainModule(import.meta.url);

if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Install the canonical workflow definitions into .github/workflows/.

  --check   report what is missing or different, never write
  --force   overwrite installed files that differ from the canonical copy

Publishing the result requires a GitHub credential with the "workflows"
permission; see docs/CI-SECURITY.md.`);
    process.exitCode = 0;
  } else {
    const check = args.includes('--check');
    const force = args.includes('--force');
    const { workflows, missing, different, written, complete } =
      installWorkflows({ check, force });

    console.log(
      `${check ? 'workflow deployment check' : 'workflow deployment'}: ${workflows.length} canonical definition(s)`,
    );
    if (written.length > 0) {
      console.log(`  written: ${written.join(', ')}`);
    }
    for (const name of missing) {
      console.log(`  ${check ? 'NOT INSTALLED' : 'installed'}: ${name}`);
    }
    for (const name of different) {
      console.log(
        `  DIFFERS from tools/ci/workflows/${name}` +
          (force
            ? ' (overwritten)'
            : check
              ? ''
              : ' (left in place — review the difference, then re-run with --force)'),
      );
    }
    if (missing.length === 0 && different.length === 0) {
      console.log(
        '  installed copies are byte-identical to the canonical files',
      );
    }
    process.exitCode = complete ? 0 : 1;
  }
}
