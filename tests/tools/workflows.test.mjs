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
import {
  analyseWorkflow,
  checkWorkflows,
} from '../../tools/ci/workflow-policy.mjs';

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
      'chromium-build.yml',
      'chromium-heavy-build-windows.yml',
      'chromium-hosted-windows-experiment.yml',
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

describe('retired self-hosted heavy build workflow', () => {
  const read = () =>
    readFileSync(
      path.join(CANONICAL_DIR, 'chromium-heavy-build-windows.yml'),
      'utf8',
    );

  it('is a manual notice with no self-hosted runner or scheduled work', () => {
    const workflow = read();
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('runs-on: windows-2025');
    expect(workflow).not.toContain('self-hosted');
    expect(workflow).not.toContain('schedule:');
    expect(workflow).toContain('chromium-build.yml');
  });

  it('does not check out Chromium or invoke a compiler', () => {
    const workflow = read();
    expect(workflow).not.toContain('actions/checkout');
    expect(workflow).not.toContain('sync.mjs');
    expect(workflow).not.toContain('autoninja');
    expect(workflow).not.toContain('stage-runtime.mjs');
    expect(workflow).toContain('does not sync or compile Chromium');
  });
});

describe('workflow policy', () => {
  const bad = [
    'on: push',
    'permissions:',
    '  contents: read',
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-latest',
    '    env:',
    '      DEST: ${{ runner.temp }}/build',
    '    steps:',
    '      - run: true',
    '',
  ].join('\n');

  const good = [
    'on: push',
    'permissions:',
    '  contents: read',
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: true',
    '        env:',
    '          DEST: ${{ runner.temp }}/build',
    '',
  ].join('\n');

  it('rejects the runner context in a job-level env block', () => {
    // GitHub failed the first hosted experiment with exactly this mistake:
    // "Unrecognized named-value: 'runner'".
    expect(analyseWorkflow(bad).runnerInJobEnv).toBe(true);
  });

  it('accepts the runner context in a step-level env block', () => {
    expect(analyseWorkflow(good).runnerInJobEnv).toBe(false);
  });

  it('reports the mistake before it can reach a push', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'aurelia-policy-'));
    writeFileSync(path.join(root, 'invalid.yml'), bad);
    const { problems } = checkWorkflows([root]);
    expect(problems.join('\n')).toContain('job-level env');
  });
});

describe('retired hosted Windows experiment', () => {
  const read = () =>
    readFileSync(
      path.join(CANONICAL_DIR, 'chromium-hosted-windows-experiment.yml'),
      'utf8',
    );

  it('remains manual-only and directs maintainers to the unified workflow', () => {
    const workflow = read();
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('chromium-build.yml');
    expect(workflow).toContain('runs-on: windows-2025');
    expect(workflow).not.toContain('self-hosted');
    expect(workflow).not.toContain('schedule:');
  });

  it('cannot check out Chromium, sync sources, compile, or upload artifacts', () => {
    const workflow = read();
    expect(workflow).not.toContain('actions/checkout');
    expect(workflow).not.toContain('sync.mjs');
    expect(workflow).not.toContain('autoninja');
    expect(workflow).not.toContain('actions/upload-artifact');
    expect(workflow).toContain('does not sync or compile Chromium');
  });
});

describe('fast CI API token scope', () => {
  it('authenticates every online check with a read-only step-scoped Actions token', () => {
    const workflow = readFileSync(
      path.join(CANONICAL_DIR, 'ci-fast.yml'),
      'utf8',
    );
    expect(workflow).toContain('permissions:\n  contents: read');
    for (const step of workflow
      .split('      - name: ')
      .filter((step) =>
        /run:.*(?:verify-pin\.mjs|verify-patches --online|check-updates)/.test(
          step,
        ),
      )) {
      expect(step).toContain('GH_TOKEN: ${{ github.token }}');
      expect(step).not.toMatch(/continue-on-error|\|\|\s*true/);
    }
  });
});
