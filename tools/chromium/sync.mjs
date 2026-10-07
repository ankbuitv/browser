#!/usr/bin/env node
/**
 * Reproducible Chromium checkout for an adequately provisioned machine.
 *
 * This script is deliberately NOT run in the fast CI or in small sandboxes: a
 * Chromium source tree plus its dependencies needs well over 100 GB and takes a
 * long time to fetch. See docs/BUILDING-CHROMIUM.md for measured requirements.
 *
 * What it does:
 *   1. preflight: disk space, platform, and whether depot_tools is available;
 *   2. fetch/refresh depot_tools and check out the pinned revision if one is
 *      recorded in config/chromium_version.json;
 *   3. create the gclient solution for the pinned Chromium revision and sync
 *      dependencies (branch heads and tags are only fetched with --with-refs:
 *      they cost a lot of time and disk and the pinned revision does not need
 *      them);
 *   4. verify the checkout HEAD equals the pinned revision;
 *   5. optionally install the Aurelia overlay and patch set.
 *
 * Constrained checkouts (HOSTED_CONSTRAINED_EXPERIMENT, see
 * docs/HOSTED-CONSTRAINED-EXPERIMENT.md) add three documented reductions that
 * change how much is *fetched* and never what is *built*:
 *
 *   --no-history        ask gclient for a shallow clone (used only when the
 *                       installed depot_tools advertises the flag)
 *   --target-os win     write `target_os = ["win"]` into .gclient so another
 *                       platform's SDKs and NDKs are not fetched
 *   --small-checkout    write `custom_vars = {"checkout_configuration":
 *                       "small"}` so DEPS skips the optional test-asset bundles
 *
 * Usage:
 *   node tools/chromium/sync.mjs --dest C:\\chromium --install
 *   node tools/chromium/sync.mjs --dest /srv/chromium --check-only
 *   node tools/chromium/sync.mjs --record-depot-tools <sha>
 *   node tools/chromium/sync.mjs --dest C:\\chromium --with-refs   # + branch heads/tags
 *   node tools/chromium/sync.mjs --dest D:\\chromium --low-resource-experiment \
 *       --no-history --target-os win --small-checkout
 */
