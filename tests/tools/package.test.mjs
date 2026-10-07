/**
 * Artifact packaging.
 *
 * The zip is written by our own code so it can be tested everywhere, which
 * makes it our responsibility to prove the archive is a real zip: it is
 * verified here by an independent implementation (Python's `zipfile`) rather
 * than by reading our own bytes back.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  MANIFEST_NAME,
  ZIP_LIMIT_BYTES,
  crc32,
  createZip,
  listStagedFiles,
  packageStaged,
  sha256File,
} from '../../tools/chromium/package.mjs';

const temporaryDirectories = [];

function temporaryDirectory() {
  const directory = mkdtempSync(path.join(tmpdir(), 'aurelia-package-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function hasPython() {
  const probe = spawnSync('python3', ['--version'], { encoding: 'utf8' });
  return probe.status === 0;
}

/** A staged directory that looks like a real one, but small. */
function stagedDirectory({
  artifact = 'aurelia-windows-x64-dev-abc1234-UNSIGNED.zip',
} = {}) {
  const root = path.join(temporaryDirectory(), 'staged');
  mkdirSync(path.join(root, 'locales'), { recursive: true });
  writeFileSync(
    path.join(root, 'chrome.exe'),
    Buffer.from('MZ fake binary', 'utf8'),
  );
  writeFileSync(path.join(root, 'icudtl.dat'), Buffer.from('icudtl', 'utf8'));
  writeFileSync(
    path.join(root, 'locales', 'en-US.pak'),
    Buffer.from('pak '.repeat(2000), 'utf8'),
  );
  writeFileSync(
    path.join(root, 'locales', '日本語.pak'),
    Buffer.from('utf8 file name '.repeat(50), 'utf8'),
  );
  // Random bytes do not compress, so this entry is stored rather than deflated.
  writeFileSync(
    path.join(root, 'chrome_elf.dll'),
    Buffer.from(
      Array.from({ length: 4096 }, (_, index) => (index * 7919) % 256),
    ),
  );
  writeFileSync(
    path.join(root, MANIFEST_NAME),
    JSON.stringify({ artifact, signed: false, productionReady: false }),
  );
  return root;
}

describe('crc32', () => {
  it('matches the standard check values', () => {
    expect(crc32(Buffer.from(''))).toBe(0);
    expect(crc32(Buffer.from('abc'))).toBe(0x352441c2);
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });
});

describe('staged file listing', () => {
  it('lists nested files with forward slashes, sorted', () => {
    const root = stagedDirectory();
    const files = listStagedFiles(root);
    expect(files).toEqual([...files].sort());
    expect(files).toContain('chrome.exe');
    expect(files).toContain('locales/en-US.pak');
    expect(files.every((file) => !file.includes('\\'))).toBe(true);
  });
});

describe('zip creation', () => {
  it('refuses an archive that would cross the plain-zip limit', async () => {
    const root = stagedDirectory();
    await expect(
      createZip({
        sourceDir: root,
        outFile: path.join(temporaryDirectory(), 'too-big.zip'),
        maxBytes: 16,
      }),
    ).rejects.toThrow(/4 GB/);
    expect(ZIP_LIMIT_BYTES).toBe(0xffffffff);
  });

  it('refuses an empty directory instead of writing an empty archive', async () => {
    const empty = path.join(temporaryDirectory(), 'empty');
    mkdirSync(empty, { recursive: true });
    await expect(
      createZip({
        sourceDir: empty,
        outFile: path.join(temporaryDirectory(), 'empty.zip'),
      }),
    ).rejects.toThrow(/nothing to package/);
  });

  it.runIf(hasPython())(
    'produces an archive an independent implementation accepts',
    async () => {
      const root = stagedDirectory();
      const zipPath = path.join(temporaryDirectory(), 'artifact.zip');
      const result = await createZip({
        sourceDir: root,
        outFile: zipPath,
        log: () => {},
      });

      expect(result.files).toBe(listStagedFiles(root).length);
      expect(result.archiveBytes).toBe(statSync(zipPath).size);

      const script = `
import json, sys, zipfile
path = sys.argv[1]
root = sys.argv[2]
with zipfile.ZipFile(path) as archive:
    names = sorted(archive.namelist())
    bad = archive.testzip()
    contents = {}
    for name in names:
        with archive.open(name) as handle:
            contents[name] = handle.read()
print(json.dumps({
    "names": names,
    "bad": bad,
    "utf8": any(name == "locales/日本語.pak" for name in names),
    "exe_ok": contents.get("chrome.exe", b"").decode() == "MZ fake binary",
    "pak_len": len(contents.get("locales/en-US.pak", b"")),
}))
`;
      const verified = spawnSync('python3', ['-c', script, zipPath, root], {
        encoding: 'utf8',
      });
      expect(verified.status, verified.stderr).toBe(0);
      const report = JSON.parse(verified.stdout);
      expect(report.bad).toBe(null);
      expect(report.names).toEqual(listStagedFiles(root));
      expect(report.utf8).toBe(true);
      expect(report.exe_ok).toBe(true);
      expect(report.pak_len).toBeGreaterThan(0);
    },
  );
});

describe('packaging a staged directory', () => {
  it('uses the artifact name from the manifest and writes a sha256 sidecar', async () => {
    const root = stagedDirectory();
    const output = path.join(temporaryDirectory(), 'out');
    const result = await packageStaged({
      stageDir: root,
      destDir: output,
      log: () => {},
    });

    expect(result.artifact).toBe(
      'aurelia-windows-x64-dev-abc1234-UNSIGNED.zip',
    );
    expect(existsSync(result.zipPath)).toBe(true);
    expect(existsSync(result.sha256Path)).toBe(true);

    // The sidecar is in sha256sum format: "<digest>  <name>".
    const sidecar = readFileSync(result.sha256Path, 'utf8');
    expect(sidecar).toBe(`${result.digest}  ${result.artifact}\n`);
    expect(sidecar).toMatch(/^[0-9a-f]{64} {2}\S+\n$/);

    // ... and the digest is the digest of the file that was written.
    const expected = createHash('sha256')
      .update(readFileSync(result.zipPath))
      .digest('hex');
    expect(result.digest).toBe(expected);
    expect(sha256File(result.zipPath)).toBe(expected);
  });

  it('refuses a directory without chrome.exe', async () => {
    const root = stagedDirectory();
    rmSync(path.join(root, 'chrome.exe'));
    await expect(
      packageStaged({ stageDir: root, destDir: temporaryDirectory() }),
    ).rejects.toThrow(/chrome\.exe/);
  });

  it('refuses a missing staging directory and a bad artifact name', async () => {
    await expect(
      packageStaged({ stageDir: path.join(tmpdir(), 'does-not-exist') }),
    ).rejects.toThrow(/--stage/);

    const root = stagedDirectory({ artifact: 'artifact.tar.gz' });
    await expect(
      packageStaged({ stageDir: root, destDir: temporaryDirectory() }),
    ).rejects.toThrow(/\.zip/);
  });
});
