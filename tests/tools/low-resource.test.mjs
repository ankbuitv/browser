/**
 * LOW_RESOURCE_EXPERIMENT policy.
 *
 * The documented builder minimum (8 cores / 32 GB / 150 GB) is never lowered.
 * These tests pin the *second*, experimental floor that the bootstrap script
 * uses: RAM and CPU shortfalls become warnings when the operator opts in, disk
 * space stays a hard requirement with a reserve that the build is stopped
 * before it can consume, and the job count always comes from the measured
 * machine.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ABSOLUTE_RAM_FLOOR_GB,
  EXPERIMENT_DISK,
  LOW_RESOURCE_MODE,
  MINIMUM_NODE_MAJOR,
  REFERENCE_BUILDER,
  evaluateEnvironment,
  formatReport,
  planJobs,
} from '../../tools/chromium/low-resource.mjs';
import { REPO_ROOT } from '../../tools/chromium/build.mjs';

const TOOL = path.join(REPO_ROOT, 'tools', 'chromium', 'low-resource.mjs');

/** A machine that meets the documented builder minimum. */
function referenceMachine(overrides = {}) {
  return {
    dest: 'D:\\aeb',
    windows: {
      caption: 'Microsoft Windows 11 Pro',
      buildNumber: 22631,
      architecture: '64-bit',
    },
    cpu: { model: 'Reference CPU', physicalCores: 8, logicalCores: 16 },
    memory: { totalGb: 32, availableGb: 20 },
    disk: {
      target: 'D:\\aeb',
      volume: 'D:\\',
      filesystem: 'NTFS',
      freeGb: 200,
      sizeGb: 1000,
    },
    tooling: {
      visualStudio: 'Visual Studio 2022 17.14 (C++ x64 toolchain present)',
      msvcToolsets: ['14.44.35207'],
      windowsSdks: ['10.0.26100.0'],
      node: 'v22.20.0',
      git: 'git version 2.47.0.windows.1',
      python: null,
      longPathsEnabled: true,
      depotTools: null,
    },
    pagefile: {
      configured: true,
      automaticManaged: true,
      files: ['C:\\pagefile.sys'],
      allocatedGb: 32,
      usageMb: 100,
    },
    ...overrides,
  };
}

/** The owner's first attempt: i3-4130, 8 GB RAM, ~110 GB free. */
function lowResourceMachine() {
  return referenceMachine({
    cpu: {
      model: 'Intel(R) Core(TM) i3-4130 CPU @ 3.40GHz',
      physicalCores: 2,
      logicalCores: 4,
    },
    memory: { totalGb: 8, availableGb: 4.2 },
    disk: {
      target: 'D:\\aeb',
      volume: 'D:\\',
      filesystem: 'NTFS',
      freeGb: 110,
      sizeGb: 465,
    },
    pagefile: {
      configured: true,
      automaticManaged: true,
      files: ['C:\\pagefile.sys'],
      allocatedGb: 4,
      usageMb: 800,
    },
  });
}

describe('compile job plan', () => {
  it('never exceeds four jobs and scales with measured RAM', () => {
    expect(planJobs({ cpuCores: 32, ramGb: 64 }).jobs).toBe(4);
    expect(planJobs({ cpuCores: 32, ramGb: 20 }).jobs).toBe(3);
    expect(planJobs({ cpuCores: 32, ramGb: 24 }).jobs).toBe(4);
    expect(planJobs({ cpuCores: 32, ramGb: 16 }).jobs).toBe(3);
    expect(planJobs({ cpuCores: 32, ramGb: 15 }).jobs).toBe(2);
    expect(planJobs({ cpuCores: 32, ramGb: 8 }).jobs).toBe(2);
    expect(planJobs({ cpuCores: 32, ramGb: 6 }).jobs).toBe(1);
  });

  it('refuses to plan jobs below the absolute RAM floor', () => {
    expect(planJobs({ cpuCores: 8, ramGb: 4 }).jobs).toBe(0);
    expect(planJobs({ cpuCores: 8, ramGb: 0 }).jobs).toBe(0);
  });

  it('caps jobs at half the logical cores', () => {
    const plan = planJobs({ cpuCores: 4, ramGb: 32 });
    expect(plan.jobs).toBe(2);
    expect(plan.reason).toContain('capped');
  });
});

