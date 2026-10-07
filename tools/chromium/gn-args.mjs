#!/usr/bin/env node
/**
 * GN argument policy for Aurelia's reviewed build configurations.
 *
 * The first Windows build must not "invent GN args blindly": every key in a
 * config/gn/*.gn file has to exist in Chromium at the pinned revision and be
 * listed here, with an allowed value set and a reason. Anything unknown fails,
 * which keeps a build configuration a reviewed artefact rather than a habit.
 *
 * Usage:
 *   node tools/chromium/gn-args.mjs config/gn/win-x64-dev.gn   # validate
 *   node tools/chromium/gn-args.mjs --all                     # validate every file
 *   node tools/chromium/gn-args.mjs --print config/gn/win-x64-dev.gn
 *
 * `--print` emits a single-line argument string for `gn gen --args="..."`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/entry.mjs';

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
export const GN_ARGS_DIR = path.join(REPO_ROOT, 'config/gn');

/**
 * The allowlist. Every entry was checked to exist at the pinned Chromium
 * revision (build/config/BUILDCONFIG.gn and build/config/compiler/compiler.gni).
 */
export const GN_ARG_POLICY = {
  is_debug: {
    allowed: ['true', 'false'],
    reason: 'documented Chromium build-mode switch',
  },
  is_official_build: {
    allowed: ['false'],
    reason:
      'official builds require Google-internal tooling, PGO profiles and signing; a product build must flip this deliberately in a reviewed change, not by accident',
  },
  is_component_build: {
    allowed: ['true', 'false'],
    reason: 'documented development-build switch (faster links)',
  },
  symbol_level: {
    allowed: ['0', '1', '2'],
    reason: 'documented symbol level',
  },
  concurrent_links: {
    allowed: ['1', '2'],
    reason:
      'upstream lever for memory-constrained machines: build/toolchain/concurrent_links.gni at the pinned revision ("we often want to run fewer links at once than we do compiles, because linking is memory-intensive"). Only small explicit values are allowed, and only for the low-resource experiment - the automatic value (-1) is upstream computing it from the machine. Explicit values are incompatible with thin LTO (upstream assert), which no Aurelia configuration enables',
  },
  treat_warnings_as_errors: {
    allowed: ['true', 'false'],
    reason: 'upstream warnings must not fail a downstream build',
  },
  target_cpu: {
    allowed: ['x64'],
    reason: 'first target platform is Windows x64',
  },
  target_os: {
    allowed: ['win'],
    reason: 'first target platform is Windows',
  },
};

/** Keys that are never acceptable in a product-build configuration. */
export const FORBIDDEN_KEY_PATTERNS = [
  {
    pattern: /^is_(asan|msan|tsan|ubsan|lsan)$/,
    reason: 'instrumented builds are not product builds',
  },
  {
    pattern: /(sandbox|site_isolation|cert_verif|process_isolation|disable_security)/i,
    reason:
      'security-relevant switches must never reach a product build configuration; Chromium does not expose supported GN switches for the sandbox, site isolation or certificate validation',
  },
];

const LINE_RE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/;

/** `"x64"` and `x64` are the same GN value; compare unquoted. */
export function normalizeGnValue(value) {
  const match = /^"([^"]*)"$/.exec(value) ?? /^'([^']*)'$/.exec(value);
  return match === null ? value : match[1];
}

/**
 * Parse GN arguments from text.
 *
 * @returns {{ entries: {key: string, value: string, line: number}[], problems: string[] }}
 */
