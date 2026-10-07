#!/usr/bin/env node
/**
 * Local Aurelia build driver.
 *
 * Runs exactly the stages of the heavy-build workflow
 * (tools/ci/workflows/chromium-heavy-build-windows.yml) on the current machine,
 * in the same order, by calling the same tools. It exists for two reasons:
 *
 *   1. a provisioned builder needs one command, not a checklist;
 *   2. the pipeline stays runnable without GitHub Actions - which matters while
 *      the workflow definitions cannot be deployed (issue #5).
 *
 * Nothing here weakens the browser: no sandbox flag, no site-isolation change,
 * no security-relevant GN argument (the allowlist in gn-args.mjs rejects those
 * anyway). If the smoke test cannot run without weakening the sandbox, the run
 * is marked as not equivalent to product-runtime verification instead.
 *
 * Usage:
 *   node tools/chromium/build.mjs --dest C:\\chromium            # full pipeline
 *   node tools/chromium/build.mjs --dest /srv/chromium --skip-sync
 *   node tools/chromium/build.mjs --dest /srv/chromium --dry-run
 *
 * Exit codes: 0 success, 1 failure, 2 refused (preflight or verification).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
];

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
} = {}) {
  const src = path.join(dest ?? '<dest>', 'src');
  const checkout = checkoutDir ?? src;
  const out = outDir ?? path.join(checkout, 'out', 'Release');
  const node = process.execPath;
  const tool = (...parts) => path.join(repoRoot, 'tools', 'chromium', ...parts);
  const stage = stageDir ?? path.join(dest ?? '<dest>', 'artifacts', 'staged');
  const argsFile = path.join(out, 'args.gn');
  const reportFile = path.join(dest ?? '<dest>', 'artifacts', 'smoke-test.json');
  const gnArgsFile = path.join(repoRoot, 'config', 'gn', 'win-x64-dev.gn');

  const stageCommands = {
    preflight: [
      {
        file: node,
        args: [tool('sync.mjs'), '--dest', dest ?? '<dest>', '--check-only'],
        cwd: repoRoot,
        description: 'destination volume and toolchain preflight',
      },
    ],
    sync: [
      {
        file: node,
        args: [tool('sync.mjs'), '--dest', dest ?? '<dest>'],
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
        args: ['-C', path.relative(checkout, out), 'chrome'],
        cwd: checkout,
        description: 'build the browser',
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

  return BUILD_STAGES.filter((s) => !(skipSync && s.id === 'sync')).map(
    (stageInfo) => ({
      ...stageInfo,
      commands: stageCommands[stageInfo.id],
    }),
  );
}

function runCommand(command, log) {
  log(`    $ ${command.file} ${command.args.join(' ')}`);
  const result = spawnSync(command.file, command.args, {
    cwd: command.cwd,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32' && command.file.endsWith('.bat'),
  });
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
  const rendered = spawnSync(
    gnArgsCommand.file,
    [...gnArgsCommand.args, '--print'],
    {
      cwd: gnArgsCommand.cwd,
      encoding: 'utf8',
      env: process.env,
    },
  );
  if (rendered.status !== 0) {
    throw new Error(`gn-args --print failed: ${rendered.stderr.trim()}`);
  }
  const argsText = rendered.stdout.trim();
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

export function runBuild({ dest, options = {}, log = console.log } = {}) {
  if (dest === undefined) {
    throw new Error('--dest <checkout-parent-directory> is required');
  }
  const plan = buildPlan({ dest, ...options });
  const reached = [];

  log(`Aurelia build`);
  log(`  checkout destination: ${dest}`);
  log(`  ${plan.length} stage(s); the ladder is never collapsed:`);
  for (const [step, state] of LADDER) {
    log(`    ${step.padEnd(36)} -> ${state}`);
  }
  log('');

  for (const stage of plan) {
    log(`[${stage.id}] ${stage.title}`);
    for (const command of stage.commands) {
      runCommand(resolveGnArgs(command, plan, log), log);
    }
    reached.push(stage.id);
    log(`[${stage.id}] done`);
    log('');
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

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === `file://${path.resolve(process.argv[1])}`;

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
  --aurelia-revision <sha>  recorded in build-manifest.json

Every stage calls the same tool the CI workflow calls; the pipeline is identical
whether it runs here or on the self-hosted builder.`);
      process.exitCode = 0;
    } else if (argv.includes('--dry-run')) {
      const plan = buildPlan({
        dest: valueOf('--dest') ?? '<dest>',
        outDir: valueOf('--out'),
        stageDir: valueOf('--stage'),
        aureliaRevision: valueOf('--aurelia-revision') ?? '<aurelia-revision>',
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
        options: {
          outDir: valueOf('--out'),
          stageDir: valueOf('--stage'),
          aureliaRevision: valueOf('--aurelia-revision'),
          skipSync: argv.includes('--skip-sync'),
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
