#!/usr/bin/env node
/**
 * Verify that the pinned revision is the revision the upstream mirror tags with
 * the pinned version, and that `chrome/VERSION` at that revision says so too.
 *
 * This exists because "the newest version number" is not evidence of anything
 * and because pin evidence has to be re-checkable by anyone, at any time, with
 * one command. It is deliberately network-only and read-only.
 *
 * Note on the mirror: github.com/chromium/chromium exposes release *tags*
 * (`refs/tags/<version>`) but no GitHub *Releases*, so the tag is the mirror's
 * usable marker. Chromium's own release branches live on
 * chromium.googlesource.com as `refs/branch-heads/<build>`.
 *
 * Usage:
 *   node tools/chromium/verify-pin.mjs            # network check
 *   node tools/chromium/verify-pin.mjs --json
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from './lib/config.mjs';
import { isMainModule } from '../lib/entry.mjs';

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

/**
 * The upstream tag for a pinned version.
 *
 * Chromium's dot-separated versions are also the tag names, which is why the
 * tag can be derived rather than guessed.
 */
export function tagForVersion(version) {
  return `refs/tags/${version}`;
}

/** Default transport: `git ls-remote`, which needs no API token. */
export function fetchTagSha(repository, tag) {
  const result = spawnSync('git', ['ls-remote', repository, tag], {
    encoding: 'utf8',
    env: process.env,
  });
  if (result.error !== undefined) {
    throw new Error(`git ls-remote failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `git ls-remote failed (${result.status}): ${result.stderr.trim()}`,
    );
  }
  const line = result.stdout.trim().split('\n')[0] ?? '';
  const sha = line.split(/\s+/)[0];
  return sha === undefined || sha === '' ? null : sha;
}

/** Default transport: read a file at a revision through the GitHub API. */
export function fetchFileAtRevision(repository, revision, file) {
  const [owner, name] = repository
    .replace(/^https?:\/\/(www\.)?github\.com\//, '')
    .replace(/\.git$/, '')
    .split('/');
  const result = spawnSync(
    'gh',
    [
      'api',
      `repos/${owner}/${name}/contents/${file}?ref=${revision}`,
      '--jq',
      '.content',
    ],
    { encoding: 'utf8', env: process.env },
  );
  if (result.status !== 0) {
    throw new Error(
      `gh api failed (${result.status}): ${result.stderr.trim()}`,
    );
  }
  const decoded = Buffer.from(result.stdout.trim(), 'base64').toString('utf8');
  return decoded;
}

/**
 * @returns {{ok: boolean, checks: {name: string, ok: boolean, details: string}[], problems: string[]}}
 */
export function verifyPin({
  config = loadConfig(),
  fetchTag = fetchTagSha,
  fetchFile = fetchFileAtRevision,
} = {}) {
  const { version, revision, upstreamRepository: repository } = config.chromium;
  const checks = [];
  const problems = [];

  const tag = tagForVersion(version);
  const tagSha = fetchTag(repository, tag);
  checks.push({
    name: `upstream tag ${tag} resolves to the pinned commit`,
    ok: tagSha === revision,
    details:
      tagSha === null
        ? `tag not found in ${repository}`
        : `${tagSha}${tagSha === revision ? '' : ` (expected ${revision})`}`,
  });

  const versionFile = fetchFile(repository, revision, 'chrome/VERSION');
  const parsed = Object.fromEntries(
    versionFile
      .split('\n')
      .map((line) => line.split('='))
      .filter((parts) => parts.length === 2)
      .map(([key, value]) => [key.trim(), value.trim()]),
  );
  const reported = `${parsed.MAJOR ?? '?'}.${parsed.MINOR ?? '?'}.${parsed.BUILD ?? '?'}.${parsed.PATCH ?? '?'}`;
  checks.push({
    name: 'chrome/VERSION at the pinned commit matches the pinned version',
    ok: reported === version,
    details: `reports ${reported}`,
  });

  for (const check of checks) {
    if (!check.ok) {
      problems.push(`${check.name}: ${check.details}`);
    }
  }
  return { ok: problems.length === 0, checks, problems };
}

const isMain = isMainModule(import.meta.url);

if (isMain) {
  try {
    const config = loadConfig();
    const result = verifyPin({ config });
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      for (const check of result.checks) {
        console.log(
          `${check.ok ? 'PASS' : 'FAIL'}  ${check.name}\n        ${check.details}`,
        );
      }
      console.log('');
      console.log(
        result.ok
          ? `pin verified: ${config.chromium.version} is the upstream tag for ${config.chromium.revision}`
          : 'PIN VERIFICATION FAILED',
      );
    }
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  }
}