import { existsSync, mkdirSync, readFileSync, statfsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { REPO_ROOT, loadConfig, CONFIG_PATH } from './lib/config.mjs';
import { installOverlay } from './install-overlay.mjs';
import { run } from './lib/upstream.mjs';
import { captureCommand, spawnCommand } from './lib/exec.mjs';
import { isMainModule } from '../lib/entry.mjs';
import { EXPERIMENT_DISK, LOW_RESOURCE_MODE } from './low-resource.mjs';

const CHROMIUM_SOURCE_URL =
  'https://chromium.googlesource.com/chromium/src.git';

/**
 * The gclient flag that turns a clone into a shallow one.
 *
 * Documented by upstream at the pinned revision
 * (docs/windows_build_instructions.md: "If you don't want the full repo
 * history, you can save a lot of time by adding the `--no-history` flag to
 * `fetch`"), and `fetch` forwards it to `gclient sync` verbatim. Whether the
 * *installed* depot_tools still accepts it is not assumed: `syncCheckout`
 * asks `gclient help sync` before using it (see `detectNoHistorySupport`).
 */
export const NO_HISTORY_FLAG = '--no-history';

/**
 * The gclient flag that fetches sources and dependencies without running the
 * DEPS hooks.
 *
 * The hooks are where Chromium downloads the pinned Visual Studio toolchain
 * and Windows SDK (build/vs_toolchain.py -> get_toolchain_if_necessary.py).
 * That is the one network step that is large, opaque and not resumable, so
 * the constrained experiment keeps it out of the hour-long sync and runs it
 * on its own, where it can be retried and its failure read.
 */
export const NO_HOOKS_FLAG = '--nohooks';

/**
 * The .gclient text for a checkout.
 *
 * Two optional, DEPS-documented reductions are supported, and both are off by
 * default so an ordinary checkout is byte-for-byte what it was before:
 *
 *   target_os            - added to the solution when a list of operating
 *                          systems is given. gclient.py documents it:
 *                          "An optional key named 'target_os' may be added to
 *                          a gclient file to specify one or more additional
 *                          operating systems that should be considered when
 *                          processing the deps_os/hooks_os dict of a DEPS
 *                          file." Chromium's DEPS gates platform payloads on
 *                          it (`condition: 'checkout_android'` appears 14
 *                          times, `'checkout_win'` 29 times at the pinned
 *                          revision), so naming the host OS is how a
 *                          single-platform build avoids fetching another
 *                          platform's SDKs and NDKs.
 *
 *   custom_vars          - DEPS itself documents
 *                          `"custom_vars": {"checkout_configuration":
 *                          "small"}` as the way "to skip things [that] are
 *                          not strictly needed to build chromium for
 *                          development purposes" (it gates the Meet GPU test
 *                          asset bundles, ~278 MB, and the press-benchmark
 *                          archives).
 *
 * Neither switch touches the revision, the patch set, or anything that
 * changes what the built browser is allowed to do.
 *
 * @param {{targetOs?: string[], smallCheckout?: boolean}} [options]
 */
export function gclientFileText({ targetOs = null, smallCheckout = false } = {}) {
  // Small values only: the file is Python and is read back by gclient, so the
  // quoting stays flat and obvious rather than generic.
  const customVars = smallCheckout
    ? '{ "checkout_configuration": "small" }'
    : '{}';
  const lines = [
    '# Aurelia Browser - generated by tools/chromium/sync.mjs.',
    '# Do not edit by hand; the pinned revision is managed by the tooling.',
    'solutions = [',
    '  {',
    '    "name": "src",',
    `    "url": "${CHROMIUM_SOURCE_URL}",`,
    '    "managed": False,',
    '    "custom_deps": {},',
    `    "custom_vars": ${customVars},`,
  ];
  if (Array.isArray(targetOs) && targetOs.length > 0) {
    const rendered = targetOs.map((os) => `"${os}"`).join(', ');
    lines.push(`    "target_os": [${rendered}],`);
  }
  lines.push('  },', ']', '');
  return lines.join('\n');
}

/**
 * Does the installed depot_tools understand `--no-history`?
 *
 * Asked, never assumed: the flag is documented at the pinned revision, but
 * depot_tools is a moving dependency and an unknown option makes `gclient
 * sync` fail before it fetches anything. The check is one `gclient help sync`
 * (a few hundred milliseconds) and its result is recorded, so the evidence
 * report states which of the two sync shapes actually ran.
 *
 * @returns {boolean} true when the help text lists the flag
 */
export function detectNoHistorySupport(depotTools, { log = () => {} } = {}) {
  let result;
  try {
    result = captureCommand(
      {
        file: gclientExecutable(depotTools),
        args: ['help', 'sync'],
        cwd: depotTools,
      },
      { env: process.env },
    );
  } catch (error) {
    log(
      `--no-history support could not be determined (${error.message}); syncing with full history`,
    );
    return false;
  }
  const supported = result.includes(NO_HISTORY_FLAG);
  log(
    supported
      ? 'gclient help sync lists --no-history: the checkout will be shallow'
      : 'gclient help sync does not list --no-history: the checkout will carry full history',
  );
  return supported;
}

/**
 * The argument list for one `gclient sync` invocation.
 *
 * Kept pure so the reduction can be unit-tested without a depot_tools
 * installation: `--no-history` is only emitted when it was asked for *and*
 * the installed gclient advertises it.
 */
export function resolveSyncArgs({
  revision,
  withRefs = false,
  noHistory = false,
  supportsNoHistory = false,
  noHooks = false,
} = {}) {
  if (typeof revision !== 'string' || revision.length === 0) {
    throw new Error('resolveSyncArgs requires a pinned revision');
  }
  const args = ['sync', '--revision', `src@${revision}`];
  if (withRefs) {
    args.push('--with_branch_heads', '--with_tags');
  }
  if (noHistory && supportsNoHistory) {
    args.push(NO_HISTORY_FLAG);
  }
  if (noHooks) {
    args.push(NO_HOOKS_FLAG);
  }
  return args;
}

/** Minimum free space in GB before we even try: source + deps + build output. */
export const MINIMUM_FREE_DISK_GB = 150;

/**
 * Disk floor for LOW_RESOURCE_EXPERIMENT runs.
 *
 * The documented builder minimum (150 GB) is never lowered: this is a *second*
 * floor that only applies when the caller passes --low-resource-experiment, and
 * it comes from the same policy module the bootstrap script uses
 * (tools/chromium/low-resource.mjs) so the numbers change in one place only.
 */
export function diskFloorGb({ lowResourceExperiment = false } = {}) {
  return lowResourceExperiment
    ? EXPERIMENT_DISK.hardMinimumFreeGb
    : MINIMUM_FREE_DISK_GB;
}

/**
 * Free space in GB, cross-platform.
 *
 * `fs.statfsSync` is used first because it works on Linux, macOS and Windows
 * (the heavy builder is a native Windows runner, where `df` does not exist).
 * `df` remains as a fallback for filesystems statfs cannot report.
 */
export function freeDiskGb(targetPath) {
  try {
    const stats = statfsSync(targetPath);
    const available = Number(stats.bavail) * Number(stats.bsize);
    if (Number.isFinite(available) && available > 0) {
      return available / 1024 ** 3;
    }
  } catch {
    // fall through to df
  }
  const output = run('df', ['-P', '-k', targetPath]);
  const lines = output.trim().split('\n');
  const columns = lines[lines.length - 1].split(/\s+/);
  const availableKb = Number(columns[3]);
  if (!Number.isFinite(availableKb)) {
    throw new Error(`could not parse df output: ${output}`);
  }
  return availableKb / (1024 * 1024);
}

/** Platform-specific name of the gclient entry point. */
export function gclientExecutable(depotTools) {
  return path.join(
    depotTools,
    process.platform === 'win32' ? 'gclient.bat' : 'gclient',
  );
}

export function preflight({ dest, config, lowResourceExperiment = false }) {
  const reports = [];
  const problems = [];
  const floorGb = diskFloorGb({ lowResourceExperiment });

  let probePath = dest;
  while (!existsSync(probePath) && probePath !== path.dirname(probePath)) {
    probePath = path.dirname(probePath);
  }
  try {
    const freeGb = freeDiskGb(probePath);
    const ok = freeGb >= floorGb;
    if (lowResourceExperiment) {
      reports.push(
        `free disk at ${probePath}: ${freeGb.toFixed(1)} GB (${LOW_RESOURCE_MODE} floor ${floorGb} GB; about ${EXPERIMENT_DISK.estimatedFootprintGb} GB used, ${EXPERIMENT_DISK.safetyReserveGb} GB reserve never filled)`,
      );
    } else {
      reports.push(
        `free disk at ${probePath}: ${freeGb.toFixed(1)} GB (need >= ${floorGb} GB)`,
      );
    }
    if (!ok) {
      problems.push(
        lowResourceExperiment
          ? `insufficient free disk: ${freeGb.toFixed(1)} GB available, ${floorGb} GB required for ${LOW_RESOURCE_MODE} (about ${EXPERIMENT_DISK.estimatedFootprintGb} GB footprint plus a ${EXPERIMENT_DISK.safetyReserveGb} GB reserve)`
          : `insufficient free disk: ${freeGb.toFixed(1)} GB available, ${floorGb} GB required`,
      );
    }
  } catch (error) {
    reports.push(`free disk: could not determine (${error.message})`);
  }

  if (config.toolchain?.depotTools?.revision === null) {
    reports.push(
      'depot_tools revision is unresolved in config/chromium_version.json; the checkout will use whatever revision is present and must be recorded afterwards',
    );
  }

  return { reports, problems };
}

function depotToolsDir(dest) {
  return path.join(dest, 'depot_tools');
}

export function ensureDepotTools({ dest, config, log }) {
  const toolchain = config.toolchain?.depotTools;
  const directory = depotToolsDir(dest);

  if (existsSync(directory)) {
    const current = run('git', ['-C', directory, 'rev-parse', 'HEAD']).trim();
    log(`depot_tools present at ${current}`);
    if (toolchain?.revision != null && current !== toolchain.revision) {
      log(`checking out pinned depot_tools ${toolchain.revision}`);
      // Fetch the refs first, then check out the revision: not every git host
      // allows fetching an arbitrary SHA directly, but every host serves the
      // history the pinned revision lives in.
      run('git', ['-C', directory, 'fetch', '--prune', 'origin']);
      run('git', ['-C', directory, 'checkout', '--detach', toolchain.revision]);
    }
    return directory;
  }

  if (toolchain?.source === undefined) {
    throw new Error('config/chromium_version.json has no toolchain.depotTools.source');
  }
  log(`cloning depot_tools from ${toolchain.source}`);
  mkdirSync(dest, { recursive: true });
  run('git', ['clone', toolchain.source, directory]);
  if (toolchain.revision != null) {
    run('git', ['-C', directory, 'checkout', '--detach', toolchain.revision]);
  }
  return directory;
}

/**
 * Write the .gclient file and return its path.
 *
 * `options` is forwarded to `gclientFileText`, so the constrained reductions
 * (`target_os`, `checkout_configuration = "small"`) are decided by the caller
 * and recorded in the file itself - a reviewer can read what a checkout asked
 * for without reading the workflow that produced it.
 */
function writeGclientFile(dest, options = {}) {
  const gclientPath = path.join(dest, '.gclient');
  writeFileSync(gclientPath, gclientFileText(options));
  return gclientPath;
}

export function syncCheckout({
  dest,
  install = false,
  withRefs = false,
  lowResourceExperiment = false,
  noHistory = false,
  noHooks = false,
  targetOs = null,
  smallCheckout = false,
  config,
  log = console.log,
}) {
  const preflightResult = preflight({ dest, config, lowResourceExperiment });
  for (const report of preflightResult.reports) {
    log(`preflight: ${report}`);
  }
  if (preflightResult.problems.length > 0) {
    throw new Error(preflightResult.problems.join('; '));
  }

  const depotTools = ensureDepotTools({ dest, config, log });
  const supportsNoHistory = noHistory
    ? detectNoHistorySupport(depotTools, { log })
    : false;
  const gclientPath = writeGclientFile(dest, { targetOs, smallCheckout });
  log(
    `.gclient: ${gclientPath}${
      Array.isArray(targetOs) && targetOs.length > 0
        ? ` (target_os = ${targetOs.join(', ')})`
        : ''
    }${smallCheckout ? ' (checkout_configuration = small)' : ''}`,
  );

  // Spread the ambient environment: Windows needs SystemRoot, TEMP and
  // USERPROFILE for Python and git to work at all, and a stripped environment
  // would fail in ways that look like unrelated toolchain errors.
  const env = {
    ...process.env,
    PATH: `${depotTools}${path.delimiter}${process.env.PATH ?? ''}`,
    DEPOT_TOOLS_UPDATE: '0',
    GCLIENT_PY3: '1',
  };

  const srcDir = path.join(dest, 'src');
  log(`syncing Chromium at ${config.chromium.revision} (${config.chromium.version})`);
  if (existsSync(path.join(srcDir, '.git'))) {
    // Plain fetch, not a fetch by SHA: not every git host allows fetching an
    // arbitrary object, but every host serves the history the pin lives in.
    run('git', ['-C', srcDir, 'fetch', '--prune', 'origin']);
  }
  const syncArgs = resolveSyncArgs({
    revision: config.chromium.revision,
    withRefs,
    noHistory,
    supportsNoHistory,
    noHooks,
  });
  // Streamed, not captured: a sync takes tens of minutes and writes progress
  // the operator wants to see. On Windows this goes through cmd.exe
  // (lib/exec.mjs) because `gclient` is `gclient.bat` there.
  log(`$ gclient ${syncArgs.join(' ')}`);
  const sync = spawnCommand(
    { file: gclientExecutable(depotTools), args: syncArgs, cwd: dest },
    { env },
  );
  if (sync.error !== undefined) {
    throw new Error(`gclient could not be started: ${sync.error.message}`);
  }
  if (sync.status !== 0) {
    throw new Error(`gclient sync exited with code ${sync.status}`);
  }

  const head = run('git', ['-C', srcDir, 'rev-parse', 'HEAD']).trim();
  if (head !== config.chromium.revision) {
    throw new Error(
      `checkout HEAD is ${head} but the pinned revision is ${config.chromium.revision}; refusing to continue`,
    );
  }
  log(`checkout verified at the pinned revision`);

  if (install) {
    installOverlay({ checkoutPath: srcDir, log, config });
  } else {
    log('overlay not installed (pass --install to do so)');
  }

  return { srcDir, head };
}

function recordDepotTools(revision) {
  if (!/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error('expected a full 40-character commit SHA');
  }
  const raw = readFileSync(CONFIG_PATH, 'utf8');
  const config = JSON.parse(raw);
  if (config.toolchain?.depotTools === undefined) {
    throw new Error('config has no toolchain.depotTools section');
  }
  config.toolchain.depotTools.revision = revision;
  config.toolchain.depotTools.revisionStatus = 'pinned';
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`recorded depot_tools revision ${revision} in ${path.relative(REPO_ROOT, CONFIG_PATH)}`);
}

