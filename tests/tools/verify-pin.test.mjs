import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { tagForVersion, verifyPin } from '../../tools/chromium/verify-pin.mjs';

const PIN = {
  version: '155.0.8059.40',
  revision: 'cfaadc5a132d78e1828635aa8405a499f3e14864',
  upstreamRepository: 'https://github.com/chromium/chromium',
};

function config(overrides = {}) {
  return { chromium: { ...PIN, ...overrides } };
}

const versionFile = (patch = '40') =>
  `MAJOR=155\nMINOR=0\nBUILD=8059\nPATCH=${patch}\n`;

describe('pin verification', () => {
  it('derives the upstream tag from the version', () => {
    expect(tagForVersion('155.0.8059.40')).toBe('refs/tags/155.0.8059.40');
  });

  it('passes when the tag and chrome/VERSION agree with the pin', () => {
    const result = verifyPin({
      config: config(),
      fetchTag: () => PIN.revision,
      fetchFile: () => versionFile(),
    });
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
    expect(result.checks).toHaveLength(2);
  });

  it('fails when the tag points at another commit', () => {
    const result = verifyPin({
      config: config(),
      fetchTag: () => 'a'.repeat(40),
      fetchFile: () => versionFile(),
    });
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/expected cfaadc5a/);
  });

  it('fails when the tag does not exist', () => {
    const result = verifyPin({
      config: config(),
      fetchTag: () => null,
      fetchFile: () => versionFile(),
    });
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/tag not found/);
  });

  it('fails when chrome/VERSION disagrees with the pin', () => {
    const result = verifyPin({
      config: config(),
      fetchTag: () => PIN.revision,
      fetchFile: () => versionFile('73'),
    });
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/reports 155\.0\.8059\.73/);
  });

  it('checks the real repository configuration', () => {
    // Offline: the network check is exercised by CI, not by unit tests.
    const { chromium } = JSON.parse(
      readFileSync(
        path.join(process.cwd(), 'config/chromium_version.json'),
        'utf8',
      ),
    );
    expect(tagForVersion(chromium.version)).toBe(
      `refs/tags/${chromium.version}`,
    );
    expect(chromium.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(chromium.pinEvidence.join('\n')).toContain('ls-remote');
  });
});