describe('environment verdict', () => {
  it('accepts a machine that meets the documented builder minimum', () => {
    const verdict = evaluateEnvironment(referenceMachine());
    expect(verdict.ok).toBe(true);
    expect(verdict.mode).toBe('reference-builder');
    expect(verdict.problems).toEqual([]);
  });

  it('refuses a below-reference machine without the experiment switch', () => {
    const verdict = evaluateEnvironment(lowResourceMachine());
    expect(verdict.ok).toBe(false);
    expect(verdict.mode).toBe('reference-builder');
    expect(verdict.problems.join(' ')).toContain('RAM');
    expect(verdict.problems.join(' ')).toContain('logical core');
    expect(verdict.problems.join(' ')).toContain('150 GB');
    expect(verdict.problems.join(' ')).toContain('-LowResourceExperiment');
  });

  it('continues on the same machine with the experiment switch', () => {
    const verdict = evaluateEnvironment(lowResourceMachine(), {
      experimentMode: true,
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.mode).toBe(LOW_RESOURCE_MODE);
    expect(verdict.problems).toEqual([]);
    expect(verdict.warnings.join(' ')).toContain('logical core');
    expect(verdict.warnings.join(' ')).toContain('8 GB RAM');
    expect(verdict.jobs).toBe(2);
  });

  it('keeps disk space hard even in the experiment', () => {
    const tight = lowResourceMachine();
    tight.disk = { ...tight.disk, freeGb: 90 };
    const verdict = evaluateEnvironment(tight, { experimentMode: true });
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(' ')).toContain(
      String(EXPERIMENT_DISK.hardMinimumFreeGb),
    );
    expect(verdict.problems.join(' ')).toContain('reserve');
  });

  it('warns, but proceeds, between the floor and the recommended free space', () => {
    const tight = lowResourceMachine();
    tight.disk = { ...tight.disk, freeGb: 110 };
    const verdict = evaluateEnvironment(tight, { experimentMode: true });
    expect(verdict.ok).toBe(true);
    expect(verdict.warnings.join(' ')).toContain(
      String(EXPERIMENT_DISK.recommendedFreeGb),
    );
  });

  it('never lowers the documented minimum itself', () => {
    expect(REFERENCE_BUILDER.cpuCores).toBe(8);
    expect(REFERENCE_BUILDER.ramGb).toBe(32);
    expect(REFERENCE_BUILDER.freeDiskGb).toBe(150);
    expect(EXPERIMENT_DISK.hardMinimumFreeGb).toBeLessThan(
      REFERENCE_BUILDER.freeDiskGb,
    );
    expect(
      EXPERIMENT_DISK.estimatedFootprintGb + EXPERIMENT_DISK.safetyReserveGb,
    ).toBeLessThanOrEqual(EXPERIMENT_DISK.hardMinimumFreeGb);
  });

  it('refuses unsupported Windows, architectures and filesystems in both modes', () => {
    const old = referenceMachine();
    old.windows = { ...old.windows, buildNumber: 9600 };
    expect(evaluateEnvironment(old, { experimentMode: true }).ok).toBe(false);
    expect(
      evaluateEnvironment(old, { experimentMode: true }).problems.join(' '),
    ).toContain('Windows 10');

    const arm = referenceMachine();
    arm.windows = { ...arm.windows, architecture: '32-bit' };
    expect(evaluateEnvironment(arm).problems.join(' ')).toContain('64-bit');

    const exfat = referenceMachine();
    exfat.disk = { ...exfat.disk, filesystem: 'exFAT' };
    const verdict = evaluateEnvironment(exfat, { experimentMode: true });
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(' ')).toContain('NTFS');
  });

  it('requires the C++ toolchain, a Windows SDK, git and a recent Node', () => {
    const missing = referenceMachine();
    missing.tooling = {
      ...missing.tooling,
      visualStudio: null,
      windowsSdks: [],
      git: null,
      node: null,
    };
    const verdict = evaluateEnvironment(missing, { experimentMode: true });
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(' ')).toContain('C++');
    expect(verdict.problems.join(' ')).toContain('SDK');
    expect(verdict.problems.join(' ')).toContain('git');
    expect(verdict.problems.join(' ')).toContain('Node.js');

    const oldNode = referenceMachine();
    oldNode.tooling = {
      ...oldNode.tooling,
      node: `v${MINIMUM_NODE_MAJOR - 1}.0.0`,
    };
    expect(evaluateEnvironment(oldNode).problems.join(' ')).toContain(
      `older than ${MINIMUM_NODE_MAJOR}`,
    );
  });

  it('treats RAM below the absolute floor as a refusal even in the experiment', () => {
    const tiny = referenceMachine();
    tiny.memory = { totalGb: ABSOLUTE_RAM_FLOOR_GB - 2, availableGb: 2 };
    const verdict = evaluateEnvironment(tiny, { experimentMode: true });
    expect(verdict.ok).toBe(false);
    expect(verdict.jobs).toBe(0);
  });

  it('reports the pagefile and long paths without ever changing them', () => {
    const noPagefile = lowResourceMachine();
    noPagefile.pagefile = {
      configured: false,
      automaticManaged: false,
      files: [],
      allocatedGb: 0,
      usageMb: 0,
    };
    noPagefile.tooling = { ...noPagefile.tooling, longPathsEnabled: false };
    const verdict = evaluateEnvironment(noPagefile, { experimentMode: true });
    expect(verdict.ok).toBe(true);
    expect(verdict.warnings.join(' ')).toContain('pagefile');
    expect(verdict.warnings.join(' ')).toContain('LongPathsEnabled');
    const report = formatReport(noPagefile, verdict);
    expect(report).toContain('never modified');
    expect(report).toContain('LongPathsEnabled');
  });
});

