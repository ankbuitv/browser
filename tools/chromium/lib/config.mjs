/**
 * Chromium pin configuration: loading, validation and derived helpers.
 *
 * This module is the only place that knows the shape of
 * `config/chromium_version.json`. Every tool goes through it so that a
 * malformed pin cannot silently degrade into "build whatever is on main".
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

export const CONFIG_PATH = path.join(
  REPO_ROOT,
  'config',
  'chromium_version.json',
);

export const SUPPORTED_SCHEMA_VERSION = 1;

/** Git refs that must never appear as a pinned revision. */
export const FORBIDDEN_MOVING_REFS = new Set([
  'main',
  'master',
  'latest',
  'HEAD',
  'trunk',
  'beta',
  'dev',
  'canary',
]);

const SHA1_RE = /^[0-9a-f]{40}$/;
const VERSION_RE = /^\d+\.\d+\.\d+\.\d+$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class ConfigError extends Error {
  constructor(problems) {
    super(`Invalid chromium_version.json:\n- ${problems.join('\n- ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

/**
 * Validate a parsed config object. Returns a list of human-readable problems;
 * an empty list means the config is valid.
 */
export function findConfigProblems(config) {
  const problems = [];
  if (config === null || typeof config !== 'object') {
    return ['config is not an object'];
  }

  if (config.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    problems.push(
      `schemaVersion must be ${SUPPORTED_SCHEMA_VERSION}, found ${JSON.stringify(config.schemaVersion)}`,
    );
  }

  const product = config.product;
  if (product === null || typeof product !== 'object') {
    problems.push('product is missing');
  } else {
    if (typeof product.codename !== 'string' || product.codename.length === 0) {
      problems.push('product.codename must be a non-empty string');
    }
    if (typeof product.version !== 'string' || !SEMVER_RE.test(product.version)) {
      problems.push('product.version must look like 0.1.0');
    }
    if (product.nameIsCodenameOnly !== true) {
      problems.push(
        'product.nameIsCodenameOnly must be true until the naming review concludes (docs/NAMING.md)',
      );
    }
  }

  const chromium = config.chromium;
  if (chromium === null || typeof chromium !== 'object') {
    problems.push('chromium is missing');
    return problems;
  }

  if (typeof chromium.revision !== 'string' || !SHA1_RE.test(chromium.revision)) {
    problems.push(
      `chromium.revision must be a full 40-character commit SHA, found ${JSON.stringify(chromium.revision)}`,
    );
  }
  if (
    typeof chromium.upstreamRef === 'string' &&
    FORBIDDEN_MOVING_REFS.has(chromium.upstreamRef)
  ) {
    problems.push(
      `chromium.upstreamRef must not be a moving ref (found ${chromium.upstreamRef})`,
    );
  }
  if (typeof chromium.version !== 'string' || !VERSION_RE.test(chromium.version)) {
    problems.push('chromium.version must look like 155.0.8059.40');
  }
  if (!Number.isInteger(chromium.milestone) || chromium.milestone <= 0) {
    problems.push('chromium.milestone must be a positive integer');
  }
  if (typeof chromium.channel !== 'string' || chromium.channel.length === 0) {
    problems.push('chromium.channel must be a non-empty string');
  }
  if (
    typeof chromium.pinnedAt !== 'string' ||
    !ISO_DATE_RE.test(chromium.pinnedAt)
  ) {
    problems.push('chromium.pinnedAt must be an ISO date (YYYY-MM-DD)');
  }
  if (
    typeof chromium.upstreamRepository !== 'string' ||
    !chromium.upstreamRepository.startsWith('https://')
  ) {
    problems.push('chromium.upstreamRepository must be an https URL');
  } else if (
    !/^https:\/\/(github\.com|chromium\.googlesource\.com)\//.test(
      chromium.upstreamRepository,
    )
  ) {
    problems.push(
      'chromium.upstreamRepository must point at an expected upstream origin (github.com/chromium/chromium or chromium.googlesource.com)',
    );
  }

  const patchSet = config.patchSet;
  if (patchSet === null || typeof patchSet !== 'object') {
    problems.push('patchSet is missing');
  } else {
    if (
      typeof patchSet.version !== 'string' ||
      !SEMVER_RE.test(patchSet.version)
    ) {
      problems.push('patchSet.version must look like 0.1.0');
    }
    if (patchSet.baseRevision !== chromium.revision) {
      problems.push(
        'patchSet.baseRevision must equal chromium.revision: patches target one exact revision',
      );
    }
    for (const key of ['directory', 'overlayDirectory', 'verificationDirectory']) {
      const value = patchSet[key];
      if (typeof value !== 'string' || value.length === 0) {
        problems.push(`patchSet.${key} must be a non-empty string`);
        continue;
      }
      if (path.isAbsolute(value) || value.startsWith('..')) {
        problems.push(`patchSet.${key} must be a repository-relative path`);
      }
    }
  }

  const toolchain = config.toolchain;
  if (toolchain !== undefined) {
    const depotTools = toolchain.depotTools;
    if (depotTools === undefined || depotTools === null) {
      problems.push('toolchain.depotTools must be present when toolchain is set');
    } else {
      if (
        typeof depotTools.source !== 'string' ||
        !/^https:\/\/(chromium\.googlesource\.com|github\.com)\//.test(
          depotTools.source,
        )
      ) {
        problems.push(
          'toolchain.depotTools.source must be an https URL from an expected origin',
        );
      }
      if (
        depotTools.revision !== null &&
        (typeof depotTools.revision !== 'string' ||
          !SHA1_RE.test(depotTools.revision))
      ) {
        problems.push(
          'toolchain.depotTools.revision must be null (unresolved) or a full commit SHA',
        );
      }
    }
  }

  const policy = config.updatePolicy;
  if (policy === null || typeof policy !== 'object') {
    problems.push('updatePolicy is missing');
  } else {
    if (policy.automaticMerge !== false) {
      problems.push(
        'updatePolicy.automaticMerge must be false: Chromium updates are never merged automatically',
      );
    }
    if (policy.allowMovingRefs !== false) {
      problems.push('updatePolicy.allowMovingRefs must be false');
    }
  }

  return problems;
}

/** Load and validate the pin configuration from disk. */
export function loadConfig(configPath = CONFIG_PATH) {
  const raw = readFileSync(configPath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ConfigError([`config is not valid JSON: ${error.message}`]);
  }
  const problems = findConfigProblems(parsed);
  if (problems.length > 0) {
    throw new ConfigError(problems);
  }
  return parsed;
}

/** Absolute path of the patch directory. */
export function patchesDir(config) {
  return path.join(REPO_ROOT, config.patchSet.directory);
}

/** Absolute path of the overlay directory. */
export function overlayDir(config) {
  return path.join(REPO_ROOT, config.patchSet.overlayDirectory);
}

/** Absolute path of the verification directory. */
export function verificationDir(config) {
  return path.join(REPO_ROOT, config.patchSet.verificationDirectory);
}

/**
 * The `owner/repo` slug used with the GitHub API for upstream file fetches.
 * Accepts the github.com URL form only; other upstream mirrors are handled by
 * full `git` checkouts instead of the REST API.
 */
export function upstreamSlug(config) {
  const url = new URL(config.chromium.upstreamRepository);
  if (url.hostname !== 'github.com') {
    return null;
  }
  return url.pathname.replace(/^\//, '').replace(/\.git$/, '');
}
