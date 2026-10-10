import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  findConfigProblems,
  loadConfig,
  REPO_ROOT,
  upstreamSlug,
} from '../../tools/chromium/lib/config.mjs';

describe('chromium pin configuration', () => {
  it('loads and validates the checked-in pin', () => {
    const config = loadConfig();
    expect(config.chromium.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(config.schemaVersion).toBe(1);
    expect(config.patchSet.baseRevision).toBe(config.chromium.revision);
    expect(upstreamSlug(config)).toBe('chromium/chromium');
  });

  it('forbids automatic merges of Chromium updates', () => {
    const config = loadConfig();
    expect(config.updatePolicy.automaticMerge).toBe(false);
    expect(config.updatePolicy.allowMovingRefs).toBe(false);
  });

  it('records resource requirements for the heavy builder', () => {
    const config = loadConfig();
    expect(
      config.buildRequirements.referenceBuilder.freeDiskGb,
    ).toBeGreaterThanOrEqual(150);
    expect(
      config.buildRequirements.referenceBuilder.ramGb,
    ).toBeGreaterThanOrEqual(32);
  });

  it('keeps the codename flagged until the naming review completes', () => {
    const config = loadConfig();
    expect(config.product.nameIsCodenameOnly).toBe(true);
    expect(config.product.namingReview).toMatch(/NAMING\.md$/);
  });

  it('points at the repository root', () => {
    expect(REPO_ROOT).toBe(
      path.resolve(fileURLToPath(new URL('../..', import.meta.url))),
    );
  });

  it.each([
    ['moving ref', { chromium: { upstreamRef: 'main' } }, /moving ref/],
    [
      'short revision',
      { chromium: { revision: 'deadbeef' } },
      /40-character commit SHA/,
    ],
    [
      'patch set base mismatch',
      { patchSet: { baseRevision: '0'.repeat(40) } },
      /baseRevision must equal/,
    ],
    [
      'automatic merge',
      { updatePolicy: { automaticMerge: true } },
      /automaticMerge must be false/,
    ],
    [
      'unexpected upstream origin',
      { chromium: { upstreamRepository: 'https://evil.example/chromium.git' } },
      /expected upstream origin/,
    ],
  ])('rejects %s', (_label, patch, expected) => {
    const config = structuredClone(loadConfig());
    for (const [section, values] of Object.entries(patch)) {
      config[section] = { ...config[section], ...values };
    }
    const problems = findConfigProblems(config);
    expect(problems.join('\n')).toMatch(expected);
  });

  it('accepts an unresolved depot_tools revision but rejects an invalid one', () => {
    const config = structuredClone(loadConfig());
    expect(findConfigProblems(config)).toEqual([]);
    config.toolchain.depotTools.revision = 'not-a-sha';
    expect(findConfigProblems(config).join('\n')).toMatch(
      /depotTools\.revision/,
    );
  });

  it('rejects a non-object config', () => {
    expect(findConfigProblems(null)).toEqual(['config is not an object']);
  });

  it('rejects a schema version it does not understand', () => {
    const config = structuredClone(loadConfig());
    config.schemaVersion = 99;
    expect(findConfigProblems(config).join('\n')).toMatch(/schemaVersion/);
  });
});
