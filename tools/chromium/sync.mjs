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
 * Usage:
 *   node tools/chromium/sync.mjs --dest C:\\chromium --install
 *   node tools/chromium/sync.mjs --dest /srv/chromium --check-only
 *   node tools/chromium/sync.mjs --record-depot-tools <sha>
 *   node tools/chromium/sync.mjs --dest C:\\chromium --with-refs   # + branch heads/tags
 */
import { existsSync, mkdirSync, readFileSync, statfsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { REPO_ROOT, loadConfig, CONFIG_PATH } from './lib/config.mjs';
import { installOverlay } from './install-overlay.mjs';
import { run } from './lib/upstream.mjs';
import { isMainModule } from '../lib/entry.mjs';

const CHROMIUM_SOURCE_URL =
  'https://chromium.googlesource.com/chromium/src.git';

/** Minimum free space in GB before we even try: source + deps + build output. */
export const MINIMUM_FREE_DISK_GB = 150;

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

export function preflight({ dest, config }) {
  const reports = [];
  const problems = [];

  let probePath = dest;
  while (!existsSync(probePath) && probePath !== path.dirname(probePath)) {
    probePath = path.dirname(probePath);
  }
  try {
    const freeGb = freeDiskGb(probePath);
    const ok = freeGb >= MINIMUM_FREE_DISK_GB;
    reports.push(
      `free disk at ${probePath}: ${freeGb.toFixed(1)} GB (need >= ${MINIMUM_FREE_DISK_GB} GB)`,
    );
    if (!ok) {
      problems.push(
        `insufficient free disk: ${freeGb.toFixed(1)} GB available, ${MINIMUM_FREE_DISK_GB} GB required`,
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

function writeGclientFile(dest) {
  const gclientPath = path.join(dest, '.gclient');
  const contents = `# Aurelia Browser - generated by tools/chromium/sync.mjs.
# Do not edit by hand; the pinned revision is managed by the tooling.
solutions = [
  {
    "name": "src",
    "url": "${CHROMIUM_SOURCE_URL}",
    "managed": False,
    "custom_deps": {},
    "custom_vars": {},
  },
]
`;
  writeFileSync(gclientPath, contents);
  return gclientPath;
}

export function syncCheckout({
  dest,
  install = false,
  withRefs = false,
  config,
  log = console.log,
}) {
  const preflightResult = preflight({ dest, config });
  for (const report of preflightResult.reports) {
    log(`preflight: ${report}`);
  }
  if (preflightResult.problems.length > 0) {
    throw new Error(preflightResult.problems.join('; '));
  }

  const depotTools = ensureDepotTools({ dest, config, log });
  writeGclientFile(dest);

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
  const syncArgs = [
    'sync',
    '--revision',
    `src@${config.chromium.revision}`,
  ];
  if (withRefs) {
    syncArgs.push('--with_branch_heads', '--with_tags');
  }
  run(
    gclientExecutable(depotTools),
    syncArgs,
    // Windows cannot execute a .bat file without a shell since Node 18.20.
    { cwd: dest, env, shell: process.platform === 'win32' },
  );

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
    const preflightResult = preflight({ dest, config });
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
