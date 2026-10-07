#!/usr/bin/env node
/**
 * Aurelia's Chromium maintenance CLI.
 *
 * Subcommands:
 *   status                 pin, patch set and fork-delta summary (offline)
 *   plan                   exactly what install-overlay would change (offline)
 *   list-patches           patch inventory with per-file reasons (offline)
 *   verify-patches         offline patch verification (add --online for upstream)
 *   generate-patch         regenerate patches from the pinned pre-images
 *   generate-version       regenerate aurelia_version.h from the pin config
 *   check-updates          report available Chromium updates (never merges)
 *   fork-delta             machine-readable fork-delta metrics (--check: budget)
 *
 * Exit codes: 0 success, 1 failure (CI treats any non-zero as a problem).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { REPO_ROOT, loadConfig, patchesDir, overlayDir, upstreamSlug } from './lib/config.mjs';
import { UPSTREAM_EDITS, summariseEdits } from './lib/upstream-edits.mjs';
import { collectOverlayFiles, listPatchFiles, formatChecks, verifyOffline, verifyOnline } from './verify-patches.mjs';
import { generatePatch } from './generate-patch.mjs';
import { generateVersionHeader } from './lib/version-header.mjs';
import { run } from './lib/upstream.mjs';

const USAGE = `Aurelia Chromium maintenance CLI

usage: node tools/chromium/cli.mjs <command> [options]

commands:
  status                 pin, patch set and fork-delta summary
  plan                   show what install-overlay.mjs would change
  list-patches           patch inventory (file, reason, rebase difficulty)
  verify-patches         verify the patch set (--online to check upstream)
  generate-patch         regenerate patches from the pinned pre-images
  generate-version       regenerate the compiled-in version header
  check-updates          report newer Chromium revisions (never merges)
  fork-delta             machine-readable fork-delta metrics (--check: budget)

options:
  --online               allow network access (verify-patches, check-updates)
  --checkout <path>      use a local Chromium checkout (git transport)
  --json                 machine-readable output where supported
`;

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function relative(filePath) {
  return path.relative(REPO_ROOT, filePath);
}

function commandStatus(config) {
  console.log(`Aurelia pin`);
  console.log(`  product:        ${config.product.codename} ${config.product.version} (codename only: ${config.product.nameIsCodenameOnly})`);
  console.log(`  channel:        ${config.product.channel}`);
  console.log(`  chromium:       ${config.chromium.version} (${config.chromium.channel}, M${config.chromium.milestone})`);
  console.log(`  revision:       ${config.chromium.revision}`);
  console.log(`  upstream:       ${config.chromium.upstreamRepository}`);
  console.log(`  pinned at:      ${config.chromium.pinnedAt} by ${config.chromium.pinnedBy}`);
  console.log('');

  const patches = listPatchFiles(patchesDir(config));
  console.log(`Patch set ${config.patchSet.version} (${patches.length} patch file(s))`);
  for (const patchName of patches) {
    const metaPath = path.join(patchesDir(config), patchName.replace(/\.patch$/, '.meta.json'));
    if (!existsSync(metaPath)) {
      console.log(`  ${patchName}  (no metadata)`);
      continue;
    }
    const meta = readJson(metaPath);
    console.log(
      `  ${patchName}  ${meta.summary.filesModified} file(s), +${meta.summary.linesAdded}/-${meta.summary.linesRemoved}`,
    );
    for (const file of meta.files) {
      console.log(`      ${file.path}  [${file.component}] ${file.reason}`);
    }
  }
  console.log('');

  const overlayFiles = collectOverlayFiles(overlayDir(config));
  const overlayBytes = overlayFiles.reduce((total, file) => total + file.bytes, 0);
  const edits = summariseEdits(UPSTREAM_EDITS);
  console.log('Fork delta');
  console.log(`  upstream files modified: ${edits.modifiedFiles}`);
  console.log(`  individual edits:        ${edits.editCount}`);
  console.log(`  overlay files added:     ${overlayFiles.length} (${overlayBytes} bytes)`);
  console.log(`  patches:                 ${patches.length}`);
  console.log('');
  console.log('Details and rebase expectations: docs/FORK-DELTA.md');
}

function commandPlan(config) {
  const overlayFiles = collectOverlayFiles(overlayDir(config));
  console.log(`install-overlay would, against a checkout of ${config.chromium.revision.slice(0, 12)}:`);
  console.log('');
  console.log(`  copy ${overlayFiles.length} overlay file(s):`);
  for (const file of overlayFiles) {
    console.log(`    + ${file.path}`);
  }
  console.log('');
  for (const patchName of listPatchFiles(patchesDir(config))) {
    const metaPath = path.join(patchesDir(config), patchName.replace(/\.patch$/, '.meta.json'));
    const meta = existsSync(metaPath) ? readJson(metaPath) : null;
    console.log(`  apply ${patchName}`);
    if (meta !== null) {
      for (const file of meta.files) {
        console.log(`    M ${file.path}  (+${file.added}/-${file.removed})`);
      }
    }
  }
  console.log('');
  console.log('Never build a tree that has not been produced by this tooling.');
}

function commandListPatches(config) {
  for (const patchName of listPatchFiles(patchesDir(config))) {
    const metaPath = path.join(patchesDir(config), patchName.replace(/\.patch$/, '.meta.json'));
    const meta = existsSync(metaPath) ? readJson(metaPath) : null;
    console.log(patchName);
    if (meta === null) {
      console.log('  (no metadata)');
      continue;
    }
    console.log(`  title:      ${meta.title}`);
    console.log(`  base:       ${meta.baseVersion} (${meta.baseRevision})`);
    console.log(`  difficulty: ${[...new Set(meta.files.map((file) => file.rebaseDifficulty))].join(', ')}`);
    for (const file of meta.files) {
      console.log(`  - ${file.path}`);
      console.log(`      component: ${file.component}`);
      console.log(`      reason:    ${file.reason}`);
      console.log(`      overlay?   ${file.couldBecomeOverlay ? 'could become an overlay file' : 'must stay a patch'}`);
      console.log(`      upstream?  ${file.upstreamable}`);
    }
  }
}

function commandVerify(config, argv) {
  const online = argv.includes('--online');
  const checkoutIndex = argv.indexOf('--checkout');
  const checkoutPath = checkoutIndex === -1 ? undefined : argv[checkoutIndex + 1];

  if (online || checkoutPath !== undefined) {
    console.log(
      `verifying patch set against the pinned revision (${checkoutPath === undefined ? 'upstream API' : checkoutPath})`,
    );
    const result = verifyOnline({ checkoutPath, config });
    console.log(formatChecks(result.checks));
    console.log('');
    console.log(
      result.ok
        ? 'patch set verified against the pinned revision (this does NOT prove Chromium compiles)'
        : 'PATCH SET VERIFICATION FAILED',
    );
    return result.ok ? 0 : 1;
  }

  const result = verifyOffline(config);
  console.log(formatChecks(result.checks));
  console.log('');
  console.log(
    result.ok
      ? 'offline checks passed (run with --online to verify against the pinned upstream revision)'
      : 'OFFLINE CHECKS FAILED',
  );
  return result.ok ? 0 : 1;
}

function commandGeneratePatch(argv) {
  const checkoutIndex = argv.indexOf('--checkout');
  const checkoutPath = checkoutIndex === -1 ? undefined : argv[checkoutIndex + 1];
  const result = generatePatch({ checkoutPath, log: console.log });
  console.log(`wrote ${relative(result.patchPath)}`);
  console.log(`wrote ${relative(result.metaPath)}`);
  console.log(
    `delta: ${result.meta.summary.filesModified} file(s), +${result.meta.summary.linesAdded}/-${result.meta.summary.linesRemoved}`,
  );
  return 0;
}

function commandGenerateVersion() {
  const result = generateVersionHeader({ check: false });
  console.log(
    result.changed
      ? `wrote ${relative(result.path)}`
      : `${relative(result.path)} already up to date`,
  );
  return 0;
}

/**
 * Report Chromium updates. This command never edits configuration: a human
 * merges a pin change after the patch set has been verified (see
 * docs/CHROMIUM-UPSTREAM.md).
 */
