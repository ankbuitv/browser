#!/usr/bin/env node
/**
 * Local Aurelia build driver.
 *
 * Runs exactly the stages of the heavy-build workflow
 * (tools/ci/workflows/chromium-heavy-build-windows.yml) on the current machine,
 * in the same order, by calling the same tools. It exists for two reasons:
 *
 *   1. a provisioned builder needs one command, not a checklist;
 *   2. the pipeline stays runnable without GitHub Actions - and stays the
 *      *same* pipeline: the CI workflow and this driver call the same tools in
 *      the same order.
 *
 * Nothing here weakens the browser: no sandbox flag, no site-isolation change,
 * no security-relevant GN argument (the allowlist in gn-args.mjs rejects those
 * anyway). If the smoke test cannot run without weakening the sandbox, the run
 * is marked as not equivalent to product-runtime verification instead.
 *
 * Two profiles exist:
 *   dev (default)   config/gn/win-x64-dev.gn              - the documented dev build
 *   low-resource    config/gn/win-x64-low-resource.gn     - LOW_RESOURCE_EXPERIMENT:
 *                   symbol_level 0, one link at a time, plus `-j N` compile
 *                   jobs computed from measured RAM/CPU (tools/chromium/low-resource.mjs).
 *                   It changes build cost only, never browser behaviour.
 *
 * Usage:
 *   node tools/chromium/build.mjs --dest C:\\chromium                        # full pipeline
 *   node tools/chromium/build.mjs --dest /srv/chromium --skip-sync
 *   node tools/chromium/build.mjs --dest /srv/chromium --dry-run
 *   node tools/chromium/build.mjs --dest D:\\aeb --profile low-resource --jobs 2
 *   node tools/chromium/build.mjs --dest D:\\aeb --only sync                 # one stage
 *   node tools/chromium/build.mjs --dest D:\\aeb --only stage,smoke-test,record
 *   node tools/chromium/build.mjs --dest D:\\aeb --log-dir artifacts/local-build
 *
 * Exit codes: 0 success, 1 failure, 2 refused (preflight or verification).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/entry.mjs';
import { captureCommand, spawnCommand } from './lib/exec.mjs';

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

/** The stage list mirrors the workflow step order; keep the two in step. */
export const BUILD_STAGES = [
  {
    id: 'preflight',
    title: 'preflight: free space and toolchain',
    description: 'checks the destination volume and depot_tools before hours of work',
  },
  {
    id: 'sync',
    title: 'sync: pinned Chromium checkout',
    description: 'depot_tools, .gclient, gclient sync at the pinned revision, HEAD check',
  },
  {
    id: 'verify-patches',
    title: 'verify-patches: patch set against the pristine checkout',
    description: 'the patch set must apply to the pinned revision before anything is written',
  },
  {
    id: 'install-overlay',
    title: 'install-overlay: overlay files and patch series',
    description: 'copies the Aurelia overlay and applies the reviewed patch(es)',
  },
  {
    id: 'fork-delta',
    title: 'fork-delta: reviewed delta budget',
    description: 'fails when the Chromium delta grows past the reviewed figures',
  },
  {
    id: 'gn-args',
    title: 'gn-args: reviewed argument policy',
    description: 'every key must be on the allowlist; no security-relevant switch',
  },
  {
    id: 'gn-gen',
    title: 'gn gen: generate build files',
    description: 'the exact reviewed arguments are recorded for the build manifest',
  },
  {
    id: 'compile',
    title: 'compile: autoninja chrome',
    description: 'the stage that turns "verified" into "compiled"',
  },
  {
    id: 'stage',
    title: 'stage: complete runtime directory',
    description: 'the artifact is the runnable browser directory, never just chrome.exe',
  },
  {
    id: 'smoke-test',
    title: 'smoke-test: launch, chrome://aurelia, pin check, clean exit',
    description: 'sandboxed; a run that needs weakened sandboxing is labelled non-equivalent',
  },
  {
    id: 'record',
    title: 'record: smoke-test result in the build manifest',
    description: 'the manifest may only claim TESTED if the smoke test actually passed',
  },
  {
    id: 'package',
    title: 'package: unsigned development artifact (zip + sha256)',
    description: 'the complete staged directory, never only chrome.exe; signed=false',
  },
];

