#!/usr/bin/env node
/**
 * Secret scan for the repository.
 *
 * This is a safety net, not a substitute for review: it catches the common
 * ways a credential ends up committed. It runs in fast CI and locally via
 * `node tools/ci/secret-scan.mjs`.
 *
 * Philosophy:
 *  - scan every tracked file, not just a directory list;
 *  - never print the matched secret, only its location and pattern name;
 *  - allow explicit, reviewed exceptions in tools/ci/secret-scan-allowlist.txt
 *    (test fixtures and documentation examples only).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/entry.mjs';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

const ALLOWLIST_PATH = path.join(
  REPO_ROOT,
  'tools/ci/secret-scan-allowlist.txt',
);

/**
 * Patterns are intentionally specific: a generic "high entropy string" rule
 * produces noise that trains people to ignore the scanner.
 */
export const PATTERNS = [
  { name: 'aws-access-key-id', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  {
    name: 'aws-secret-access-key',
    regex: /\baws_secret_access_key\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}/i,
  },
  {
    name: 'private-key-block',
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
  },
  { name: 'google-api-key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'github-token', regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'slack-token', regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'stripe-secret', regex: /\bsk_live_[A-Za-z0-9]{16,}\b/ },
  {
    name: 'jwt',
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
  {
    name: 'supabase-service-role',
    regex: /(?:service[_-]?role|SUPABASE_SERVICE)/i,
  },
  {
    name: 'generic-secret-assignment',
    regex:
      /\b(?:api[_-]?key|secret|password|passwd|token)\s*[:=]\s*["'][A-Za-z0-9/+=_-]{16,}["']/i,
  },
];

/** File name patterns that are never allowed to be committed. */
export const FORBIDDEN_FILE_PATTERNS = [
  /(^|\/)\.env$/,
  /(^|\/)\.env\.(?!example|sample)/,
  /\.pem$/,
  /\.p12$/,
  /\.pfx$/,
  /\.keystore$/,
  /(^|\/)id_(?:rsa|ed25519|ecdsa)$/,
  /(^|\/)credentials\.json$/,
  /(^|\/)\.netrc$/,
];

/** Paths that are documentation or fixtures and legitimately contain examples. */
export const DEFAULT_EXEMPTIONS = [
  /^LICENSE$/,
  /^tools\/ci\/secret-scan\.mjs$/,
  /^tools\/ci\/secret-scan-allowlist\.txt$/,
  /^docs\//,
  /^README\.md$/,
  /^SECURITY\.md$/,
  /^PRIVACY\.md$/,
  /^CONTRIBUTING\.md$/,
  /^\.github\//,
];

export function listTrackedFiles(root = REPO_ROOT) {
  const output = execFileSync('git', ['-C', root, 'ls-files'], {
    encoding: 'utf8',
  });
  return output.split('\n').filter((line) => line.length > 0);
}

export function loadAllowlist() {
  if (!existsSync(ALLOWLIST_PATH)) return [];
  return readFileSync(ALLOWLIST_PATH, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

export function scanRepository({ root = REPO_ROOT, files } = {}) {
  const tracked = files ?? listTrackedFiles(root);
  const allowlist = loadAllowlist();
  const findings = [];

  for (const relativePath of tracked) {
    const absolute = path.join(root, relativePath);
    if (DEFAULT_EXEMPTIONS.some((regex) => regex.test(relativePath))) continue;
    if (allowlist.includes(relativePath)) continue;

    for (const pattern of FORBIDDEN_FILE_PATTERNS) {
      if (pattern.test(relativePath)) {
        findings.push({
          path: relativePath,
          pattern: 'forbidden-file-name',
          detail: `matches ${pattern}`,
        });
      }
    }

    let contents;
    try {
      contents = readFileSync(absolute, 'utf8');
    } catch {
      continue; // binary or unreadable; forbidden-name checks already ran
    }
    if (contents.includes('\u0000')) continue;

    for (const pattern of PATTERNS) {
      if (pattern.regex.test(contents)) {
        findings.push({
          path: relativePath,
          pattern: pattern.name,
          detail: 'possible credential (value withheld)',
        });
      }
    }
  }

  return findings;
}

const isMain = isMainModule(import.meta.url);

if (isMain) {
  const findings = scanRepository();
  if (findings.length === 0) {
    console.log('secret scan: no findings');
    process.exitCode = 0;
  } else {
    console.error(`secret scan: ${findings.length} finding(s)`);
    for (const finding of findings) {
      console.error(
        `  ${finding.path}  [${finding.pattern}] ${finding.detail}`,
      );
    }
    console.error(
      '\nIf a finding is a legitimate example, add the file path to tools/ci/secret-scan-allowlist.txt with a justification.',
    );
    process.exitCode = 1;
  }
}