function commandCheckUpdates(config) {
  const slug = upstreamSlug(config);
  if (slug === null) {
    console.log('upstream is not hosted on github.com; use a local checkout to check for updates');
    return 0;
  }

  let tags;
  try {
    const raw = run('gh', [
      'api',
      `repos/${slug}/tags?per_page=100`,
      '--jq',
      '.[].name',
    ]);
    tags = raw.split('\n').filter((name) => name.length > 0);
  } catch (error) {
    console.log(`could not list upstream tags (network or authentication problem): ${error.message}`);
    return 1;
  }

  const parsed = tags
    .map((name) => {
      const parts = name.split('.');
      if (parts.length !== 4) return null;
      const [major, minor, build, patchLevel] = parts;
      if (![major, minor, build, patchLevel].every((part) => /^\d+$/.test(part))) {
        return null;
      }
      return {
        name,
        milestone: Number(major),
        build: Number(build),
        patchLevel: Number(patchLevel),
      };
    })
    .filter((entry) => entry !== null);

  const pinned = {
    milestone: config.chromium.milestone,
    build: Number(config.chromium.version.split('.')[2]),
    patchLevel: Number(config.chromium.version.split('.')[3]),
  };

  const newerSameMilestone = parsed
    .filter(
      (entry) =>
        entry.milestone === pinned.milestone &&
        entry.build === pinned.build &&
        entry.patchLevel > pinned.patchLevel,
    )
    .sort((left, right) => left.patchLevel - right.patchLevel);

  const newerMilestones = [
    ...new Set(parsed.filter((entry) => entry.milestone > pinned.milestone).map((entry) => entry.milestone)),
  ].sort((left, right) => left - right);

  console.log(`pinned: ${config.chromium.version} (M${pinned.milestone}, build ${pinned.build}, patch ${pinned.patchLevel})`);
  console.log('');
  if (newerSameMilestone.length > 0) {
    const latest = newerSameMilestone[newerSameMilestone.length - 1];
    console.log(`newer builds on the pinned milestone: ${newerSameMilestone.length}`);
    console.log(`  latest candidate: ${latest.name}  (security updates land here)`);
  } else {
    console.log('no newer build found on the pinned milestone (upstream tag list is paginated; verify on chromiumdash for release-channel truth)');
  }
  if (newerMilestones.length > 0) {
    console.log(`newer milestones available upstream: ${newerMilestones.join(', ')}`);
  }
  console.log('');
  console.log('Reminder: nothing is merged automatically. A pin change needs');
  console.log('  1. patch verification against the candidate revision,');
  console.log('  2. a heavy build + smoke test,');
  console.log('  3. maintainer review.');
  return 0;
}

