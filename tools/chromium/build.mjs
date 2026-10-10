#!/usr/bin/env node
/**
 * Legacy full-build plan and driver.
 *
 * `buildPlan` remains available for policy tests and `--dry-run`; `runBuild`
 * always throws because the legacy executor is retired. The supported manual
 * entry point is .github/workflows/chromium-build.yml, which performs the
 * measured preflight and offers explicit gn, targeted, and full levels.
 * There is no local or self-hosted Chromium compilation path.
 *
 * The existing GN profiles are retained for compatibility. They never weaken
 * the sandbox, site isolation, certificate checks, or process isolation.
 *
 * Usage:
 *   node tools/chromium/build.mjs --dest <checkout-parent> --dry-run
 *
 * Exit codes: 0 dry-run/help only, 1 legacy execution refused or invalid plan.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/entry.mjs';

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

/** Reviewed GN files retained for dry-run plan inspection; low-resource is retired. */
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
  const retiredLowResource = profile === 'low-resource';
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
  // Keep the retired fixture's printable command bounded. This plan is never
  // executed: runBuild() rejects every attempt to use the legacy executor.
  const effectiveJobs =
    Number.isInteger(jobs) && jobs > 0 ? jobs : retiredLowResource ? 1 : null;

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
        // `-j N` is a Ninja flag. Any value here is part of a retired,
        // printable plan only; this legacy executor cannot start the command.
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

export function runBuild() {
  throw new Error(
    'The legacy build executor is retired. Dispatch .github/workflows/chromium-build.yml and select a validation level.',
  );
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
      console.log(`Aurelia legacy build-plan inspector (executor retired)

  --dry-run          print the legacy plan; no commands are run
  --dest <dir>       destination shown in the plan
  --profile <name>   dev (default) | low-resource (retired fixture, display only)
  --jobs <n>         compile-job count displayed in the plan
  --only <a,b>       filter the displayed stages

Chromium compilation is available only through the manual GitHub-hosted
workflow: .github/workflows/chromium-build.yml.`);
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
        'dry run only: no build ran; dispatch the GitHub-hosted workflow for validation evidence',
      );
      process.exitCode = 0;
    } else {
      runBuild();
    }
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  }
}