function main(argv) {
  const config = loadConfig();
  const valueOf = (flag) => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  /** `--target-os win` or `--target-os win,mac` -> ['win', 'win,mac'] entries. */
  const parseList = (args, flag) => {
    const value = args.indexOf(flag) === -1
      ? undefined
      : args[args.indexOf(flag) + 1];
    if (value === undefined) {
      return null;
    }
    const entries = value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    if (entries.length === 0) {
      throw new Error(`${flag} needs at least one value (for example: win)`);
    }
    const unknown = entries.filter((entry) => !/^[a-z][a-z0-9_]*$/.test(entry));
    if (unknown.length > 0) {
      throw new Error(`${flag} got an invalid value: ${unknown.join(', ')}`);
    }
    return entries;
  };

  if (argv.includes('--record-depot-tools')) {
    const revision = valueOf('--record-depot-tools');
    if (revision === undefined) {
      throw new Error('--record-depot-tools requires a commit SHA');
    }
    recordDepotTools(revision);
    return 0;
  }

  const dest = valueOf('--dest') ?? process.env.AURELIA_CHROMIUM_DEST;
  if (dest === undefined) {
    throw new Error('--dest <directory> is required (or set AURELIA_CHROMIUM_DEST)');
  }

  if (argv.includes('--check-only')) {
    const preflightResult = preflight({
      dest,
      config,
      lowResourceExperiment: argv.includes('--low-resource-experiment'),
    });
    for (const report of preflightResult.reports) {
      console.log(`preflight: ${report}`);
    }
    console.log(
      preflightResult.problems.length === 0 ? 'preflight OK' : 'preflight FAILED',
    );
    return preflightResult.problems.length === 0 ? 0 : 1;
  }

  const result = syncCheckout({
    dest,
    install: argv.includes('--install'),
    withRefs: argv.includes('--with-refs'),
    lowResourceExperiment: argv.includes('--low-resource-experiment'),
    noHistory: argv.includes('--no-history'),
    noHooks: argv.includes('--no-hooks'),
    targetOs: parseList(argv, '--target-os'),
    smallCheckout: argv.includes('--small-checkout'),
    config,
  });
  console.log(`ready: ${result.srcDir} at ${result.head}`);
  return 0;
}

const isMain = isMainModule(import.meta.url);

if (isMain) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  }
}