/** The low-resource profile's reviewed GN file. */
export const GN_ARGS_FILES = {
  dev: 'win-x64-dev.gn',
  'low-resource': 'win-x64-low-resource.gn',
};

/** Log file name per stage, used with --log-dir. */
const LOG_NAMES = {
  'gn-gen': 'gn.log',
  compile: 'autoninja.log',
  sync: 'sync.log',
  'verify-patches': 'verify-patches.log',
  'install-overlay': 'install-overlay.log',
  'smoke-test': 'smoke-test.log',
  package: 'package.log',
};

/**
 * The command line for each stage. Kept as data so the plan can be printed
 * (--dry-run) and asserted by tests without executing anything.
 *
 * @returns {{id: string, title: string, description: string, commands: {file: string, args: string[], cwd: string, description: string}[]}[]}
 */
export function buildPlan({
  dest,
  repoRoot = REPO_ROOT,
  checkoutDir,
  outDir,
  stageDir,
  aureliaRevision = '<aurelia-revision>',
  artifactPlatform = 'windows',
  skipSync = false,
  profile = 'dev',
  jobs = null,
  only = null,
} = {}) {
  const lowResource = profile === 'low-resource';
  if (GN_ARGS_FILES[profile] === undefined) {
    throw new Error(
      `unknown profile "${profile}"; expected one of: ${Object.keys(GN_ARGS_FILES).join(', ')}`,
    );
  }
  if (only !== null) {
    const known = BUILD_STAGES.map((stage) => stage.id);
    const unknown = only.filter((id) => !known.includes(id));
    if (unknown.length > 0) {
      throw new Error(
        `unknown stage(s) in --only: ${unknown.join(', ')}; known stages: ${known.join(', ')}`,
      );
    }
  }
  const src = path.join(dest ?? '<dest>', 'src');
  const checkout = checkoutDir ?? src;
  const out = outDir ?? path.join(checkout, 'out', 'Release');
  const node = process.execPath;
  const tool = (...parts) => path.join(repoRoot, 'tools', 'chromium', ...parts);
  const stage = stageDir ?? path.join(dest ?? '<dest>', 'artifacts', 'staged');
  const argsFile = path.join(out, 'args.gn');
  const reportFile = path.join(dest ?? '<dest>', 'artifacts', 'smoke-test.json');
  // The low-resource profile must never run unbounded ninja jobs: when no job
  // count is supplied (bootstrap-build.ps1 supplies the measured one), fall back
  // to a single job - slow, but safe on every machine.
  const effectiveJobs =
    Number.isInteger(jobs) && jobs > 0 ? jobs : lowResource ? 1 : null;

  const gnArgsFile = path.join(repoRoot, 'config', 'gn', GN_ARGS_FILES[profile]);

  const stageCommands = {
    preflight: [
      {
        file: node,
        args: [
          tool('sync.mjs'),
          '--dest',
          dest ?? '<dest>',
          '--check-only',
          ...(lowResource ? ['--low-resource-experiment'] : []),
        ],
        cwd: repoRoot,
        description: 'destination volume and toolchain preflight',
      },
    ],
    sync: [
      {
        file: node,
        args: [
          tool('sync.mjs'),
          '--dest',
          dest ?? '<dest>',
          ...(lowResource ? ['--low-resource-experiment'] : []),
        ],
        cwd: repoRoot,
        description: 'pinned checkout',
      },
    ],
    'verify-patches': [
      {
        file: node,
        args: [tool('cli.mjs'), 'verify-patches', '--checkout', checkout],
        cwd: repoRoot,
        description: 'patch set verification against the checkout',
      },
    ],
    'install-overlay': [
      {
        file: node,
        args: [tool('install-overlay.mjs'), '--checkout', checkout],
        cwd: repoRoot,
        description: 'overlay + patch series',
      },
    ],
    'fork-delta': [
      {
        file: node,
        args: [tool('cli.mjs'), 'fork-delta', '--check'],
        cwd: repoRoot,
        description: 'delta budget',
      },
    ],
    'gn-args': [
      {
        file: node,
        args: [tool('gn-args.mjs'), gnArgsFile],
        cwd: repoRoot,
        description: 'argument policy',
      },
    ],
    'gn-gen': [
      {
        file: node,
        args: [tool('gn-args.mjs'), '--print', gnArgsFile],
        cwd: repoRoot,
        description: 'render the reviewed arguments',
      },
      {
        file: 'gn',
        args: ['gen', path.relative(checkout, out), '--args=<from-print>'],
        cwd: checkout,
        description: 'generate build files',
      },
    ],
    compile: [
      {
        file: 'autoninja',
        // `-j N` is a ninja flag autoninja passes through; the low-resource
        // profile computes N from measured RAM and logical cores
        // (tools/chromium/low-resource.mjs) so an 8 GB machine runs two
        // compilers, not one per core.
        args: [
          '-C',
          path.relative(checkout, out),
          ...(effectiveJobs === null ? [] : ['-j', String(effectiveJobs)]),
          'chrome',
        ],
        cwd: checkout,
        description: 'build the browser',
      },
    ],
    package: [
      {
        file: node,
        args: [
          tool('package.mjs'),
          '--stage',
          stage,
          '--dest',
          path.join(dest ?? '<dest>', 'artifacts'),
        ],
        cwd: repoRoot,
        description: 'zip + sha256 of the staged runtime directory',
      },
    ],
    stage: [
      {
        file: node,
        args: [
          tool('stage-runtime.mjs'),
          '--out',
          out,
          '--dest',
          stage,
          '--aurelia-revision',
          aureliaRevision,
          '--gn-args',
          argsFile,
        ],
        cwd: repoRoot,
        description: 'stage the runtime directory',
      },
    ],
    'smoke-test': [
      {
        file: node,
        args: [
          tool('smoke-test.mjs'),
          '--binary',
          path.join(stage, artifactPlatform === 'windows' ? 'chrome.exe' : 'chrome'),
          '--report',
          reportFile,
        ],
        cwd: repoRoot,
        description: 'smoke test the staged browser',
      },
    ],
    record: [
      {
        file: node,
        args: [
          tool('stage-runtime.mjs'),
          '--dest',
          stage,
          '--record-smoke-test',
          reportFile,
        ],
        cwd: repoRoot,
        description: 'record the smoke-test result',
      },
    ],
  };

  return BUILD_STAGES.filter((stage) => !(skipSync && stage.id === 'sync'))
    .filter((stage) => only === null || only.includes(stage.id))
    .map((stageInfo) => ({
      ...stageInfo,
      commands: stageCommands[stageInfo.id].map((command) => ({
        ...command,
        logName: LOG_NAMES[stageInfo.id] ?? `${stageInfo.id}.log`,
      })),
    }));
}

