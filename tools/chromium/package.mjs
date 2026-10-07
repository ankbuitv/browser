#!/usr/bin/env node
/**
 * Package a staged runtime directory into the unsigned development artifact.
 *
 * The artifact is the complete browser directory from stage-runtime.mjs
 * (chrome.exe, the DLL set, pak files, locales, the manifest and
 * SHA256SUMS.txt) zipped as
 * `aurelia-windows-x64-dev-<aurelia-short-sha>-UNSIGNED.zip`, with a
 * `.sha256` sidecar in `sha256sum` format. It is never signed, never called
 * production-ready, and the zip is written next to (not inside) the staging
 * directory so re-packaging stays idempotent.
 *
 * The zip is written here rather than by PowerShell's Compress-Archive so the
 * same code path runs on every platform and can be tested in this repository.
 * It is a plain store/deflate zip (no encryption, no zip64): archives above
 * 4 GB - which a Chromium build must not produce - are refused with a clear
 * message rather than written incorrectly. Files are read, compressed and
 * written one at a time, so packaging a multi-hundred-MB staging directory
 * does not need the archive in memory.
 *
 * Usage:
 *   node tools/chromium/package.mjs --stage <staging dir> [--dest <output dir>]
 *   node tools/chromium/package.mjs --stage <dir> --name custom-name.zip --json
 */
import { createHash } from 'node:crypto';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';

import { isMainModule } from '../lib/entry.mjs';

export const MANIFEST_NAME = 'build-manifest.json';

/** Plain zip (no zip64): 4 GB is the largest archive this tool can write. */
export const ZIP_LIMIT_BYTES = 0xffffffff;

/** Standard CRC-32 (polynomial 0xEDB88320), table built once. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value;
  }
  return table;
})();

export function crc32(buffer) {
  let crc = -1;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

export function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** Every file below `root`, relative, with forward slashes, sorted. */
export function listStagedFiles(root, { base = root, out = [] } = {}) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      listStagedFiles(full, { base, out });
    } else if (entry.isFile()) {
      out.push(path.relative(base, full).split(path.sep).join('/'));
    }
  }
  return out.sort();
}

