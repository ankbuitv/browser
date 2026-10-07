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
      'chromium-heavy-build-windows.yml',
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

describe('Windows heavy build pipeline', () => {
  const read = () =>
    readFileSync(
      path.join(CANONICAL_DIR, 'chromium-heavy-build-windows.yml'),
      'utf8',
    );

  it('runs only on a self-hosted Windows x64 builder', () => {
    const workflow = read();
    expect(workflow).toContain(
      'runs-on: [self-hosted, windows, x64, aurelia-chromium]',
    );
    // Hosted runners must not be attempted: the assessment says they are not
    // a suitable Chromium builder (docs/CI-BUILD-FEASIBILITY.md).
    expect(workflow).not.toContain('windows-latest');
    expect(workflow).not.toContain('ubuntu-latest');
  });

  it('keeps the owner-specified pipeline stages in order', () => {
    const workflow = read();
    const stages = [
      'actions/checkout@',
      'Set up Node.js',
      'sync.mjs --dest',
      'verify-patches --checkout',
      'install-overlay.mjs --checkout',
      'fork-delta --check',
      'gn-args.mjs',
      'gn gen out\\Release',
      'autoninja -C out\\Release chrome',
      'stage-runtime.mjs --out',
      'smoke-test.mjs --binary',
      'record-smoke-test',
      'CreateFromDirectory',
      'actions/upload-artifact@',
    ];
    let cursor = -1;
    for (const stage of stages) {
      // Search after the previous match so a stage mentioned in the header
      // comment cannot satisfy the check for the step itself.
      const index = workflow.indexOf(stage, cursor + 1);
      expect(index, `missing pipeline stage: ${stage}`).toBeGreaterThan(-1);
      expect(index, `stage out of order: ${stage}`).toBeGreaterThan(cursor);
      cursor = index;
    }
  });

  it('never weakens the browser to make CI pass', () => {
    const workflow = read();
    expect(workflow).not.toContain('--no-sandbox');
    expect(workflow).not.toContain('--allow-disabled-sandbox');
    expect(workflow).not.toContain('secrets.');
    expect(workflow).toContain('permissions:\n  contents: read');
  });
});