/**
 * The reviewed fork-delta budget. Keeping the delta small is a product
 * requirement - it is what makes Chromium security updates land quickly - so
 * growing past this budget is a decision for a review, not a side effect of a
 * build. See docs/FORK-DELTA.md.
 */
const FORK_DELTA_BUDGET = { modifiedUpstreamFiles: 10, addedLines: 50 };

function commandForkDelta(config, argv) {
  const patches = listPatchFiles(patchesDir(config));
  const metas = patches
    .map((name) => {
      const metaPath = path.join(patchesDir(config), name.replace(/\.patch$/, '.meta.json'));
      return existsSync(metaPath) ? readJson(metaPath) : null;
    })
    .filter((meta) => meta !== null);

  const overlayFiles = collectOverlayFiles(overlayDir(config));
  const metrics = {
    baseRevision: config.chromium.revision,
    baseVersion: config.chromium.version,
    patchSetVersion: config.patchSet.version,
    patchCount: patches.length,
    modifiedUpstreamFiles: metas.reduce((total, meta) => total + meta.summary.filesModified, 0),
    addedLines: metas.reduce((total, meta) => total + meta.summary.linesAdded, 0),
    removedLines: metas.reduce((total, meta) => total + meta.summary.linesRemoved, 0),
    overlayFileCount: overlayFiles.length,
    overlayBytes: overlayFiles.reduce((total, file) => total + file.bytes, 0),
    files: metas.flatMap((meta) =>
      meta.files.map((file) => ({
        path: file.path,
        component: file.component,
        rebaseDifficulty: file.rebaseDifficulty,
        couldBecomeOverlay: file.couldBecomeOverlay,
        upstreamable: file.upstreamable,
      })),
    ),
  };

  if (argv.includes('--json')) {
    console.log(JSON.stringify(metrics, null, 2));
  } else {
    console.log(`modified upstream files: ${metrics.modifiedUpstreamFiles}`);
    console.log(`added/removed lines:     +${metrics.addedLines}/-${metrics.removedLines}`);
    console.log(`overlay files:           ${metrics.overlayFileCount} (${metrics.overlayBytes} bytes)`);
  }

  if (argv.includes('--check')) {
    const problems = [];
    if (metrics.modifiedUpstreamFiles > FORK_DELTA_BUDGET.modifiedUpstreamFiles) {
      problems.push(
        `modified upstream files: ${metrics.modifiedUpstreamFiles} > budget ${FORK_DELTA_BUDGET.modifiedUpstreamFiles}`,
      );
    }
    if (metrics.addedLines > FORK_DELTA_BUDGET.addedLines) {
      problems.push(`added lines: ${metrics.addedLines} > budget ${FORK_DELTA_BUDGET.addedLines}`);
    }
    if (problems.length > 0) {
      console.error('FORK DELTA BUDGET EXCEEDED (review docs/FORK-DELTA.md before raising it):');
      for (const problem of problems) {
        console.error(`  ${problem}`);
      }
      return 1;
    }
    console.log(
      `fork delta within budget (<= ${FORK_DELTA_BUDGET.modifiedUpstreamFiles} files, <= ${FORK_DELTA_BUDGET.addedLines} added lines)`,
    );
  }
  return 0;
}

function main(argv) {
  const command = argv[0];
  const config = loadConfig();

  switch (command) {
    case 'status':
      commandStatus(config);
      return 0;
    case 'plan':
      commandPlan(config);
      return 0;
    case 'list-patches':
      commandListPatches(config);
      return 0;
    case 'verify-patches':
      return commandVerify(config, argv);
    case 'generate-patch':
      return commandGeneratePatch(argv);
    case 'generate-version':
      return commandGenerateVersion();
    case 'check-updates':
      return commandCheckUpdates(config);
    case 'fork-delta':
      return commandForkDelta(config, argv);
    case undefined:
    case '--help':
    case '-h':
    case 'help':
      console.log(USAGE);
      return 0;
    default:
      console.error(`unknown command: ${command}\n`);
      console.log(USAGE);
      return 1;
  }
}

process.exitCode = main(process.argv.slice(2));