/** One local file header + name + payload, written at `offset`. */
function writeEntry({ name, data, stat, offset, limitBytes = ZIP_LIMIT_BYTES }) {
  const deflated = deflateRawSync(data, { level: 9 });
  const method = deflated.length < data.length ? 8 : 0;
  const payload = method === 8 ? deflated : data;
  const crc = crc32(data);
  const { time, date } = dosDateTime(stat.mtime);
  const nameBuffer = Buffer.from(name, 'utf8');

  if (data.length > limitBytes || offset + payload.length > limitBytes) {
    throw new Error(
      `archive would exceed 4 GB at ${name}; this tool writes plain zip only - use PowerShell (Compress-Archive) or zip(1) for an archive this large`,
    );
  }

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed to extract
  local.writeUInt16LE(0x0800, 6); // UTF-8 file names
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(date, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(payload.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuffer.length, 26);
  local.writeUInt16LE(0, 28);

  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4); // version made by
  header.writeUInt16LE(20, 6); // version needed to extract
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(method, 10);
  header.writeUInt16LE(time, 12);
  header.writeUInt16LE(date, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(payload.length, 20);
  header.writeUInt32LE(data.length, 24);
  header.writeUInt16LE(nameBuffer.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(offset, 42);

  return { parts: [local, nameBuffer, payload], central: [header, nameBuffer] };
}

/**
 * Write a zip archive of everything below `sourceDir`.
 * @returns {Promise<{files: number, uncompressedBytes: number, archiveBytes: number}>}
 */
export async function createZip({
  sourceDir,
  outFile,
  log = () => {},
  maxBytes = ZIP_LIMIT_BYTES,
}) {
  const names = listStagedFiles(sourceDir);
  if (names.length === 0) {
    throw new Error(`nothing to package: ${sourceDir} is empty`);
  }

  const out = createWriteStream(outFile);
  const finished = new Promise((resolve, reject) => {
    out.on('error', reject);
    out.on('finish', resolve);
  });

  const central = [];
  let offset = 0;
  let uncompressedBytes = 0;

  try {
    for (const name of names) {
      const full = path.join(sourceDir, ...name.split('/'));
      const data = readFileSync(full);
      const stat = statSync(full);
      const { parts, central: centralParts } = writeEntry({
        name,
        data,
        stat,
        offset,
        limitBytes: maxBytes,
      });
      for (const part of parts) {
        out.write(part);
        offset += part.length;
      }
      central.push(...centralParts);
      uncompressedBytes += data.length;
      log(`  + ${name} (${data.length} bytes packed)`);
    }

    const centralBuffer = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(names.length, 8);
    end.writeUInt16LE(names.length, 10);
    end.writeUInt32LE(centralBuffer.length, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20);
    out.write(centralBuffer);
    out.write(end);
    out.end();

    const bytes = offset + centralBuffer.length + end.length;
    await finished;
    return { files: names.length, uncompressedBytes, archiveBytes: bytes };
  } catch (error) {
    // The stream is still open: drop it, remove the partial archive (a truncated
    // zip next to a real one is worse than no zip) and make sure the write
    // stream's own failure never surfaces as an unhandled rejection - the
    // caller must see the real reason the archive was refused.
    out.destroy();
    finished.catch(() => {});
    try {
      rmSync(outFile, { force: true });
    } catch {
      // best effort only
    }
    throw error;
  }
}

/** Package a staged directory using the artifact name recorded in its manifest. */
export async function packageStaged({
  stageDir,
  destDir,
  name,
  log = () => {},
} = {}) {
  if (stageDir === undefined || !existsSync(stageDir)) {
    throw new Error('--stage <staging directory> is required and must exist');
  }
  if (!existsSync(path.join(stageDir, 'chrome.exe'))) {
    throw new Error(
      `${stageDir} has no chrome.exe: stage the complete runtime directory first (tools/chromium/stage-runtime.mjs)`,
    );
  }
  const outputDir = destDir ?? path.resolve(stageDir, '..');
  mkdirSync(outputDir, { recursive: true });

  let artifact = name;
  const manifestPath = path.join(stageDir, MANIFEST_NAME);
  if (artifact === undefined) {
    if (!existsSync(manifestPath)) {
      throw new Error(
        `no ${MANIFEST_NAME} in ${stageDir} and no --name given; cannot derive the artifact name`,
      );
    }
    artifact = JSON.parse(readFileSync(manifestPath, 'utf8')).artifact;
  }
  if (typeof artifact !== 'string' || !artifact.endsWith('.zip')) {
    throw new Error(`artifact name "${artifact}" must end in .zip`);
  }

  const zipPath = path.join(outputDir, artifact);
  const stats = await createZip({ sourceDir: stageDir, outFile: zipPath, log });
  const digest = sha256File(zipPath);
  const sha256Path = `${zipPath}.sha256`;
  writeFileSync(sha256Path, `${digest}  ${artifact}\n`);

  return { artifact, zipPath, sha256Path, digest, ...stats };
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
      console.log(`Package a staged Aurelia runtime directory (unsigned development artifact).

  --stage <dir>   staged runtime directory (must contain chrome.exe)
  --dest <dir>    where to write the .zip and .sha256 (default: the stage parent)
  --name <file>   override the artifact name recorded in build-manifest.json
  --json          machine-readable summary

The artifact is unsigned and never production-ready; see docs/BUILDING-CHROMIUM.md.`);
      process.exitCode = 0;
    } else {
      const result = await packageStaged({
        stageDir: valueOf('--stage'),
        destDir: valueOf('--dest'),
        name: valueOf('--name'),
        log: argv.includes('--json') ? () => {} : console.log,
      });
      if (argv.includes('--json')) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log('');
        console.log(`artifact: ${result.zipPath}`);
        console.log(`  files:      ${result.files}`);
        console.log(`  unpacked:   ${result.uncompressedBytes} bytes`);
        console.log(`  archive:    ${result.archiveBytes} bytes`);
        console.log(`  sha256:     ${result.digest}`);
        console.log(`  checksum:   ${result.sha256Path}`);
        console.log(
          'signed=false productionReady=false - unsigned development artifact',
        );
      }
      process.exitCode = 0;
    }
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  }
}
