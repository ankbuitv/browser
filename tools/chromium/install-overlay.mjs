/**
 * Install the Aurelia overlay into a Chromium checkout and apply the patch set.
 *
 * This is the step that turns "a clone of Chromium" into "an Aurelia build
 * tree". It is intentionally boring and verifiable:
 *
 *   1. refuse to run unless the checkout is at the exact pinned revision;
 *   2. copy every overlay file into place (never overwriting a file that
 *      already exists with different contents, unless --force is given);
 *   3. verify the patch set applies (`git apply --check`) and then apply it;
 *   4. print a short report that goes into the build log.
 *
 * Usage:
 *   node tools/chromium/install-overlay.mjs --checkout <path> [--force] [--dry-run]
 */
import { existsSync, mkdirSync, readFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';

import { loadConfig, overlayDir, patchesDir } from './lib/config.mjs';
import { collectOverlayFiles } from './verify-patches.mjs';
import { listPatchFiles } from './verify-patches.mjs';
import { run, sha256 } from './lib/upstream.mjs';
import { isMainModule } from '../lib/entry.mjs';

export class CheckoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CheckoutError';
  }
}

/** Ensure the checkout is a Chromium tree at the pinned revision. */
export function assertPinnedCheckout(config, checkoutPath) {
  if (!existsSync(checkoutPath)) {
    throw new CheckoutError(`checkout does not exist: ${checkoutPath}`);
  }
  if (!existsSync(path.join(checkoutPath, 'chrome', 'VERSION'))) {
    throw new CheckoutError(
      `${checkoutPath} does not look like a Chromium checkout (chrome/VERSION is missing)`,
    );
  }
  let head;
  try {
    head = run('git', ['-C', checkoutPath, 'rev-parse', 'HEAD']).trim();
  } catch (error) {
    throw new CheckoutError(`cannot read the checkout revision: ${error.message}`);
  }
  if (head !== config.chromium.revision) {
    throw new CheckoutError(
      `checkout is at ${head} but the pinned revision is ${config.chromium.revision} (${config.chromium.version}). Run tools/chromium/sync.mjs first; never build an unpinned tree.`,
    );
  }
  // A dirty tree means a previous run may have partially applied the overlay.
  const status = run('git', ['-C', checkoutPath, 'status', '--porcelain']).trim();
  return { head, dirty: status.length > 0, status };
}

export function installOverlay({
  checkoutPath,
  force = false,
  dryRun = false,
  log = console.log,
  config = loadConfig(),
} = {}) {
  if (checkoutPath === undefined) {
    throw new CheckoutError('--checkout <path> is required');
  }
  const pinned = assertPinnedCheckout(config, checkoutPath);
  log(`checkout ${checkoutPath}`);
  log(`revision ${pinned.head}`);
  if (pinned.dirty) {
    log('warning: checkout already has modifications:');
    log(pinned.status);
  }

  const overlayRoot = overlayDir(config);
  const files = collectOverlayFiles(overlayRoot);
  if (files.length === 0) {
    throw new CheckoutError(`overlay directory is empty: ${overlayRoot}`);
  }

  const copied = [];
  const skipped = [];
  const conflicts = [];

  for (const file of files) {
    const source = path.join(overlayRoot, file.path);
    const target = path.join(checkoutPath, file.path);
    if (existsSync(target)) {
      const same =
        sha256(readFileSync(source)) === sha256(readFileSync(target));
      if (same) {
        skipped.push(file.path);
        continue;
      }
      if (!force) {
        conflicts.push(file.path);
        continue;
      }
    }
    if (dryRun) {
      copied.push(file.path);
      continue;
    }
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
    copied.push(file.path);
  }

  log(`overlay: ${copied.length} installed, ${skipped.length} unchanged`);
  if (conflicts.length > 0) {
    throw new CheckoutError(
      `refusing to overwrite local changes in:\n- ${conflicts.join('\n- ')}\nRe-run the checkout (tools/chromium/sync.mjs) or pass --force.`,
    );
  }

  const patchFiles = listPatchFiles(patchesDir(config));
  const applied = [];
  for (const patchName of patchFiles) {
    const patchPath = path.join(patchesDir(config), patchName);
    if (dryRun) {
      log(`would apply ${patchName}`);
      continue;
    }
    try {
      run('git', ['-C', checkoutPath, 'apply', '--check', patchPath]);
    } catch (error) {
      throw new CheckoutError(
        `patch ${patchName} does not apply to this checkout (upstream moved, or the pin is wrong):\n${error.message}`,
      );
    }
    run('git', ['-C', checkoutPath, 'apply', '--whitespace=nowarn', patchPath]);
    applied.push(patchName);
  }
  if (!dryRun) {
    log(`patches: ${applied.length} applied (${applied.join(', ')})`);
  }

  // Regenerate the GN files so a fresh checkout is ready to build.
  if (!dryRun) {
    log('next steps:');
    log('  gn gen out/Aurelia --args="is_component_build=false is_official_build=true"');
    log('  autoninja -C out/Aurelia chrome');
    log('  node tools/chromium/smoke-test.mjs --binary out/Aurelia/chrome.exe');
  }

  return { copied, skipped, applied, conflicts };
}

const isMain = isMainModule(import.meta.url);

if (isMain) {
  const checkoutIndex = process.argv.indexOf('--checkout');
  const checkoutPath = checkoutIndex === -1 ? undefined : process.argv[checkoutIndex + 1];
  try {
    installOverlay({
      checkoutPath,
      force: process.argv.includes('--force'),
      dryRun: process.argv.includes('--dry-run'),
    });
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  }
}
