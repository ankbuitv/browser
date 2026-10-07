#!/usr/bin/env node
/**
 * Stage the complete runtime directory of a built browser and describe it.
 *
 * "Package only chrome.exe" is never acceptable: a component build needs its
 * DLL set, its pak files, locales and data files, and a build directory is full
 * of ninja state, object files and test binaries that must not ship.
 *
 * What this script does:
 *   1. copies everything from the build output that is *not* a build artefact
 *      into a staging directory (additive; existing files are overwritten);
 *   2. fails loudly when a file the browser cannot start without is missing;
 *   3. writes build-manifest.json (provenance, configuration, signing state)
 *      and SHA256SUMS.txt over the staged browser files;
 *   4. can later record the smoke-test result into the manifest
 *      (`--record-smoke-test`), so the packaged artefact states whether the
 *      binary was actually launched and verified.
 *
 * Usage:
 *   node tools/chromium/stage-runtime.mjs --out <out/Release> --dest <staging>
 *   node tools/chromium/stage-runtime.mjs --out ... --dest ... --json
 *   node tools/chromium/stage-runtime.mjs --dest <staging> --record-smoke-test smoke-report.json
 */
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

import { REPO_ROOT, loadConfig } from './lib/config.mjs';
import { validateGnArgs } from './gn-args.mjs';

export const MANIFEST_NAME = 'build-manifest.json';
export const SUMS_NAME = 'SHA256SUMS.txt';

/** Directories that only ever contain build state, never runtime files. */
export const EXCLUDED_DIRECTORIES = new Set([
  'obj',
  'gen',
  'pyproto',
  'test_support',
  'cmakefiles',
  '__pycache__',
  'clang_x64',
  'clang_x86',
  'artifacts', // nested copies produced by build tooling
]);

/** File patterns that are build artefacts, test binaries or tooling. */
export const EXCLUDED_FILE_PATTERNS = [
  /\.pdb$/i,
  /\.obj$/i,
  /\.lib$/i,
  /\.exp$/i,
  /\.ilk$/i,
  /\.iobj$/i,
  /\.ipdb$/i,
  /\.tlog$/i,
  /\.lastbuildstate$/i,
  /\.recipe$/i,
  /\.pyc$/i,
  /\.ninja$/i,
  /\.ninja_deps$/i,
  /\.ninja_log$/i,
  /^args\.gn$/i,
  /^build\.ninja$/i,
  /^\.ninja_log$/i,
  /^v8_build_config\.json$/i,
  /tests?\.exe$/i,
  /^chromedriver\.exe$/i,
];

/** Files the browser cannot start without; their absence fails the stage. */
export const REQUIRED_FILES = ['chrome.exe', 'icudtl.dat'];

/**
 * True when a path relative to the build directory is a build artefact.
 * Directory names are matched case-insensitively because Windows paths are not
 * case-sensitive.
 */
export function isBuildArtefact(relativePath) {
  const segments = relativePath.split(/[\\/]+/).filter(Boolean);
  if (
    segments.some((segment) => EXCLUDED_DIRECTORIES.has(segment.toLowerCase()))
  ) {
    return true;
  }
  const name = segments[segments.length - 1] ?? '';
  return EXCLUDED_FILE_PATTERNS.some((pattern) => pattern.test(name));
}

/** Walk a directory, returning every file with its relative path. */
export function listFiles(root, { base = root, out = [] } = {}) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    const relative = path.relative(base, full);
    if (entry.isDirectory()) {
      listFiles(full, { base, out });
    } else if (entry.isFile()) {
      out.push(relative);
    }
  }
  return out;
}

/**
 * Work out which files to copy and whether the output looks complete.
 *
 * @returns {{ files: string[], excluded: string[], problems: string[], totalBytes: number }}
 */
