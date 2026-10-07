import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  BUILD_STAGES,
  LADDER,
  REPO_ROOT,
  buildPlan,
} from '../../tools/chromium/build.mjs';

describe('local build driver', () => {
  const plan = buildPlan({ dest: 'D:/chromium' });

  it('runs the pipeline in the order that earns the ladder states', () => {
    expect(plan.map((stage) => stage.id)).toEqual([
      'preflight',
      'sync',
      'verify-patches',
      'install-overlay',
      'fork-delta',
      'gn-args',
      'gn-gen',
      'compile',
      'stage',
      'smoke-test',
      'record',
    ]);
  });

  it('verifies the patch set before writing anything into the checkout', () => {
    const verify = plan.findIndex((stage) => stage.id === 'verify-patches');
    const install = plan.findIndex((stage) => stage.id === 'install-overlay');
    expect(verify).toBeLessThan(install);
  });

  it('never weakens the browser to make a build pass', () => {
    const allArgs = plan
      .flatMap((stage) => stage.commands)
      .flatMap((command) => command.args)
      .join(' ');
    expect(allArgs).not.toContain('--no-sandbox');
    expect(allArgs).not.toContain('--allow-disabled-sandbox');
    expect(allArgs).not.toContain('disable_site_isolation');
    expect(allArgs).not.toContain('disable_web_security');
  });

  it('stages and smoke tests the packaged directory, not the raw build output', () => {
    const smoke = plan
      .find((stage) => stage.id === 'smoke-test')
      .commands.flatMap((command) => command.args)
      .join(' ');
    expect(smoke).toContain('artifacts');
    expect(smoke).toContain('staged');
    // The record step must read the same report the smoke test wrote.
    const record = plan
      .find((stage) => stage.id === 'record')
      .commands.flatMap((command) => command.args)
      .join(' ');
    const reportFile = smoke.split('--report ')[1];
    expect(record).toContain(reportFile);
  });

  it('records the effective arguments from the build, not the reviewed file', () => {
    const stage = plan
      .find((s) => s.id === 'stage')
      .commands.flatMap((command) => command.args)
      .join(' ');
    expect(stage).toContain(path.join('out', 'Release', 'args.gn'));
  });

  it('skips only the sync stage with --skip-sync', () => {
    const skipped = buildPlan({ dest: 'D:/chromium', skipSync: true });
    expect(skipped.map((stage) => stage.id)).not.toContain('sync');
    expect(skipped.map((stage) => stage.id)).toContain('verify-patches');
  });

  it('keeps its stage list in step with the CI workflow', () => {
    const workflow = readFileSync(
      path.join(
        REPO_ROOT,
        'tools/ci/workflows/chromium-heavy-build-windows.yml',
      ),
      'utf8',
    );
    const markers = [
      'sync.mjs --dest',
      'verify-patches --checkout',
      'install-overlay.mjs --checkout',
      'fork-delta --check',
      'gn-args.mjs',
      'gn gen',
      'autoninja -C',
      'stage-runtime.mjs --out',
      'smoke-test.mjs --binary',
      'record-smoke-test',
    ];
    let cursor = -1;
    for (const marker of markers) {
      const index = workflow.indexOf(marker, cursor + 1);
      expect(index, `workflow is missing stage: ${marker}`).toBeGreaterThan(-1);
      expect(index, `workflow stage out of order: ${marker}`).toBeGreaterThan(
        cursor,
      );
      cursor = index;
    }
    expect(BUILD_STAGES.length).toBeGreaterThanOrEqual(markers.length);
  });

  it('states the ladder without collapsing any step', () => {
    expect(LADDER.map(([, state]) => state)).toEqual([
      'INTEGRATION SOURCE VERIFIED',
      'CONFIGURATION VERIFIED',
      'COMPILED',
      'RUNTIME INTEGRATED',
      'TESTED',
      'VERIFIED (run by a human)',
    ]);
  });
});