describe('report', () => {
  it('prints the experiment disk reserve in experiment mode', () => {
    const machine = lowResourceMachine();
    const verdict = evaluateEnvironment(machine, { experimentMode: true });
    const report = formatReport(machine, verdict);
    expect(report).toContain(`${EXPERIMENT_DISK.hardMinimumFreeGb} GB free`);
    expect(report).toContain('reserve never filled');
    expect(report).toContain('VERDICT: may proceed');
    expect(report).toContain('2 physical / 4 logical');
    expect(report).toContain(`autoninja -j ${verdict.jobs}`);
  });

  it('prints the documented minimum in reference mode', () => {
    const machine = lowResourceMachine();
    const verdict = evaluateEnvironment(machine);
    const report = formatReport(machine, verdict);
    expect(report).toContain('documented builder minimum');
    expect(report).toContain('VERDICT: refused');
  });
});

describe('command line', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'aurelia-low-resource-'));
  const referenceFile = path.join(directory, 'reference.json');
  const lowResourceFile = path.join(directory, 'low-resource.json');
  writeFileSync(referenceFile, JSON.stringify(referenceMachine()));
  writeFileSync(lowResourceFile, JSON.stringify(lowResourceMachine()));

  const run = (arguments_) =>
    spawnSync(process.execPath, [TOOL, ...arguments_], { encoding: 'utf8' });

  it('exits 0 for a reference machine and prints JSON on request', () => {
    const result = run(['--environment', referenceFile, '--json']);
    expect(result.status).toBe(0);
    const verdict = JSON.parse(result.stdout);
    expect(verdict.ok).toBe(true);
    expect(verdict.jobs).toBeGreaterThan(0);
  });

  it('exits 1 for a below-reference machine without the switch', () => {
    const result = run(['--environment', lowResourceFile]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('-LowResourceExperiment');
  });

  it('exits 0 for the same machine with the switch', () => {
    const result = run([
      '--environment',
      lowResourceFile,
      '--low-resource-experiment',
      '--json',
    ]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).mode).toBe(LOW_RESOURCE_MODE);
  });

  it('exits 2 when the environment file is missing', () => {
    const result = run(['--environment', path.join(directory, 'nope.json')]);
    expect(result.status).toBe(2);
  });
});

describe('the Windows SDK requirement when Chromium downloads its own', () => {
  // Chromium does not need a preinstalled SDK: with DEPOT_TOOLS_WIN_TOOLCHAIN
  // left at its default of 1, build/vs_toolchain.py downloads the pinned
  // toolchain and SDK (10.0.28000.0) into depot_tools/win_toolchain/vs_files.
  // GitHub's Windows image ships 10.0.26100.0, which is *older* than the pin,
  // so the download happens there either way.

  function withoutSdk() {
    const machine = referenceMachine();
    machine.tooling = { ...machine.tooling, windowsSdks: [] };
    return machine;
  }

  it('is a hard requirement by default', () => {
    const verdict = evaluateEnvironment(withoutSdk(), { experimentMode: true });
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(' ')).toContain('SDK');
    expect(verdict.warnings.join(' ')).not.toContain('SDK');
  });

  it('becomes a recorded warning with --allow-missing-sdk', () => {
    const verdict = evaluateEnvironment(withoutSdk(), {
      experimentMode: true,
      allowMissingSdk: true,
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.problems).toHaveLength(0);
    expect(verdict.warnings.join(' ')).toContain('SDK');
    // The reason travels with the verdict, so a report can never claim the
    // machine was simply good enough.
    expect(verdict.warnings.join(' ')).toContain('10.0.28000.0');
  });

  it('does not excuse anything else', () => {
    const broken = withoutSdk();
    broken.tooling = { ...broken.tooling, visualStudio: null, git: null };
    const verdict = evaluateEnvironment(broken, {
      experimentMode: true,
      allowMissingSdk: true,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(' ')).toContain('C++');
    expect(verdict.problems.join(' ')).toContain('git');
  });

  it('is opt-in on the command line only', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'aurelia-sdk-'));
    const file = path.join(dir, 'environment.json');
    writeFileSync(file, JSON.stringify(withoutSdk()));
    const run = (args) =>
      spawnSync(process.execPath, [TOOL, '--environment', file, ...args], {
        encoding: 'utf8',
      });

    expect(run(['--low-resource-experiment']).status).toBe(1);
    const allowed = run(['--low-resource-experiment', '--allow-missing-sdk']);
    expect(allowed.status).toBe(0);
    expect(allowed.stdout).toContain('SDK');
  });
});
