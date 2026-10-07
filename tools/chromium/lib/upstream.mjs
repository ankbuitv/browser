/**
 * Fetching upstream files at an exact pinned revision.
 *
 * Two transports are supported on purpose:
 *  - `api` (default): GitHub REST contents API via `gh`. Used in restricted
 *    sandboxes where only api.github.com is reachable.
 *  - `git`: `git archive`/`git show` from a local Chromium checkout. Used on
 *    build machines, and required when the pinned upstream is not on GitHub.
 *
 * Both verify a SHA-256 digest of the fetched bytes, so a transport problem can
 * never be mistaken for an upstream change.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { captureCommand, captureCommandBuffer } from './exec.mjs';

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Run a command and return stdout, throwing a readable error on failure.
 *
 * Windows goes through cmd.exe (see lib/exec.mjs) so that `gclient.bat`,
 * `gn.bat` and `autoninja.bat` from depot_tools are found through PATHEXT - and
 * so that a path containing a space survives the trip.
 */
export function run(command, args, options = {}) {
  const { cwd, env } = options;
  return captureCommand({ file: command, args, cwd, env });
}

function ghAvailable() {
  try {
    run('gh', ['--version']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch a single file's bytes from GitHub at an exact commit.
 * @returns {Buffer}
 */
export function fetchUpstreamFileViaApi(slug, revision, filePath) {
  const encodedPath = filePath
    .split('/')
    .map(encodeURIComponent)
    .join('/');
  const raw = run('gh', [
    'api',
    `repos/${slug}/contents/${encodedPath}?ref=${revision}`,
    '--jq',
    '.content',
  ]);
  const cleaned = raw.replace(/\s+/g, '');
  return Buffer.from(cleaned, 'base64');
}

/**
 * Fetch a single file's bytes from a local Chromium checkout (git transport).
 * @returns {Buffer}
 */
export function fetchUpstreamFileViaGit(checkoutPath, revision, filePath) {
  return captureCommandBuffer({
    file: 'git',
    args: ['-C', checkoutPath, 'show', `${revision}:${filePath}`],
    maxBuffer: 256 * 1024 * 1024,
  });
}

/**
 * Extract the pinned pre-images of `paths` into `destinationDir`, preserving
 * repository-relative layout. Returns a manifest with digests.
 *
 * @param {{config: object, paths: string[], destinationDir: string,
 *   transport?: 'auto'|'api'|'git', checkoutPath?: string}} options
 */
export function extractPreImages({
  config,
  paths,
  destinationDir,
  transport = 'auto',
  checkoutPath,
}) {
  const revision = config.chromium.revision;
  const slugMatches = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/.exec(
    config.chromium.upstreamRepository,
  );
  const slug = slugMatches === null ? null : slugMatches[1];

  let resolvedTransport = transport;
  if (transport === 'auto') {
    if (checkoutPath !== undefined && checkoutPath !== null) {
      resolvedTransport = 'git';
    } else if (slug !== null && ghAvailable()) {
      resolvedTransport = 'api';
    } else {
      throw new Error(
        'no usable upstream transport: install `gh` (api transport) or pass --checkout <path> (git transport)',
      );
    }
  }

  const entries = [];
  for (const filePath of paths) {
    let bytes;
    if (resolvedTransport === 'git') {
      if (checkoutPath === undefined || checkoutPath === null) {
        throw new Error('git transport requires --checkout <path>');
      }
      bytes = fetchUpstreamFileViaGit(checkoutPath, revision, filePath);
    } else {
      if (slug === null) {
        throw new Error(
          'api transport requires a github.com upstream repository URL',
        );
      }
      bytes = fetchUpstreamFileViaApi(slug, revision, filePath);
    }

    const destination = path.join(destinationDir, filePath);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, bytes);
    entries.push({
      path: filePath,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    });
  }

  return { transport: resolvedTransport, revision, entries };
}

/** Create a scratch directory under the system temp dir. */
export function makeScratchDir(prefix = 'aurelia-chromium-') {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

/** Read a file as a UTF-8 string. */
export function readText(filePath) {
  return readFileSync(filePath, 'utf8');
}