export function planStaging(outDir) {
  const problems = [];
  if (!existsSync(outDir)) {
    throw new Error(`build output directory does not exist: ${outDir}`);
  }
  const all = listFiles(outDir).map((relative) => relative.split(path.sep).join('/'));
  const files = [];
  const excluded = [];
  for (const relative of all) {
    if (isBuildArtefact(relative)) {
      excluded.push(relative);
    } else {
      files.push(relative);
    }
  }

  for (const required of REQUIRED_FILES) {
    if (!files.includes(required)) {
      problems.push(
        `required runtime file ${required} is missing from ${outDir} (is this a completed build?)`,
      );
    }
  }
  if (!files.some((file) => file.endsWith('.pak'))) {
    problems.push('no .pak resource file found: the browser would start without resources');
  }
  if (!files.some((file) => /^locales\/.+\.pak$/.test(file))) {
    problems.push('no locale pak file found under locales/');
  }

  const totalBytes = files.reduce((sum, relative) => {
    const stat = statSync(path.join(outDir, relative));
    return sum + stat.size;
  }, 0);

  return { files, excluded, problems, totalBytes };
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(file);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/** The artifact file name the owner specified, derived from the revision. */
export function artifactName({ revision, platform = 'windows', arch = 'x64' } = {}) {
  const short = String(revision ?? 'unknown').slice(0, 7);
  return `aurelia-${platform}-${arch}-dev-${short}-UNSIGNED.zip`;
}

/**
 * Build the manifest object. Pure so it can be unit-tested without a build.
 */
export function buildManifest({
  config,
  aureliaRevision,
  platform,
  arch,
  gnArgsText,
  artifact,
  timestamp = new Date().toISOString(),
  runner = null,
  staging = null,
}) {
  const { entries, problems } = validateGnArgs(gnArgsText ?? '');
  if (problems.length > 0) {
    throw new Error(`GN arguments failed policy check:\n- ${problems.join('\n- ')}`);
  }
  const values = Object.fromEntries(entries.map(({ key, value }) => [key, value]));

  let patchMeta = null;
  const patchMetaPath = path.join(
    REPO_ROOT,
    'chromium/patches/0001-aurelia-webui-and-resources.meta.json',
  );
  if (existsSync(patchMetaPath)) {
    patchMeta = JSON.parse(readFileSync(patchMetaPath, 'utf8'));
  }

  const configuration = [
    values.is_debug === 'true' ? 'debug' : 'release',
    values.is_component_build === 'true' ? 'component' : 'static',
    values.is_official_build === 'true' ? 'official' : 'development',
  ].join('-');

  return {
    schemaVersion: 1,
    product: {
      name: config.product.codename,
      nameIsCodenameOnly: config.product.nameIsCodenameOnly,
      version: config.product.version,
      license: config.product.license,
    },
    artifact,
    build: {
      timestamp,
      aureliaRevision,
      chromiumVersion: config.chromium.version,
      chromiumRevision: config.chromium.revision,
      chromiumChannel: config.chromium.channel,
      patchSetVersion: patchMeta?.patchSetVersion ?? config.patchSet.version,
      depotToolsRevision: config.toolchain?.depotTools?.revision ?? null,
      os: platform,
      architecture: arch,
      configuration,
      gnArgs: values,
      forkDelta: patchMeta?.summary ?? null,
    },
    signing: {
      signed: false,
      productionReady: false,
      note: 'Unsigned development build. SmartScreen will warn; that warning is never bypassed.',
    },
    smokeTest: {
      state: 'pending',
      note: 'Recorded with --record-smoke-test once the packaged binary has been launched.',
    },
    ...(runner === null ? {} : { runner }),
    ...(staging === null ? {} : { staging }),
  };
}

export function writeManifest(dest, manifest) {
  const file = path.join(dest, MANIFEST_NAME);
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return file;
}

/**
 * Write SHA256SUMS.txt over the browser files. The manifest and the sums file
 * themselves are excluded: the manifest is updated after the smoke test, and a
 * file cannot contain its own hash.
 */
export async function writeSums(dest, files) {
  const lines = [];
  for (const relative of [...files].sort()) {
    const hash = await sha256File(path.join(dest, relative));
    lines.push(`${hash}  ${relative}`);
  }
  writeFileSync(path.join(dest, SUMS_NAME), `${lines.join('\n')}\n`);
  return lines.length;
}

/** Copy the planned runtime files into the staging directory. */
export function copyRuntimeFiles(outDir, dest, files) {
  mkdirSync(dest, { recursive: true });
  for (const relative of files) {
    const target = path.join(dest, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(outDir, relative), target);
  }
}

/**
 * Stage a build output directory and describe the result.
 *
 * @returns {Promise<{files: string[], excluded: string[], problems: string[], totalBytes: number, manifest: object, manifestPath: string, sumsPath: string}>}
 */
export async function stageRuntime({
  outDir,
  dest,
  aureliaRevision,
  gnArgsFile,
  platform = 'windows',
  arch = 'x64',
  runner = null,
  config = loadConfig(),
}) {
  const plan = planStaging(outDir);
  if (plan.problems.length > 0) {
    throw new Error(`staging refused:\n- ${plan.problems.join('\n- ')}`);
  }
  const gnArgsText = gnArgsFile === undefined ? '' : readFileSync(gnArgsFile, 'utf8');
  if (gnArgsText === '') {
    throw new Error('--gn-args <out/Release/args.gn> is required: the manifest must record the real configuration');
  }
  copyRuntimeFiles(outDir, dest, plan.files);
  const artifact = artifactName({ revision: aureliaRevision, platform, arch });
  const manifest = buildManifest({
    config,
    aureliaRevision,
    platform,
    arch,
    gnArgsText,
    artifact,
    runner,
    staging: {
      files: plan.files.length,
      bytes: plan.totalBytes,
      excludedBuildArtefacts: plan.excluded.length,
    },
  });
  const manifestPath = writeManifest(dest, manifest);
  const sumCount = await writeSums(dest, plan.files);
  return {
    ...plan,
    manifest,
    manifestPath,
    sumsPath: path.join(dest, SUMS_NAME),
    sumCount,
  };
}

/** Record the smoke-test outcome in an existing manifest. */
export function recordSmokeTest({ dest, report }) {
  const manifestPath = path.join(dest, MANIFEST_NAME);
  if (!existsSync(manifestPath)) {
    throw new Error(`${MANIFEST_NAME} not found in ${dest}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.smokeTest = {
    state: report.passed ? 'passed' : 'failed',
    testedBinary: report.binary ?? null,
    sandboxMode: report.sandboxMode ?? 'unknown',
    equivalentToProductRuntime: report.equivalentToProductRuntime ?? null,
    assertions: Array.isArray(report.results)
      ? report.results.map(({ name, ok }) => ({ name, ok }))
      : [],
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
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
  const json = argv.includes('--json');

  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`Stage the complete runtime directory and describe the artifact.

  --out <dir>                 build output directory (e.g. src\\out\\Release)
  --dest <dir>                staging directory for the artifact
  --aurelia-revision <sha>    Aurelia git revision that produced this build
  --gn-args <file>            the effective args.gn to record in the manifest
  --record-smoke-test <file>  update the manifest with a smoke-test JSON report
  --json                      machine-readable summary`);
    process.exitCode = 0;
  } else if (argv.includes('--record-smoke-test')) {
    const dest = valueOf('--dest');
    const reportFile = valueOf('--record-smoke-test');
    if (dest === undefined || reportFile === undefined) {
      console.error('--dest and --record-smoke-test are both required');
      process.exitCode = 1;
    } else {
      const manifest = recordSmokeTest({
        dest,
        report: JSON.parse(readFileSync(reportFile, 'utf8')),
      });
      console.log(
        `recorded smoke test: ${manifest.smokeTest.state} (${manifest.smokeTest.assertions.length} assertion(s))`,
      );
      process.exitCode = manifest.smokeTest.state === 'passed' ? 0 : 1;
    }
  } else {
    const outDir = valueOf('--out');
    const dest = valueOf('--dest');
    if (outDir === undefined || dest === undefined) {
      console.error('--out and --dest are required');
      process.exitCode = 1;
    } else {
      stageRuntime({
        outDir,
        dest,
        aureliaRevision: valueOf('--aurelia-revision') ?? 'unknown',
        gnArgsFile: valueOf('--gn-args'),
        runner: valueOf('--runner-capabilities')
          ? JSON.parse(readFileSync(valueOf('--runner-capabilities'), 'utf8'))
          : null,
      })
        .then((result) => {
          if (json) {
            console.log(
              JSON.stringify(
                {
                  artifact: result.manifest.artifact,
                  files: result.files.length,
                  bytes: result.totalBytes,
                  excludedBuildArtefacts: result.excluded.length,
                  configuration: result.manifest.build.configuration,
                },
                null,
                2,
              ),
            );
          } else {
            console.log(`staged ${result.files.length} runtime file(s), ${(result.totalBytes / 1024 ** 2).toFixed(1)} MiB`);
            console.log(`left behind ${result.excluded.length} build artefact(s)`);
            console.log(`configuration: ${result.manifest.build.configuration}`);
            console.log(`wrote ${MANIFEST_NAME} and ${SUMS_NAME} (${result.sumCount} hashes)`);
          }
          process.exitCode = 0;
        })
        .catch((error) => {
          console.error(`staging failed: ${error.message}`);
          process.exitCode = 1;
        });
    }
  }
}