/** Append a line to the run log; logging must never break a build. */
function logLine(logFile, text) {
  if (logFile === null) {
    return;
  }
  try {
    appendFileSync(logFile, text.endsWith('\n') ? text : `${text}\n`);
  } catch {
    // a full disk or a locked file must not mask the real result
  }
}

function runCommand(command, log, logDir = null) {
  const line = `    $ ${command.file} ${command.args.join(' ')}`;
  log(line);
  if (logDir !== null && command.logName !== undefined) {
    logLine(path.join(logDir, command.logName), `${line}\n`);
  }
  // On Windows the tools this driver calls are batch files from depot_tools
  // (`gn.bat`, `autoninja.bat`); lib/exec.mjs runs them through cmd.exe with
  // correct quoting. On POSIX this is a plain spawn.
  const result = spawnCommand(
    { file: command.file, args: command.args, cwd: command.cwd },
    { env: process.env },
  );
  if (result.error !== undefined) {
    throw new Error(
      `${command.file} could not be started: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(`${command.file} exited with code ${result.status}`);
  }
}

/**
 * Turn the `--args=<from-print>` placeholder into the real single-line
 * argument string by running the gn-args renderer.
 */
function resolveGnArgs(command, plan, log) {
  if (!command.args.includes('--args=<from-print>')) {
    return command;
  }
  const gnArgsCommand = plan
    .find((s) => s.id === 'gn-args')
    .commands[0];
  // `gn-args --print` is the single source of the argument string; the driver
  // never assembles GN arguments itself.
  const rendered = captureCommand(
    {
      file: gnArgsCommand.file,
      args: [...gnArgsCommand.args, '--print'],
      cwd: gnArgsCommand.cwd,
    },
    { env: process.env },
  );
  const argsText = rendered.trim();
  log(`    reviewed GN arguments: ${argsText}`);
  return {
    ...command,
    args: command.args.map((arg) =>
      arg === '--args=<from-print>' ? `--args=${argsText}` : arg,
    ),
  };
}

/** The build-state ladder, in the order the stages earn each state. */
export const LADDER = [
  ['patch applies', 'INTEGRATION SOURCE VERIFIED'],
  ['gn gen succeeds', 'CONFIGURATION VERIFIED'],
  ['autoninja succeeds', 'COMPILED'],
  ['browser launches', 'RUNTIME INTEGRATED'],
  ['smoke test passes', 'TESTED'],
  ['physical supported Windows machine', 'VERIFIED (run by a human)'],
];

function parseJobs(value) {
  if (value === undefined) {
    return null;
  }
  const jobs = Number.parseInt(value, 10);
  if (!Number.isInteger(jobs) || jobs < 1) {
    throw new Error(`--jobs must be a positive integer (got "${value}")`);
  }
  return jobs;
}

function parseOnly(value) {
  if (value === undefined) {
    return null;
  }
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function runBuild({
  dest,
  options = {},
  logDir = null,
  log = console.log,
} = {}) {
  if (dest === undefined) {
    throw new Error('--dest <checkout-parent-directory> is required');
  }
  const plan = buildPlan({ dest, ...options });
  const reached = [];
  const started = Date.now();

  log(`Aurelia build`);
  log(`  checkout destination: ${dest}`);
  log(`  ${plan.length} stage(s); the ladder is never collapsed:`);
  for (const [step, state] of LADDER) {
    log(`    ${step.padEnd(36)} -> ${state}`);
  }
  log('');
  if (logDir !== null) {
    mkdirSync(logDir, { recursive: true });
    logLine(
      path.join(logDir, 'build.log'),
      [
        `Aurelia build ${new Date().toISOString()}`,
        `dest: ${dest}`,
        `stages: ${plan.map((stage) => stage.id).join(', ')}`,
      ].join('\n'),
    );
  }

  for (const stage of plan) {
    log(`[${stage.id}] ${stage.title}`);
    if (logDir !== null) {
      logLine(
        path.join(logDir, 'build.log'),
        `\n[${stage.id}] ${stage.title} ${new Date().toISOString()}`,
      );
    }
    for (const command of stage.commands) {
      const resolved = resolveGnArgs(command, plan, log);
      try {
        runCommand(resolved, log, logDir);
      } catch (error) {
        if (logDir !== null) {
          logLine(
            path.join(logDir, 'last-error.txt'),
            [
              `time: ${new Date().toISOString()}`,
              `stage: ${stage.id}`,
              `command: ${resolved.file} ${resolved.args.join(' ')}`,
              `error: ${error.message}`,
            ].join('\n'),
          );
        }
        throw error;
      }
    }
    reached.push(stage.id);
    log(`[${stage.id}] done`);
    log('');
  }

  if (logDir !== null) {
    logLine(
      path.join(logDir, 'build.log'),
      `finished: ${reached.length} stage(s) in ${Math.round((Date.now() - started) / 1000)}s\n`,
    );
  }

  const manifestPath = path.join(
    options.stageDir ?? path.join(dest, 'artifacts', 'staged'),
    'build-manifest.json',
  );
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    log(`build manifest: ${manifestPath}`);
    log(`  artifact:        ${manifest.artifact}`);
    log(`  signed:          ${manifest.signing?.signed === true}`);
    log(`  productionReady: ${manifest.signing?.productionReady === true}`);
    log(`  smokeTest:       ${JSON.stringify(manifest.smokeTest)}`);
  }
  return { ok: true, stagesRun: reached.length, plan };
}

const isMain = isMainModule(import.meta.url);

if (isMain) {
  const argv = process.argv.slice(2);
  const valueOf = (flag) => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };

  try {
    if (argv.includes('--help') || argv.includes('-h')) {
      console.log(`Aurelia local build driver

  --dest <dir>       required; the directory holding the Chromium checkout (…/src)
  --skip-sync        use the existing checkout (still checks HEAD against the pin)
  --dry-run          print the stage plan without executing anything
  --out <dir>        build output directory (default: <checkout>/out/Release)
  --stage <dir>      staging directory (default: <dest>/artifacts/staged)
  --aurelia-revision <sha>   recorded in build-manifest.json
  --profile <name>   dev (default) | low-resource  (see config/gn/*.gn)
  --jobs <n>         autoninja -j N (low-resource: tools/chromium/low-resource.mjs
                     computes this from measured RAM and logical cores)
  --only <a,b>       run only these stages (resume a partial run),
                     e.g. --only sync | --only compile | --only smoke-test
  --log-dir <dir>    tee build.log / gn.log / last-error.txt into <dir>

Every stage calls the same tool the CI workflow calls; the pipeline is identical
whether it runs here, on the self-hosted builder, or through a bootstrap script
like tools/windows/bootstrap-build.ps1.`);
      process.exitCode = 0;
    } else if (argv.includes('--dry-run')) {
      const plan = buildPlan({
        dest: valueOf('--dest') ?? '<dest>',
        outDir: valueOf('--out'),
        stageDir: valueOf('--stage'),
        aureliaRevision: valueOf('--aurelia-revision') ?? '<aurelia-revision>',
        profile: valueOf('--profile') ?? 'dev',
        jobs: parseJobs(valueOf('--jobs')),
        only: parseOnly(valueOf('--only')),
      });
      for (const stage of plan) {
        console.log(`[${stage.id}] ${stage.title}`);
        for (const command of stage.commands) {
          console.log(`    $ ${command.file} ${command.args.join(' ')}`);
        }
      }
      console.log('');
      console.log(
        'dry run: nothing was executed; a real run earns the ladder states listed above',
      );
      process.exitCode = 0;
    } else {
      const result = runBuild({
        dest: valueOf('--dest'),
        logDir: valueOf('--log-dir') ?? null,
        options: {
          outDir: valueOf('--out'),
          stageDir: valueOf('--stage'),
          aureliaRevision: valueOf('--aurelia-revision'),
          skipSync: argv.includes('--skip-sync'),
          profile: valueOf('--profile') ?? 'dev',
          jobs: parseJobs(valueOf('--jobs')),
          only: parseOnly(valueOf('--only')),
        },
      });
      console.log(
        result.ok
          ? `BUILD PIPELINE COMPLETED (${result.stagesRun} stages)`
          : 'BUILD PIPELINE FAILED',
      );
      process.exitCode = result.ok ? 0 : 1;
    }
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  }
}