export function parseGnArgs(text) {
  const entries = [];
  const problems = [];
  const seen = new Map();
  text.split('\n').forEach((raw, index) => {
    const line = raw.replace(/(^|\s)#.*$/, '').trim();
    if (line.length === 0) {
      return;
    }
    const match = LINE_RE.exec(line);
    if (match === null) {
      problems.push(`line ${index + 1}: not a \`key = value\` argument: ${raw.trim()}`);
      return;
    }
    const [, key, value] = match;
    if (seen.has(key)) {
      problems.push(
        `line ${index + 1}: duplicate argument ${key} (first set on line ${seen.get(key)})`,
      );
      return;
    }
    seen.set(key, index + 1);
    entries.push({ key, value, line: index + 1 });
  });
  return { entries, problems };
}

/**
 * Validate GN arguments against the reviewed policy.
 *
 * @returns {{ entries: {key: string, value: string, line: number}[], problems: string[] }}
 */
export function validateGnArgs(text, { policy = GN_ARG_POLICY } = {}) {
  const { entries, problems } = parseGnArgs(text);
  for (const { key, value, line } of entries) {
    const forbidden = FORBIDDEN_KEY_PATTERNS.find(({ pattern }) =>
      pattern.test(key),
    );
    if (forbidden !== undefined) {
      problems.push(`line ${line}: ${key} is not allowed (${forbidden.reason})`);
      continue;
    }
    const rule = policy[key];
    if (rule === undefined) {
      problems.push(
        `line ${line}: ${key} is not in the reviewed allowlist (tools/chromium/gn-args.mjs); verify it exists at the pinned Chromium revision, then add it with a reason and an allowed value set`,
      );
      continue;
    }
    if (!rule.allowed.includes(normalizeGnValue(value))) {
      problems.push(
        `line ${line}: ${key} = ${value} is outside the allowed values (${rule.allowed.join(', ')}) - ${rule.reason}`,
      );
    }
  }
  return { entries, problems };
}

/**
 * Split a single-line argument string back into pairs.
 *
 * `renderGnArgs` produces the exact text that goes into `gn gen --args=...`,
 * so it has to be re-readable: if a value could not be parsed back, it would
 * reach gn without ever having been checked. GN's own value grammar is larger
 * than this, but every value in the reviewed policy is a boolean, a number or a
 * quoted string, and anything else is reported as a problem instead of being
 * passed through.
 *
 * @returns {{ entries: {key: string, value: string}[], problems: string[] }}
 */
export function parseGnArgsLine(text) {
  const entries = [];
  const problems = [];
  const token = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*("[^"]*"|'[^']*'|[^\s]+)/g;
  let consumed = 0;
  let match;
  while ((match = token.exec(text)) !== null) {
    const gap = text.slice(consumed, match.index);
    if (gap.trim().length > 0) {
      problems.push(
        `unparsed text before \`${match[1]}\`: ${JSON.stringify(gap)}`,
      );
    }
    consumed = token.lastIndex;
    entries.push({ key: match[1], value: match[2] });
  }
  const rest = text.slice(consumed).trim();
  if (rest.length > 0) {
    problems.push(`unparsed text at the end: ${JSON.stringify(rest)}`);
  }
  return { entries, problems };
}

/** Single-line argument string for `gn gen --args="..."`. */
export function renderGnArgs(entries) {
  return entries.map(({ key, value }) => `${key} = ${value}`).join(' ');
}

export function gnArgFiles(directory = GN_ARGS_DIR) {
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory)
    .filter((name) => name.endsWith('.gn'))
    .sort()
    .map((name) => path.join(directory, name));
}

const isMain = isMainModule(import.meta.url);

if (isMain) {
  const argv = process.argv.slice(2);
  const print = argv.includes('--print');
  const all = argv.includes('--all');
  const json = argv.includes('--json');
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`Validate (and optionally render) the reviewed GN arguments.

  <file>    validate one configuration file
  --all     validate every config/gn/*.gn file
  --print   emit a single-line argument string for gn gen --args="..."
  --json    machine-readable result`);
    process.exitCode = 0;
  } else {
    const targets = all ? gnArgFiles() : argv.filter((arg) => !arg.startsWith('--'));
    if (targets.length === 0) {
      console.error('no GN argument file given (or none found in config/gn)');
      process.exitCode = 1;
    } else {
      const results = [];
      let failed = false;
      for (const target of targets) {
        if (!existsSync(target)) {
          console.error(`missing: ${target}`);
          failed = true;
          continue;
        }
        const text = readFileSync(target, 'utf8');
        const { entries, problems } = validateGnArgs(text);
        failed ||= problems.length > 0;
        results.push({ file: target, entries, problems });
        if (print) {
          const rendered = renderGnArgs(entries);
          const reparsed = parseGnArgsLine(rendered);
          if (reparsed.problems.length > 0) {
            console.error(
              `FAIL  ${path.relative(REPO_ROOT, target)}: the rendered argument string cannot be read back`,
            );
            for (const problem of reparsed.problems) {
              console.error(`        ${problem}`);
            }
            failed = true;
          } else {
            console.log(rendered);
          }
        } else if (json) {
          // collected below
        } else {
          const relative = path.relative(REPO_ROOT, target);
          if (problems.length === 0) {
            console.log(
              `PASS  ${relative}: ${entries.length} reviewed argument(s)`,
            );
          } else {
            console.error(`FAIL  ${relative}`);
            for (const problem of problems) {
              console.error(`        ${problem}`);
            }
          }
        }
      }
      if (json) {
        console.log(JSON.stringify(results, null, 2));
      }
      process.exitCode = failed ? 1 : 0;
    }
  }
}
