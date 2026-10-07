#!/usr/bin/env node
/**
 * Preflight check for a machine that is meant to build Aurelia.
 *
 * Run this *before* syncing anything: a Chromium checkout plus build output is
 * the expensive part, and discovering at hour five that the machine is too
 * small wastes a day. The workflow runs the same script, so the CI verdict and
 * the on-machine verdict cannot disagree.
 *
 * It only reads. It never installs, never changes settings, and never writes
 * outside the file named by --record.
 *
 * Usage:
 *   node tools/ci/check-builder.mjs
 *   node tools/ci/check-builder.mjs --dest D:\chromium
 *   node tools/ci/check-builder.mjs --record artifacts/runner-capabilities.json
 *   node tools/ci/check-builder.mjs --json
 *
 * Exit codes: 0 the machine can build, 1 it cannot, 2 the check itself failed.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statfsSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, totalmem, arch } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

/** Directories the check may inspect for free space. */
export function candidateDestinations(dest) {
  const fromEnv = process.env.AURELIA_CHROMIUM_DEST;
  const candidates = [dest, fromEnv, path.join(REPO_ROOT, '..')].filter(
    (value) => typeof value === 'string' && value.length > 0,
  );
  const withParents = candidates.flatMap((value) => {
    const resolved = path.resolve(value);
    return existsSync(resolved)
      ? [resolved]
      : [path.dirname(resolved), resolved];
  });
  return [...new Set(withParents)].filter((value) => existsSync(value));
}

/** Free space in GB on the volume holding `target`, or null when unknown. */
export function freeDiskGb(target) {
  try {
    const stats = statfsSync(target);
    return Math.round(((stats.bavail * stats.bsize) / 1024 ** 3) * 10) / 10;
  } catch {
    return null;
  }
}

function toolVersion(command, args = ['--version']) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: process.env,
  });
  if (result.error !== undefined || result.status !== 0) {
    return null;
  }
  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  return text.length > 0 ? text.split('\n')[0] : 'present';
}

function visualStudioPath() {
  if (process.platform !== 'win32') {
    return null;
  }
  const programFilesX86 = process.env['ProgramFiles(x86)'];
  const candidates = [
    programFilesX86 === undefined
      ? null
      : path.join(
          programFilesX86,
          'Microsoft Visual Studio',
          'Installer',
          'vswhere.exe',
        ),
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe',
  ].filter((value) => value !== null);
  const vswhere = candidates.find((value) => existsSync(value));
  if (vswhere === undefined) {
    return null;
  }
  const result = spawnSync(
    vswhere,
    [
      '-latest',
      '-products',
      '*',
      '-requires',
      'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-property',
      'installationPath',
    ],
    { encoding: 'utf8', env: process.env },
  );
  const found = (result.stdout ?? '').trim();
  return found.length === 0 ? null : found;
}

/**
 * @returns {{ok: boolean, capabilities: object, problems: string[], notes: string[]}}
 */
export function checkBuilder({ dest, config, log = () => {} } = {}) {
  const requirements = config?.buildRequirements?.referenceBuilder ??
    // Fall back to the documented minimum, never to something smaller.
    { cpuCores: 8, ramGb: 32, freeDiskGb: 150 };

  const capabilities = {
    platform: platform(),
    platformRelease: release(),
    architecture: arch(),
    cpuModel: cpus()[0]?.model?.trim() ?? 'unknown',
    cpuCores: cpus().length,
    ramGb: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
    node: process.version,
    git: toolVersion('git'),
    python: toolVersion('python') ?? toolVersion('python3'),
    visualStudio: visualStudioPath(),
    freeDisk: {},
    checkedAt: new Date().toISOString(),
  };

  const problems = [];
  const notes = [];

  const dirs = candidateDestinations(dest);
  for (const dir of dirs) {
    const free = freeDiskGb(dir);
    capabilities.freeDisk[dir] = free;
    if (free === null) {
      notes.push(`free space at ${dir} could not be determined`);
    }
  }
  const best = Math.max(
    ...Object.values(capabilities.freeDisk).filter(
      (value) => typeof value === 'number',
    ),
    0,
  );
  capabilities.freeDiskGb = best;

  if (capabilities.cpuCores < requirements.cpuCores) {
    problems.push(
      `logical cores: ${capabilities.cpuCores} (needs ${requirements.cpuCores}+)`,
    );
  }
  if (capabilities.ramGb < requirements.ramGb) {
    problems.push(
      `RAM: ${capabilities.ramGb} GB (needs ${requirements.ramGb} GB+)`,
    );
  }
  if (best < requirements.freeDiskGb) {
    problems.push(
      `free disk: ${best} GB (needs ${requirements.freeDiskGb} GB+ on one volume; the Chromium checkout is persistent)`,
    );
  }
  if (capabilities.git === null) {
    problems.push('git was not found on PATH');
  }
  if (capabilities.python === null) {
    notes.push('python was not found on PATH; depot_tools needs it');
  }
  if (process.platform === 'win32' && capabilities.visualStudio === null) {
    problems.push(
      'Visual Studio with the C++ x64 toolchain (VC.Tools.x86.x64) was not found',
    );
  }
  if (process.platform !== 'win32') {
    const hasCompiler = ['clang++', 'g++'].some(
      (compiler) => toolVersion(compiler) !== null,
    );
    if (!hasCompiler) {
      notes.push('no C++ compiler found on PATH (clang++ or g++)');
    }
  }

  for (const [dir, free] of Object.entries(capabilities.freeDisk)) {
    log(`free space: ${dir} -> ${free === null ? 'unknown' : `${free} GB`}`);
  }
  log(
    `cpu: ${capabilities.cpuCores} logical core(s), ram: ${capabilities.ramGb} GB`,
  );
  if (capabilities.visualStudio !== null) {
    log(`visual studio: ${capabilities.visualStudio}`);
  }

  return {
    ok: problems.length === 0,
    capabilities,
    problems,
    notes,
    requirements,
  };
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
      console.log(`Check whether this machine can build Aurelia's Chromium.

  --dest <dir>    directory that will hold the Chromium checkout
                  (defaults to AURELIA_CHROMIUM_DEST, then the repo parent)
  --record <file> write the capabilities JSON (used by the build manifest)
  --json          print the result as JSON
  --no-fail       report but exit 0 (for exploratory runs)`);
      process.exitCode = 0;
    } else {
      const { loadConfig } = await import('../chromium/lib/config.mjs');
      const result = checkBuilder({
        dest: valueOf('--dest'),
        config: loadConfig(),
        log: (line) => console.log(line),
      });

      for (const note of result.notes) {
        console.log(`note: ${note}`);
      }
      for (const problem of result.problems) {
        console.error(`problem: ${problem}`);
      }

      const record = valueOf('--record');
      if (record !== undefined) {
        mkdirSync(path.dirname(path.resolve(record)), { recursive: true });
        writeFileSync(
          record,
          `${JSON.stringify(
            {
              ...result.capabilities,
              requirements: result.requirements,
              problems: result.problems,
              notes: result.notes,
            },
            null,
            2,
          )}\n`,
        );
        console.log(`recorded: ${record}`);
      }

      if (argv.includes('--json')) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log('');
        console.log(
          result.ok
            ? 'BUILDER OK: this machine meets the documented minimums'
            : 'BUILDER TOO SMALL: see the problems above; do not start a full sync here',
        );
      }
      process.exitCode = result.ok || argv.includes('--no-fail') ? 0 : 1;
    }
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exitCode = 2;
  }
}
