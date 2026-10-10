import { describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { format } from 'prettier';

import {
  assertPinnedRevision,
  isGithubHostedRunner,
  MAX_BUILD_JOBS,
  MAX_BROWSER_ARTIFACT_BYTES,
  parseValidationOptions,
  RESOURCE_POLL_INTERVAL_MS,
  resourceLimitReason,
  runMonitoredCommand,
  RUNNER_SIZES,
  TARGETED_CPP_TARGETS,
  VALIDATION_LEVELS,
  WEBUI_RESOURCE_OUTPUTS,
  WEBUI_RESOURCE_TARGETS,
} from '../../tools/chromium/ci-validation.mjs';
import { loadConfig, REPO_ROOT } from '../../tools/chromium/lib/config.mjs';
import {
  diskFloorGb,
  gclientSyncArgs,
  parseJobs,
} from '../../tools/chromium/sync.mjs';

const WORKFLOW_PATH = '.github/workflows/chromium-build.yml';
const WORKFLOW = readFileSync(path.join(REPO_ROOT, WORKFLOW_PATH), 'utf8');
const DRIVER = readFileSync(
  path.join(REPO_ROOT, 'tools/chromium/ci-validation.mjs'),
  'utf8',
);
const CANONICAL_PATH = path.join(
  REPO_ROOT,
  'tools/ci/workflows/chromium-build.yml',
);

function tempDirectory() {
  return mkdtempSync(path.join(tmpdir(), 'aurelia-chromium-ci-'));
}

describe('hosted Chromium validation configuration', () => {
  it('accepts only the requested validation levels and runner sizes', () => {
    expect(VALIDATION_LEVELS).toEqual(['gn', 'targeted', 'full']);
    expect(RUNNER_SIZES).toEqual(['standard', 'larger']);
    expect(
      parseValidationOptions(
        [
          '--mode',
          'targeted',
          '--runner-size',
          'larger',
          '--dest',
          'checkout',
          '--artifacts',
          'artifacts',
        ],
        {},
      ),
    ).toMatchObject({ mode: 'targeted', runnerSize: 'larger' });
    expect(() =>
      parseValidationOptions(
        [
          '--mode',
          'everything',
          '--dest',
          'checkout',
          '--artifacts',
          'artifacts',
        ],
        {},
      ),
    ).toThrow('invalid validation level');
    expect(() =>
      parseValidationOptions(
        [
          '--mode',
          'gn',
          '--runner-size',
          'self-hosted',
          '--dest',
          'checkout',
          '--artifacts',
          'artifacts',
        ],
        {},
      ),
    ).toThrow('invalid runner size');
    expect(() => parseValidationOptions(['--mode', 'full'], {})).toThrow(
      '--dest <directory> is required',
    );
  });

  it('allows compilation only in a GitHub-hosted Actions runner environment', () => {
    expect(
      isGithubHostedRunner({
        GITHUB_ACTIONS: 'true',
        RUNNER_ENVIRONMENT: 'github-hosted',
      }),
    ).toBe(true);
    expect(
      isGithubHostedRunner({
        GITHUB_ACTIONS: 'true',
        RUNNER_ENVIRONMENT: 'self-hosted',
      }),
    ).toBe(false);
    expect(isGithubHostedRunner({})).toBe(false);
  });

  it('has only manual dispatch, selectable levels, and a GN default', () => {
    expect(WORKFLOW).toContain('workflow_dispatch:');
    expect(WORKFLOW).toMatch(/validation_level:\s*\n[\s\S]*?type:\s*choice/);
    expect(WORKFLOW).toMatch(/options:\s*\n\s+- gn\n\s+- targeted\n\s+- full/);
    expect(WORKFLOW).toMatch(/default:\s*gn/);
    expect(WORKFLOW).not.toMatch(/^\s+(push|pull_request|schedule):/m);
    expect(WORKFLOW).toContain('timeout-minutes: 360');
    expect(WORKFLOW).toContain('cancel-in-progress: false');
  });

  it('pins runner selection to GitHub-hosted Windows labels and read-only permissions', () => {
    expect(WORKFLOW).toContain(
      "runs-on: ${{ inputs.runner_size == 'larger' && 'windows-latest-8-cores' || 'windows-2025' }}",
    );
    expect(WORKFLOW).toContain('permissions:\n  contents: read');
    expect(WORKFLOW).not.toMatch(/runs-on:.*self-hosted/);
    expect(WORKFLOW).not.toMatch(/secrets\./);
    expect(WORKFLOW).toContain('persist-credentials: false');
    expect(WORKFLOW).toContain('$exitCode = $LASTEXITCODE');
    expect(WORKFLOW).toContain('exit $exitCode');
  });

  it('keeps the deployed workflow byte-identical to its canonical definition', () => {
    expect(readFileSync(CANONICAL_PATH, 'utf8')).toBe(WORKFLOW);
  });

  it('parses as YAML and includes an always-run logs and summary upload', async () => {
    await expect(format(WORKFLOW, { parser: 'yaml' })).resolves.toBeTypeOf(
      'string',
    );
    expect(WORKFLOW).toContain('if: always()');
    expect(WORKFLOW).toContain('path: artifacts/');
    expect(WORKFLOW).toContain('retention-days: 7');
    expect(WORKFLOW).toContain('actions/upload-artifact@');
  });

  it('gates explicit full compilation behind same-run GN and targeted validation', () => {
    const start = DRIVER.indexOf('const gnArgsFile');
    const end = DRIVER.indexOf("writeSummary(context, 'PASS')", start);
    const execution = DRIVER.slice(start, end);
    const markers = [
      "id: 'gn-argument-policy'",
      "id: 'gn-generation'",
      "id: 'gn-effective-arguments'",
      "setStage(context, 'target-labels', 'RUNNING'",
      "id: 'gn-check'",
      "id: 'webui-resources'",
      "if (mode === 'targeted' || mode === 'full')",
      "id: 'targeted-cpp'",
      "if (mode === 'full')",
      "id: 'full-chrome'",
    ];
    let cursor = -1;
    for (const marker of markers) {
      const index = execution.indexOf(marker, cursor + 1);
      expect(index, `validation order is missing ${marker}`).toBeGreaterThan(
        -1,
      );
      expect(index, `validation order is wrong for ${marker}`).toBeGreaterThan(
        cursor,
      );
      cursor = index;
    }
  });

  it('blocks local and self-hosted execution before pinned source sync', () => {
    const environmentGate = DRIVER.indexOf('if (!isGithubHostedRunner())');
    const syncStage = DRIVER.indexOf("id: 'pinned-sync'");
    expect(environmentGate).toBeGreaterThan(-1);
    expect(syncStage).toBeGreaterThan(environmentGate);
    expect(DRIVER).toContain('RUNNER_ENVIRONMENT');
  });

  it('invokes the existing Chromium preparation tools and writes no source artifact', () => {
    expect(WORKFLOW).toContain('tools/chromium/ci-validation.mjs');
    expect(DRIVER).toContain("'tools/chromium/sync.mjs'");
    expect(DRIVER).toContain("'tools/chromium/install-overlay.mjs'");
    expect(DRIVER).toContain("'tools/chromium/cli.mjs'");
    expect(DRIVER).toContain("'tools/chromium/gn-args.mjs'");
    expect(WORKFLOW).not.toContain('chromium/src/**');
    expect(WORKFLOW).not.toContain('upload full source');
    expect(WORKFLOW).toContain('path: artifacts/');
  });
});

describe('pinned Chromium target and resource validation', () => {
  it('uses the repository pin and refuses any different checkout SHA', () => {
    const config = loadConfig();
    expect(config.chromium.version).toBe('155.0.8059.40');
    expect(config.chromium.revision).toBe(
      'cfaadc5a132d78e1828635aa8405a499f3e14864',
    );
    expect(
      assertPinnedRevision(config.chromium.revision, config.chromium.revision),
    ).toBe(config.chromium.revision);
    expect(() =>
      assertPinnedRevision(config.chromium.revision, '0'.repeat(40)),
    ).toThrow('refusing to continue');
  });

  it('bounds sync concurrency and preserves the fixed 150 GB disk gate', () => {
    expect(MAX_BUILD_JOBS).toBe(4);
    expect(diskFloorGb()).toBe(150);
    expect(
      gclientSyncArgs({
        revision: 'cfaadc5a132d78e1828635aa8405a499f3e14864',
        jobs: 4,
      }),
    ).toEqual([
      'sync',
      '--jobs',
      '4',
      '--revision',
      'src@cfaadc5a132d78e1828635aa8405a499f3e14864',
    ]);
    expect(() => gclientSyncArgs({ revision: 'bad', jobs: 0 })).toThrow(
      '--jobs must be an integer',
    );
    expect(parseJobs('4')).toBe(4);
    expect(() => parseJobs('four')).toThrow('--jobs must be an integer');
    expect(() => parseJobs('0')).toThrow('--jobs must be an integer');
    expect(WEBUI_RESOURCE_TARGETS).toEqual([
      '//chrome/browser/resources/aurelia:build_ts',
      '//chrome/browser/resources/aurelia:build_grd',
      '//chrome/browser/resources/aurelia:resources',
      '//chrome/browser/resources/newtab:build_ts',
      '//chrome/browser/resources/newtab:build_grd',
      '//chrome/browser/resources/newtab:resources',
    ]);
    expect(TARGETED_CPP_TARGETS).toEqual([
      '//chrome/browser/ui/webui/aurelia:aurelia',
      '//chrome/browser/ui/webui/newtab:newtab',
    ]);
    expect(WEBUI_RESOURCE_OUTPUTS).toContain(
      'gen/chrome/aurelia_resources.pak',
    );
    expect(WEBUI_RESOURCE_OUTPUTS).toContain(
      'gen/chrome/aurelia_newtab_resources.pak',
    );
  });

  it('stops and reports measured disk or memory exhaustion', () => {
    expect(
      resourceLimitReason({ freeDiskGb: 14, availableMemoryGb: 8 }),
    ).toContain('free disk');
    expect(
      resourceLimitReason({ freeDiskGb: 100, availableMemoryGb: 1 }),
    ).toContain('available memory');
    expect(
      resourceLimitReason({ freeDiskGb: 100, availableMemoryGb: 8 }),
    ).toBeNull();
    expect(
      resourceLimitReason({ freeDiskGb: null, availableMemoryGb: 8 }),
    ).toContain('free disk could not be measured');
    expect(
      resourceLimitReason({ freeDiskGb: 100, availableMemoryGb: null }),
    ).toContain('available memory could not be measured');
    expect(RESOURCE_POLL_INTERVAL_MS).toBe(30_000);
    expect(MAX_BROWSER_ARTIFACT_BYTES).toBe(450 * 1024 ** 2);
  });

  it('propagates a compiler or GN process failure instead of downgrading it to a warning', async () => {
    const root = tempDirectory();
    const logs = path.join(root, 'logs');
    mkdirSync(logs);
    const usagePath = path.join(root, 'resource-usage.jsonl');
    writeFileSync(usagePath, '');
    try {
      await expect(
        runMonitoredCommand({
          file: process.execPath,
          args: ['-e', 'process.exit(17)'],
          cwd: root,
          env: process.env,
          stage: 'test-failure-propagation',
          dest: root,
          logPath: path.join(logs, 'child.log'),
          usagePath,
          deadlineAt: Date.now() + 10_000,
          pollIntervalMs: 5,
          minimumFreeDiskGb: 0,
          minimumAvailableMemoryGb: 0,
          quiet: true,
        }),
      ).rejects.toMatchObject({
        status: 'FAIL',
        message: expect.stringContaining('exited with code 17'),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
