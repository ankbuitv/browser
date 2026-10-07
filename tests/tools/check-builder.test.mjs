import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  candidateDestinations,
  checkBuilder,
  freeDiskGb,
} from '../../tools/ci/check-builder.mjs';

describe('builder preflight', () => {
  it('reports a verdict with capabilities and no side effects', () => {
    const result = checkBuilder({ dest: tempDest() });
    expect(typeof result.ok).toBe('boolean');
    expect(Array.isArray(result.problems)).toBe(true);
    expect(result.capabilities.cpuCores).toBeGreaterThan(0);
    expect(result.capabilities.node).toMatch(/^v\d+/);
    expect(result.requirements.cpuCores).toBeGreaterThanOrEqual(8);
    expect(result.requirements.ramGb).toBeGreaterThanOrEqual(32);
    expect(result.requirements.freeDiskGb).toBeGreaterThanOrEqual(150);
  });

  it('refuses machines below the documented minimums instead of guessing', () => {
    // This sandbox is deliberately far below the minimum: 2 cores, ~4 GB RAM,
    // ~19 GB free. The check must say so.
    const result = checkBuilder({ dest: tempDest() });
    expect(result.ok).toBe(false);
    const joined = result.problems.join('; ');
    expect(joined).toMatch(/logical cores/);
    expect(joined).toMatch(/RAM/);
    expect(joined).toMatch(/free disk/);
  });

  it('honours requirement overrides from the pin configuration', () => {
    const result = checkBuilder({
      dest: tempDest(),
      config: {
        buildRequirements: {
          referenceBuilder: { cpuCores: 1, ramGb: 1, freeDiskGb: 1 },
        },
      },
    });
    expect(result.requirements).toEqual({
      cpuCores: 1,
      ramGb: 1,
      freeDiskGb: 1,
    });
    expect(result.problems.join('; ')).not.toMatch(/logical cores/);
  });

  it('measures free disk on real paths and returns null when it cannot', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'aurelia-builder-'));
    expect(freeDiskGb(dir)).toBeGreaterThan(0);
    expect(freeDiskGb(path.join(dir, 'does', 'not', 'exist'))).toBeNull();
  });

  it('only proposes directories that exist, without duplicates', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'aurelia-builder-'));
    const candidates = candidateDestinations(dir);
    expect(candidates).toContain(dir);
    expect(new Set(candidates).size).toBe(candidates.length);
  });
});

/**
 * A path that does not exist yet: the check runs before provisioning, so it
 * must accept a destination directory that is about to be created.
 */
function tempDest() {
  return path.join(
    mkdtempSync(path.join(tmpdir(), 'aurelia-dest-')),
    'chromium',
  );
}
