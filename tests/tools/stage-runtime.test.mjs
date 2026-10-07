/**
 * Runtime staging and the build manifest.
 *
 * The artifact promise is narrow and testable: the staging step copies the
 * complete runtime set, refuses to ship a browser that cannot start, and writes
 * a manifest that states provenance, configuration and the signing reality.
 */
import { describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  artifactName,
  buildManifest,
  isBuildArtefact,
  planStaging,
  recordSmokeTest,
  stageRuntime,
  MANIFEST_NAME,
  SUMS_NAME,
} from '../../tools/chromium/stage-runtime.mjs';
import { loadConfig, REPO_ROOT } from '../../tools/chromium/lib/config.mjs';

const GN_ARGS = path.join(REPO_ROOT, 'config/gn/win-x64-dev.gn');

function fakeBuildOutput({ complete = true } = {}) {
  const outDir = mkdtempSync(path.join(tmpdir(), 'aurelia-out-'));
  const write = (relative, contents = 'x') => {
    const target = path.join(outDir, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
  };
  write('chrome.exe', 'binary');
  write('icudtl.dat', 'icu');
  write('resources.pak', 'pak');
  write('locales/en-US.pak', 'locale');
  write('obj/chrome/foo.obj');
  write('gen/base/bar.h');
  write('build.ninja');
  write('chrome.dll.pdb');
  write('unit_tests.exe');
  write('browser_tests.exe');
  if (!complete) {
    write('chrome.exe.missing', ''); // irrelevant extra file
    write('bogus.pdb', '');
  }
  return outDir;
}

describe('build artefact classification', () => {
  it('excludes build state, symbols and test binaries', () => {
    for (const excluded of [
      'obj/chrome/x.obj',
      'gen/base/y.h',
      'build.ninja',
      'args.gn',
      'chrome.dll.pdb',
      'unit_tests.exe',
      'browser_tests.exe',
      'chromedriver.exe',
      'C:/fake/path/test_support/z.exe',
    ]) {
      expect(isBuildArtefact(excluded), excluded).toBe(true);
    }
  });

  it('keeps runtime files', () => {
    for (const kept of [
      'chrome.exe',
      'chrome.dll',
      'resources.pak',
      'icudtl.dat',
      'v8_context_snapshot.bin',
      'locales/en-US.pak',
      'swiftshader/vk_swiftshader.dll',
    ]) {
      expect(isBuildArtefact(kept), kept).toBe(false);
    }
  });
});

describe('staging plan', () => {
  it('selects the runtime set and reports what it left behind', () => {
    const outDir = fakeBuildOutput();
    const plan = planStaging(outDir);
    expect(plan.problems).toEqual([]);
    expect(plan.files).toContain('chrome.exe');
    expect(plan.files).toContain('locales/en-US.pak');
    expect(plan.files).not.toContain('build.ninja');
    expect(plan.excluded.length).toBeGreaterThanOrEqual(5);
  });

  it('refuses an incomplete build output', () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'aurelia-out-'));
    mkdirSync(path.join(outDir, 'locales'), { recursive: true });
    writeFileSync(path.join(outDir, 'chrome.dll'), 'x');
    const plan = planStaging(outDir);
    expect(plan.problems.join(' ')).toContain('chrome.exe');
    expect(plan.problems.join(' ')).toContain('icudtl.dat');
  });
});

describe('artifact name', () => {
  it('follows the signed-none convention', () => {
    expect(
      artifactName({ revision: 'cfaadc5a132d78e1828635aa8405a499f3e14864' }),
    ).toBe('aurelia-windows-x64-dev-cfaadc5-UNSIGNED.zip');
  });
});

describe('build manifest', () => {
  const config = loadConfig();

  it('records provenance, configuration and the signing reality', () => {
    const manifest = buildManifest({
      config,
      aureliaRevision: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      platform: 'windows',
      arch: 'x64',
      gnArgsText: readFileSync(GN_ARGS, 'utf8'),
      artifact: 'aurelia-windows-x64-dev-deadbee-UNSIGNED.zip',
      timestamp: '2026-10-07T00:00:00.000Z',
    });
    expect(manifest.build.chromiumVersion).toBe(config.chromium.version);
    expect(manifest.build.chromiumRevision).toBe(config.chromium.revision);
    expect(manifest.build.depotToolsRevision).toBe(
      config.toolchain.depotTools.revision,
    );
    expect(manifest.build.patchSetVersion).toBeTruthy();
    expect(manifest.build.configuration).toBe('release-component-development');
    expect(manifest.build.gnArgs.is_debug).toBe('false');
    expect(manifest.signing).toMatchObject({
      signed: false,
      productionReady: false,
    });
    expect(manifest.smokeTest.state).toBe('pending');
  });

  it('refuses GN arguments that violate the policy', () => {
    expect(() =>
      buildManifest({
        config,
        aureliaRevision: 'x',
        platform: 'windows',
        arch: 'x64',
        gnArgsText: 'is_official_build = true\n',
        artifact: 'x.zip',
      }),
    ).toThrow(/GN arguments failed policy check/);
  });
});

describe('staging a fake build end to end', () => {
  it('writes the runtime set, the manifest and the checksums', async () => {
    const outDir = fakeBuildOutput();
    const dest = mkdtempSync(path.join(tmpdir(), 'aurelia-stage-'));
    const result = await stageRuntime({
      outDir,
      dest,
      aureliaRevision: '0123456789abcdef0123456789abcdef01234567',
      gnArgsFile: GN_ARGS,
    });

    expect(existsSync(path.join(dest, 'chrome.exe'))).toBe(true);
    expect(existsSync(path.join(dest, 'locales/en-US.pak'))).toBe(true);
    expect(existsSync(path.join(dest, 'build.ninja'))).toBe(false);
    expect(existsSync(path.join(dest, MANIFEST_NAME))).toBe(true);
    expect(existsSync(path.join(dest, SUMS_NAME))).toBe(true);

    const sums = readFileSync(path.join(dest, SUMS_NAME), 'utf8')
      .trim()
      .split('\n');
    expect(sums).toHaveLength(result.files.length);
    expect(sums.join(' ')).not.toContain(MANIFEST_NAME);
    expect(sums[0]).toMatch(/^[0-9a-f]{64} {2}/);

    const reportFile = path.join(dest, 'smoke-report.json');
    writeFileSync(
      reportFile,
      JSON.stringify({
        passed: true,
        binary: 'staged/chrome.exe',
        sandboxMode: 'default',
        equivalentToProductRuntime: true,
        results: [{ name: 'browser process starts', ok: true }],
      }),
    );
    const updated = recordSmokeTest({
      dest,
      report: JSON.parse(readFileSync(reportFile, 'utf8')),
    });
    expect(updated.smokeTest.state).toBe('passed');
    expect(updated.smokeTest.sandboxMode).toBe('default');
  });
});
