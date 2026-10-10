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

describe('hosted Windows experiment', () => {
  const read = () =>
    readFileSync(
      path.join(CANONICAL_DIR, 'chromium-hosted-windows-experiment.yml'),
      'utf8',
    );

  it('is a manual, hosted-only experiment that never replaces the heavy build', () => {
    const workflow = read();
    expect(workflow).toContain('workflow_dispatch:');
    // Hosted, and only hosted: this is the experiment, not the product path.
    expect(workflow).toContain('runs-on: windows-latest');
    // The header may *refer* to the self-hosted production path, but no job
    // here may actually run on it.
    expect(workflow).not.toMatch(/runs-on:.*self-hosted/);
    // No schedule: it must not consume quota on its own.
    expect(workflow).not.toContain('schedule:');
  });

  it('measures before it syncs, and stops before syncing when too small', () => {
    const workflow = read();
    const measure = workflow.indexOf('hosted-preflight.json');
    const gate = workflow.indexOf('check-builder.mjs');
    const sync = workflow.indexOf('sync.mjs --dest');
    expect(measure).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(measure);
    expect(sync).toBeGreaterThan(gate);
    // The gate must be able to stop the job before the sync step.
    expect(workflow).toContain('RESOURCE LIMIT');
    expect(workflow).toContain("steps.gate.outputs.sufficient == 'false'");
  });

  it('does not lower the documented minimums to force a run', () => {
    const workflow = read();
    // The decision comes from the repository's own check, which uses the
    // requirements recorded in config/chromium_version.json.
    expect(workflow).toContain('node tools/ci/check-builder.mjs');
    expect(workflow).not.toMatch(/cpuCores\s*=\s*[1-7]\b/);
    expect(workflow).not.toMatch(/ramGb\s*=\s*(1?[0-9]|2[0-9])\b/);
    expect(workflow).not.toMatch(/freeDiskGb\s*=\s*(1[0-4][0-9]|[1-9][0-9])\b/);
  });

  it('keeps the build stages in the owner-specified order', () => {
    const workflow = read();
    const stages = [
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
      const index = workflow.indexOf(stage, cursor + 1);
      expect(index, `missing experiment stage: ${stage}`).toBeGreaterThan(-1);
      expect(index, `stage out of order: ${stage}`).toBeGreaterThan(cursor);
      cursor = index;
    }
  });

  it('resolves the dispatch inputs once, into environment variables', () => {
    const workflow = read();
    // The mode must be resolved through env so every `if:` checks the same
    // value, and so the workflow still behaves if started by a non-dispatch
    // event (the `inputs` context is only populated for workflow_dispatch).
    expect(workflow).toContain(
      "EXPERIMENT_MODE: ${{ github.event.inputs.mode || 'preflight-only' }}",
    );
    expect(workflow).not.toContain('inputs.mode ==');
    expect(workflow).toContain('env.EXPERIMENT_MODE ==');
  });

  it('survives native stderr from node, gn and ninja', () => {
    const workflow = read();
    // The first hosted run failed inside a step whose tool exited 0: with
    // $ErrorActionPreference='Stop' PowerShell turns the first line a native
    // command writes to stderr into a terminating error. Every step that runs
    // a native tool must neutralise that and check the exit code itself.
    const lines = workflow.split('\n');
    const starts = lines
      .map((line, index) => (line.startsWith('      - name: ') ? index : -1))
      .filter((index) => index !== -1);
    starts.push(lines.length);
    const native = /(?:node tools\/|& node |& gn |autoninja -C)/;
    for (let index = 0; index < starts.length - 1; index += 1) {
      const block = lines.slice(starts[index], starts[index + 1]).join('\n');
      if (!native.test(block)) continue;
      const name = lines[starts[index]].slice('      - name: '.length);
      expect(block, `${name}: native stderr would fail the step`).toContain(
        '$PSNativeCommandUseErrorActionPreference = $false',
      );
      // The measurement step probes optional tools (python, VS, SDKs) and
      // records absences in the report instead of failing, so only the switch
      // applies there; every step that performs real work checks its exit code.
      if (name !== 'Measure the runner') {
        expect(block, `${name}: no explicit exit-code check`).toContain(
          '$LASTEXITCODE',
        );
      }
    }
  });

  it('never weakens the browser, needs no secret, and always keeps the evidence', () => {
    const workflow = read();
    expect(workflow).not.toContain('--no-sandbox');
    expect(workflow).not.toContain('--allow-disabled-sandbox');
    expect(workflow).not.toContain('continue-on-error');
    expect(workflow).not.toContain('secrets.');
    expect(workflow).toContain('permissions:\n  contents: read');
    // Reports must survive a failed run.
    expect(workflow).toContain('if: always()');
    expect(workflow).toContain('hosted-preflight.json');
    expect(workflow).toContain('runner-capabilities.json');
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
