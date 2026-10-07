/**
 * Deployment of the canonical workflow definitions.
 *
 * The definitions live in `tools/ci/workflows/` because a credential without
 * the GitHub `workflows` permission cannot create or update
 * `.github/workflows/`. `install-workflows.mjs` deploys them, and these tests
 * pin its behaviour: never silently overwrite a divergent file, always report
 * what is missing, and be usable as a check in CI.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  CANONICAL_DIR,
  compareWorkflows,
  installWorkflows,
} from '../../tools/ci/install-workflows.mjs';

const WORKFLOW = 'sample.yml';

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'aurelia-workflows-'));
  const sourceDir = path.join(root, 'canonical');
  const destDir = path.join(root, 'installed');
  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(
    path.join(sourceDir, WORKFLOW),
    'name: sample\non: push\npermissions:\n  contents: read\njobs: {}\n',
  );
  return { root, sourceDir, destDir };
}

describe('workflow deployment', () => {
  it('ships canonical definitions in tools/ci/workflows', () => {
    const { workflows } = compareWorkflows({ sourceDir: CANONICAL_DIR });
    expect(workflows).toEqual([
      'chromium-heavy-build.yml',
      'chromium-update-watch.yml',
      'ci-fast.yml',
    ]);
  });

  it('reports a missing deployment without writing when checking', () => {
    const { sourceDir, destDir } = fixture();
    const result = installWorkflows({ sourceDir, destDir, check: true });
    expect(result.missing).toEqual([WORKFLOW]);
    expect(result.written).toEqual([]);
    expect(result.complete).toBe(false);
  });

  it('deploys missing definitions byte-for-byte', () => {
    const { sourceDir, destDir } = fixture();
    const result = installWorkflows({ sourceDir, destDir });
    expect(result.written).toEqual([WORKFLOW]);
    expect(result.complete).toBe(true);
    expect(readFileSync(path.join(destDir, WORKFLOW), 'utf8')).toBe(
      readFileSync(path.join(sourceDir, WORKFLOW), 'utf8'),
    );
    expect(installWorkflows({ sourceDir, destDir, check: true }).complete).toBe(
      true,
    );
  });

  it('never overwrites a divergent file without --force', () => {
    const { sourceDir, destDir } = fixture();
    mkdirSync(destDir, { recursive: true });
    writeFileSync(path.join(destDir, WORKFLOW), 'name: edited-on-github\n');
    const result = installWorkflows({ sourceDir, destDir });
    expect(result.different).toEqual([WORKFLOW]);
    expect(result.complete).toBe(false);
    expect(readFileSync(path.join(destDir, WORKFLOW), 'utf8')).toBe(
      'name: edited-on-github\n',
    );

    const forced = installWorkflows({ sourceDir, destDir, force: true });
    expect(forced.written).toEqual([WORKFLOW]);
    expect(forced.complete).toBe(true);
    expect(readFileSync(path.join(destDir, WORKFLOW), 'utf8')).toBe(
      readFileSync(path.join(sourceDir, WORKFLOW), 'utf8'),
    );
  });

  it('treats an absent canonical directory as an empty deployment', () => {
    const { destDir } = fixture();
    const result = compareWorkflows({
      sourceDir: path.join(destDir, 'does-not-exist'),
      destDir,
    });
    expect(result).toEqual({ workflows: [], missing: [], different: [] });
  });
});
