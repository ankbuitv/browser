/**
 * GN argument policy.
 *
 * The first Windows build configuration must stay inside a reviewed allowlist:
 * every key was verified to exist in Chromium at the pinned revision, and no
 * configuration may quietly weaken a security property or switch to a
 * configuration the project cannot support (official builds, instrumented
 * builds).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  GN_ARGS_DIR,
  parseGnArgs,
  renderGnArgs,
  validateGnArgs,
} from '../../tools/chromium/gn-args.mjs';

const WINDOWS_DEV = path.join(GN_ARGS_DIR, 'win-x64-dev.gn');

describe('GN argument policy', () => {
  it('accepts the shipped Windows development configuration', () => {
    const { entries, problems } = validateGnArgs(
      readFileSync(WINDOWS_DEV, 'utf8'),
    );
    expect(problems).toEqual([]);
    const keys = entries.map(({ key }) => key);
    expect(keys).toContain('is_debug');
    expect(keys).toContain('is_official_build');
    expect(keys).toContain('is_component_build');
    expect(keys).toContain('target_cpu');
  });

  it('ignores comments and blank lines, and rejects duplicate keys', () => {
    const { entries } = parseGnArgs(
      '# comment\n\nis_debug = false\n  # indented comment\n',
    );
    expect(entries).toEqual([{ key: 'is_debug', value: 'false', line: 3 }]);

    const { problems } = validateGnArgs('is_debug = false\nis_debug = true\n');
    expect(problems.join(' ')).toMatch(/duplicate argument is_debug/);
  });

  it('rejects keys that are not on the reviewed allowlist', () => {
    const { problems } = validateGnArgs('enable_unicorns = true\n');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('not in the reviewed allowlist');
  });

  it('rejects values outside the allowed set', () => {
    const { problems } = validateGnArgs('is_official_build = true\n');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('outside the allowed values');
  });

  it('rejects instrumented builds', () => {
    const { problems } = validateGnArgs('is_asan = true\n');
    expect(problems.join(' ')).toContain(
      'instrumented builds are not product builds',
    );
  });

  it('rejects security-relevant switches even when the name looks legitimate', () => {
    const { problems } = validateGnArgs('disable_site_isolation = true\n');
    expect(problems.join(' ')).toContain('security-relevant switches');
  });

  it('renders a single-line argument string for gn gen', () => {
    const { entries } = parseGnArgs('is_debug = false\ntarget_cpu = "x64"\n');
    expect(renderGnArgs(entries)).toBe('is_debug = false target_cpu = "x64"');
  });
});
