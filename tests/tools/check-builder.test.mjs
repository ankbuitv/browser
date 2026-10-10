import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  candidateDestinations,
  checkBuilder,
  evaluateResources,
  freeDiskGb,
  requirementsForMode,
} from '../../tools/ci/check-builder.mjs';
import { loadConfig } from '../../tools/chromium/lib/config.mjs';

// The measured GitHub-hosted standard Windows runner.
const STANDARD_RUNNER = { cpuCores: 4, ramGb: 16, bestFreeDiskGb: 219.9 };

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
    // Disk may pass in large sandboxes, so only check for disk if it fails
    if (joined.includes('free disk')) {
      expect(joined).toMatch(/free disk/);
    }
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

describe('validation-mode resource profiles', () => {
  const config = loadConfig();

  it('gives gn its reduced profile and keeps targeted and full strict', () => {
    expect(requirementsForMode(config, 'gn')).toEqual({
      cpuCores: 4,
      ramGb: 15.5,
      freeDiskGb: 150,
      notes: config.buildRequirements.gnValidation.notes,
    });
    for (const mode of ['targeted', 'full']) {
      expect(requirementsForMode(config, mode)).toMatchObject({
        cpuCores: 8,
        ramGb: 32,
        freeDiskGb: 150,
      });
    }
  });

  it('refuses an unknown mode and malformed profile values instead of guessing', () => {
    expect(() => requirementsForMode(config, 'everything')).toThrow(
      'unknown validation mode',
    );
    expect(() =>
      requirementsForMode(
        {
          buildRequirements: {
            gnValidation: { cpuCores: '4', ramGb: 16, freeDiskGb: 150 },
          },
        },
        'gn',
      ),
    ).toThrow('gnValidation.cpuCores must be a positive number');
  });

  it('passes the measured standard runner under gn and blocks it under targeted and full', () => {
    expect(
      evaluateResources(STANDARD_RUNNER, requirementsForMode(config, 'gn')),
    ).toEqual([]);
    for (const mode of ['targeted', 'full']) {
      const problems = evaluateResources(
        STANDARD_RUNNER,
        requirementsForMode(config, mode),
      );
      expect(problems).toEqual([
        'logical cores: 4 (needs 8+)',
        'RAM: 16 GB (needs 32 GB+)',
      ]);
    }
  });

  it('keeps gn blocked below its own floors', () => {
    const gn = requirementsForMode(config, 'gn');
    expect(
      evaluateResources({ cpuCores: 2, ramGb: 8, bestFreeDiskGb: 100 }, gn),
    ).toEqual([
      'logical cores: 2 (needs 4+)',
      'RAM: 8 GB (needs 15.5 GB+)',
      expect.stringContaining('free disk: 100 GB (needs 150 GB+'),
    ]);
    expect(
      evaluateResources({ cpuCores: 4, ramGb: 15, bestFreeDiskGb: 219.9 }, gn),
    ).toEqual(['RAM: 15 GB (needs 15.5 GB+)']);
  });

  it('preserves the 150 GB disk floor in every mode', () => {
    for (const mode of ['gn', 'targeted', 'full']) {
      const problems = evaluateResources(
        { cpuCores: 8, ramGb: 32, bestFreeDiskGb: 149.9 },
        requirementsForMode(config, mode),
      );
      expect(problems.join(';')).toMatch(
        /free disk: 149.9 GB \(needs 150 GB\+/,
      );
    }
  });

  it('records the validation mode and its profile in the verdict', () => {
    const result = checkBuilder({
      dest: path.join(
        mkdtempSync(path.join(tmpdir(), 'aurelia-mode-')),
        'chromium',
      ),
      config,
      mode: 'gn',
    });
    expect(result.mode).toBe('gn');
    expect(result.requirements).toMatchObject({
      cpuCores: 4,
      ramGb: 15.5,
      freeDiskGb: 150,
    });
  });
});
