#!/usr/bin/env node
/**
 * LOW_RESOURCE_EXPERIMENT: the policy for attempting the first Aurelia
 * Chromium build on a machine that is *below* the documented builder minimum.
 *
 * The documented minimum is 8+ logical cores, 32 GB RAM and 150 GB free on one
 * NTFS volume (docs/BUILDING-CHROMIUM.md, config/chromium_version.json). It is
 * not lowered by this file: this is a second, explicitly experimental floor for
 * one purpose - getting a real browser out of a machine the owner actually has
 * (an Intel i3-4130 class CPU with 8 GB RAM) - and it is honest about what it
 * does and does not change.
 *
 * What the experiment changes:
 *   - RAM and CPU below the reference minimum become *warnings*, as long as the
 *     machine is still capable of compiling at all (a floor of 6 GB RAM and
 *     2 logical cores, below which a Chromium build is not a sensible claim);
 *   - the number of parallel compile jobs is computed from measured RAM and
 *     logical cores (`planJobs`) instead of being left to ninja's default;
 *   - a disk profile with a smaller footprint and a hard reserve is used.
 *
 * What it never changes: the sandbox, site isolation, TLS verification, process
 * isolation, the GN argument allowlist, the patch set, the pin, or the claim
 * that anything is verified. Disk insufficiency is a hard stop in both modes,
 * because filling a person's disk is not an acceptable failure mode.
 *
 * Everything here is a pure function of a JSON environment report, so it is
 * unit-tested on CI and the PowerShell bootstrap script only has to gather
 * facts and print the verdict.
 *
 * Usage:
 *   node tools/chromium/low-resource.mjs --environment <file> [--json]
 *   node tools/chromium/low-resource.mjs --environment <file> --low-resource-experiment
 *
 * Exit codes: 0 may proceed, 1 problems exist, 2 usage/parse error.
 */
import { existsSync, readFileSync } from 'node:fs';

import { isMainModule } from '../lib/entry.mjs';

export const LOW_RESOURCE_MODE = 'LOW_RESOURCE_EXPERIMENT';

/** The documented reference builder. Not a goal to lower. */
export const REFERENCE_BUILDER = {
  cpuCores: 8,
  ramGb: 32,
  freeDiskGb: 150,
};

/**
 * Disk policy for the experiment.
 *
 * Estimates, not measurements: the source checkout with dependencies is the big
 * item, a component build's object files and the intermediate link files come
 * second, and temporary files, logs and Windows' own working room come third.
 * They are deliberately generous; after the first real run the numbers must be
 * replaced with what actually happened (see docs/LOCAL-WINDOWS-BUILD.md).
 */
export const EXPERIMENT_DISK = {
  estimatedFootprintGb: 85,
  safetyReserveGb: 15,
  hardMinimumFreeGb: 100,
  recommendedFreeGb: 120,
};

/** Lower than this, a Chromium compile is not a realistic claim. */
export const ABSOLUTE_RAM_FLOOR_GB = 6;
export const ABSOLUTE_CPU_FLOOR = 2;

/** Minimum tooling. Node is ours; the rest belongs to the Chromium build. */
export const MINIMUM_NODE_MAJOR = 20;
export const MINIMUM_GIT_MAJOR = 2;
export const MINIMUM_WINDOWS_BUILD = 10240; // Windows 10

/** What the machine needs, in the order the operator will care about it. */
export const REQUIRED_SOFTWARE = [
  {
    name: 'Windows',
    requirement: 'Windows 10 or Windows 11, x64',
    why: 'The first target platform. Windows 10 build 10240 is the floor.',
  },
  {
    name: 'Visual Studio',
    requirement:
      'VS 2022 (or 2019) with the "Desktop development with C++" workload, including the x64 C++ toolset (VC.Tools.x86.x64)',
    why: 'The compiler, linker and Windows SDK integration Chromium builds with.',
  },
  {
    name: 'Windows SDK',
    requirement: 'A Windows 10 or 11 SDK (installed with the VS workload)',
    why: 'Headers and libraries for the Win32 APIs Chrome uses.',
  },
  {
    name: 'Git for Windows',
    requirement: 'Git 2.35 or newer',
    why: 'Pinned checkout, patch verification and depot_tools.',
  },
  {
    name: 'Node.js',
    requirement: `Node ${MINIMUM_NODE_MAJOR} or newer (22.4+ for the smoke test's WebSocket)`,
    why: "Runs Aurelia's build tooling. Never a runtime dependency of the browser.",
  },
  {
    name: 'Python',
    requirement: 'Python 3 on PATH, or none at all',
    why: 'depot_tools bootstraps its own interpreter on Windows, so this is a note, not a blocker.',
  },
  {
    name: 'Disk',
    requirement: `NTFS volume with at least ${EXPERIMENT_DISK.hardMinimumFreeGb} GB free (${EXPERIMENT_DISK.recommendedFreeGb} GB recommended)`,
    why: `About ${EXPERIMENT_DISK.estimatedFootprintGb} GB is used by source and build output; ${EXPERIMENT_DISK.safetyReserveGb} GB stays reserved and is never filled.`,
  },
];

/**
 * How many parallel compile jobs this machine may run.
 *
 * Tiers, from the measured RAM: below 6 GB nothing is safe; 6-8 GB runs one
 * compiler; 8-16 GB two; 16-24 GB three; above that four. The result is then
 * capped at half the logical cores, because two `cl.exe` processes per core buy
 * nothing but context switching on a small CPU. Each step is a memory decision,
 * not a speed preference: a Chromium translation unit plus its PCH is hundreds
 * of megabytes, and the linker needs more than a compiler.
 */
export function planJobs({ cpuCores = 0, ramGb = 0 } = {}) {
  if (!Number.isFinite(ramGb) || ramGb <= 0) {
    return { jobs: 0, reason: 'RAM could not be measured' };
  }
  if (ramGb < ABSOLUTE_RAM_FLOOR_GB) {
    return {
      jobs: 0,
      reason: `below the ${ABSOLUTE_RAM_FLOOR_GB} GB floor at which a Chromium build is realistic`,
    };
  }
  const tiers = [
    { max: 8, jobs: 1 },
    { max: 16, jobs: 2 },
    { max: 24, jobs: 3 },
    { max: Number.POSITIVE_INFINITY, jobs: 4 },
  ];
  const tier = tiers.find((entry) => ramGb < entry.max);
  const cpuCap = Math.max(1, Math.floor(cpuCores / 2) || 1);
  const jobs = Math.max(1, Math.min(tier.jobs, cpuCap));
  const capNote =
    jobs < tier.jobs ? ` (capped from ${tier.jobs} by ${cpuCap} usable cores)` : '';
  return {
    jobs,
    reason: `${ramGb} GB RAM -> ${jobs} compile job(s)${capNote}; links are serialized by concurrent_links = 1`,
  };
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

/** `2.5` rather than `2.500000000001`. */
function round(value) {
  return Math.round(value * 10) / 10;
}

/** Python-ish major.minor from a version string, for the minimums above. */
function versionMajor(text) {
  const match = /(\d+)(?:\.(\d+))?/.exec(String(text ?? ''));
  return match === null ? null : Number(match[1]);
}

/**
 * Decide whether this machine may start, and with how much parallelism.
 *
 * @param {object} environment the JSON report the bootstrap script wrote
 * @param {{experimentMode?: boolean}} [options]
 */
export function evaluateEnvironment(
  environment = {},
  { experimentMode = false, allowMissingSdk = false } = {},
) {
  const experiment = experimentMode === true;
  const windows = environment.windows ?? {};
  const cpu = environment.cpu ?? {};
  const memory = environment.memory ?? {};
  const disk = environment.disk ?? {};
  const tooling = environment.tooling ?? {};
  const pagefile = environment.pagefile ?? {};

  const problems = [];
  const warnings = [];
  const notes = [];

  const cores = numeric(cpu.logicalCores);
  const ramGb = numeric(memory.totalGb);
  const freeGb = numeric(disk.freeGb);
  const filesystem = String(disk.filesystem ?? 'unknown');
  const windowsBuild = numeric(windows.buildNumber);
  const architecture = String(windows.architecture ?? 'unknown');
  const nodeMajor = versionMajor(tooling.node);

  // --- hard requirements, both modes -------------------------------------
  if (!(windowsBuild >= MINIMUM_WINDOWS_BUILD)) {
    problems.push(
      `Windows build ${windows.buildNumber ?? 'unknown'} is older than Windows 10 (${MINIMUM_WINDOWS_BUILD})`,
    );
  }
  if (!/64/.test(architecture)) {
    problems.push(`architecture ${architecture} is not 64-bit`);
  }
  if (cores < ABSOLUTE_CPU_FLOOR) {
    problems.push(
      `${cores} logical core(s) is below the ${ABSOLUTE_CPU_FLOOR} this experiment needs`,
    );
  }
  if (ramGb > 0 && ramGb < ABSOLUTE_RAM_FLOOR_GB) {
    problems.push(
      `${ramGb} GB RAM is below the ${ABSOLUTE_RAM_FLOOR_GB} GB floor at which a Chromium build is realistic (the reference builder has ${REFERENCE_BUILDER.ramGb} GB)`,
    );
  }
  if (filesystem.toLowerCase() !== 'ntfs') {
    problems.push(
      `filesystem ${filesystem} is not NTFS; Chromium expects an NTFS volume (case sensitivity, hard links)`,
    );
  }
  // The report may carry either an explicit boolean or the human string the
  // bootstrap script builds. Both are accepted so a hand-written report is not
  // silently treated as "no Visual Studio".
  const hasCppTools =
    typeof tooling.visualStudioHasCppTools === 'boolean'
      ? tooling.visualStudioHasCppTools
      : typeof tooling.visualStudio === 'string' &&
        tooling.visualStudio.trim().length > 0 &&
        !/MISSING/i.test(tooling.visualStudio);
  if (!hasCppTools) {
    problems.push(
      'Visual Studio with the "Desktop development with C++" workload (VC.Tools.x86.x64) was not found',
    );
  }
  // A preinstalled Windows SDK is only required when the build is going to use
  // it. It is not: with DEPOT_TOOLS_WIN_TOOLCHAIN left at its default (1),
  // build/vs_toolchain.py at the pinned revision downloads the pinned toolchain
  // and its SDK (SDK_VERSION = '10.0.28000.0') into
  // depot_tools/win_toolchain/vs_files. A machine with no SDK - or with an
  // SDK older than the pin, which is what GitHub's Windows image ships
  // (10.0.26100.0) - therefore still builds. This is opt-in, off by default,
  // and the reason is recorded in the verdict either way.
  if (!Array.isArray(tooling.windowsSdks) || tooling.windowsSdks.length === 0) {
    if (allowMissingSdk) {
      warnings.push(
        'no preinstalled Windows 10/11 SDK was found; Chromium downloads the SDK ' +
          "it pins (10.0.28000.0 at the pinned revision, build/vs_toolchain.py) into " +
          'depot_tools/win_toolchain/vs_files when DEPOT_TOOLS_WIN_TOOLCHAIN is left at ' +
          'its default of 1, so this machine is not disqualified by its absence',
      );
    } else {
      problems.push('no Windows 10/11 SDK was found');
    }
  }
  if (!(versionMajor(tooling.git) >= MINIMUM_GIT_MAJOR)) {
    problems.push(
      `git for Windows ${MINIMUM_GIT_MAJOR}.x or newer was not found; depot_tools and the patch tools need it`,
    );
  }
  if (tooling.node === null || tooling.node === undefined) {
    problems.push(
      `Node.js ${MINIMUM_NODE_MAJOR}+ was not found; it runs the Aurelia build tooling`,
    );
  } else if (nodeMajor !== null && nodeMajor < MINIMUM_NODE_MAJOR) {
    problems.push(`Node.js ${tooling.node} is older than ${MINIMUM_NODE_MAJOR}`);
  }

  // --- disk: a hard stop in both modes -----------------------------------
  const diskFloorGb = experiment
    ? EXPERIMENT_DISK.hardMinimumFreeGb
    : REFERENCE_BUILDER.freeDiskGb;
  if (freeGb <= 0) {
    problems.push('free disk space could not be measured on the destination volume');
  } else if (freeGb < diskFloorGb) {
    problems.push(
      `${freeGb} GB free is below the ${diskFloorGb} GB this ${
        experiment ? 'experiment' : 'build'
      } needs${
        experiment
          ? ` (about ${EXPERIMENT_DISK.estimatedFootprintGb} GB of source and build output plus a ${EXPERIMENT_DISK.safetyReserveGb} GB reserve that is never filled)`
          : ` (the documented builder minimum; see docs/BUILDING-CHROMIUM.md)`
      }`,
    );
  } else if (experiment && freeGb < EXPERIMENT_DISK.recommendedFreeGb) {
    warnings.push(
      `${round(freeGb)} GB free is enough to start, but below the recommended ${EXPERIMENT_DISK.recommendedFreeGb} GB for a comfortable run`,
    );
  }

  // --- below-reference RAM and CPU: warnings here, problems normally ------
  if (cores > 0 && cores < REFERENCE_BUILDER.cpuCores) {
    const message = `${cores} logical core(s) is below the reference builder's ${REFERENCE_BUILDER.cpuCores}`;
    if (experiment) {
      warnings.push(`${message}; the schedule will use at most half of them`);
    } else {
      problems.push(
        `${message}; re-run with -LowResourceExperiment to attempt a build anyway`,
      );
    }
  }
  if (ramGb > 0 && ramGb < REFERENCE_BUILDER.ramGb) {
    const message = `${ramGb} GB RAM is below the reference builder's ${REFERENCE_BUILDER.ramGb} GB`;
    if (experiment) {
      warnings.push(message);
    } else {
      problems.push(
        `${message}; re-run with -LowResourceExperiment to attempt a build anyway`,
      );
    }
  }

  // --- advisories that never block ---------------------------------------
  const pagefileGb = numeric(pagefile.allocatedGb);
  if (pagefile.configured === false || pagefileGb === 0) {
    warnings.push(
      'no pagefile is configured; Ninja/`cl.exe` can need virtual memory beyond the 8 GB of RAM. ' +
        'This script never changes system settings - see docs/LOCAL-WINDOWS-BUILD.md for the manual steps ' +
        '(System Properties -> Advanced -> Performance Settings -> Advanced -> Virtual memory).',
    );
  } else if (experiment && ramGb > 0 && pagefileGb < ramGb) {
    warnings.push(
      `the pagefile is ${round(pagefileGb)} GB while the machine has ${ramGb} GB RAM; a system-managed ` +
        'pagefile (or a fixed one of at least the RAM size) is strongly recommended for a parallel C++ build. ' +
        'This script reports it and never changes it - see docs/LOCAL-WINDOWS-BUILD.md.',
    );
  }
  if (tooling.longPathsEnabled !== true) {
    warnings.push(
      'Windows long-path support is not enabled (LongPathsEnabled); keep the checkout path short - for ' +
        'example D:\\aurelia - or turn it on manually. The script never changes the registry.',
    );
  }
  if (tooling.python === null || tooling.python === undefined) {
    notes.push(
      'Python is not on PATH. depot_tools bootstraps its own interpreter on Windows, so this is only a note.',
    );
  }
  if (tooling.depotTools?.revision) {
    notes.push(
      `depot_tools is present at ${String(tooling.depotTools.revision).slice(0, 12)}; sync.mjs pins it.${
        tooling.depotTools.clean === false
          ? ' It is not on its pinned revision and will be reset.'
          : ''
      }`,
    );
  } else {
    notes.push('depot_tools is not installed yet; the sync stage clones it at the pinned revision.');
  }

  const { jobs, reason } = planJobs({ cpuCores: cores, ramGb });
  if (problems.length === 0 && jobs === 0) {
    problems.push(`no safe compile job count could be derived: ${reason}`);
  }

  return {
    mode: experiment ? LOW_RESOURCE_MODE : 'reference-builder',
    ok: problems.length === 0,
    problems,
    warnings,
    notes,
    jobs,
    jobsReason: reason,
    disk: {
      target: disk.target ?? environment.dest ?? 'unknown',
      freeGb: round(freeGb),
      filesystem,
      floorGb: diskFloorGb,
      estimatedFootprintGb: experiment ? EXPERIMENT_DISK.estimatedFootprintGb : null,
      reserveGb: experiment ? EXPERIMENT_DISK.safetyReserveGb : 0,
      referenceFreeDiskGb: REFERENCE_BUILDER.freeDiskGb,
    },
    reference: REFERENCE_BUILDER,
    experiment: experiment ? EXPERIMENT_DISK : null,
  };
}

/** Human-readable report. Kept here so the PowerShell script prints one thing. */
export function formatReport(environment, verdict) {
  const windows = environment.windows ?? {};
  const cpu = environment.cpu ?? {};
  const memory = environment.memory ?? {};
  const disk = environment.disk ?? {};
  const tooling = environment.tooling ?? {};
  const pagefile = environment.pagefile ?? {};
  const lines = [];

  lines.push('Aurelia - low-resource build preflight');
  lines.push('=====================================');
  lines.push(`mode:            ${verdict.mode}`);
  lines.push(`destination:     ${environment.dest ?? 'unknown'}`);
  lines.push(
    `windows:         ${windows.caption ?? 'unknown'}${
      windows.buildNumber ? ` (build ${windows.buildNumber}, ${windows.architecture ?? '?'})` : ''
    }`,
  );
  lines.push(
    `cpu:             ${cpu.model ?? 'unknown'} - ${cpu.physicalCores ?? '?'} physical / ${cpu.logicalCores ?? '?'} logical core(s)`,
  );
  lines.push(
    `memory:          ${memory.totalGb ?? '?'} GB total, ${memory.availableGb ?? '?'} GB available${memory.freePhysicalGb ? `, ${memory.freePhysicalGb} GB free physical` : ''}`,
  );
  lines.push(
    `disk:            ${disk.target ?? '?'} - ${verdict.disk.freeGb} GB free of ${disk.sizeGb ?? '?'} GB (${verdict.disk.filesystem})`,
  );
  lines.push(
    `pagefile:        ${
      pagefile.configured === false
        ? 'none configured'
        : `${pagefile.allocatedGb ?? '?'} GB allocated${pagefile.automaticManaged ? ' (system managed)' : ''}${
            Array.isArray(pagefile.files) && pagefile.files.length > 0
              ? ` on ${pagefile.files.join(', ')}`
              : ''
          }`
    } - reported, never modified`,
  );
  lines.push('');
  lines.push('Tooling');
  lines.push('-------');
  lines.push(
    `visual studio:   ${tooling.visualStudio?.displayName ?? 'not found'}${
      tooling.visualStudio?.version ? ` ${tooling.visualStudio.version}` : ''
    }${tooling.visualStudio?.hasCppTools ? ' (C++ x64 toolset present)' : ' (C++ x64 toolset MISSING)'}`,
  );
  lines.push(
    `msvc toolsets:   ${Array.isArray(tooling.msvcToolsets) && tooling.msvcToolsets.length > 0 ? tooling.msvcToolsets.join(', ') : 'not found'}`,
  );
  lines.push(
    `windows sdk:     ${Array.isArray(tooling.windowsSdks) && tooling.windowsSdks.length > 0 ? tooling.windowsSdks.join(', ') : 'not found'}`,
  );
  lines.push(`git:             ${tooling.git ?? 'not found'}`);
  lines.push(`node:            ${tooling.node ?? 'not found'}`);
  lines.push(`python:          ${tooling.python ?? 'not on PATH (depot_tools brings its own)'}`);
  lines.push(
    `long paths:      ${tooling.longPathsEnabled === true ? 'enabled' : tooling.longPathsEnabled === false ? 'DISABLED (LongPathsEnabled)' : 'unknown (LongPathsEnabled)'}`,
  );
  lines.push('');
  lines.push('Build plan');
  lines.push('----------');
  lines.push(
    `disk policy:     need ${verdict.disk.floorGb} GB free${
      verdict.disk.estimatedFootprintGb === null
        ? ' (documented builder minimum)'
        : ` (about ${verdict.disk.estimatedFootprintGb} GB used, ${verdict.disk.reserveGb} GB reserve never filled; ${verdict.disk.referenceFreeDiskGb} GB is the reference minimum)`
    }`,
  );
  lines.push(
    `compile jobs:    autoninja -j ${verdict.jobs} (${verdict.jobsReason})`,
  );
  lines.push('link jobs:       1 at a time (concurrent_links = 1 in the low-resource GN profile)');
  lines.push('security:        sandbox, site isolation, TLS verification and process isolation are untouched');
  lines.push('');
  if (verdict.problems.length > 0) {
    lines.push('Problems (this machine cannot run the build as configured):');
    for (const problem of verdict.problems) {
      lines.push(`  x ${problem}`);
    }
  }
  if (verdict.warnings.length > 0) {
    lines.push('Warnings (the build can run, but read these):');
    for (const warning of verdict.warnings) {
      lines.push(`  ! ${warning}`);
    }
  }
  if (verdict.notes.length > 0) {
    lines.push('Notes:');
    for (const note of verdict.notes) {
      lines.push(`  i ${note}`);
    }
  }
  if (verdict.problems.length === 0) {
    lines.push('');
    lines.push(
      verdict.mode === LOW_RESOURCE_MODE
        ? 'VERDICT: may proceed as LOW_RESOURCE_EXPERIMENT - a best-effort build, not a supported one.'
        : 'VERDICT: may proceed on the documented reference builder.',
    );
  } else {
    lines.push('');
    lines.push(
      'VERDICT: refused - fix the problems above, then run this check again.',
    );
  }
  return lines.join('\n');
}

const isMain = isMainModule(import.meta.url);

if (isMain) {
  const argv = process.argv.slice(2);
  const valueOf = (flag) => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };

  try {
    if (argv.includes('--help') || argv.includes('-h')) {
      console.log(`LOW_RESOURCE_EXPERIMENT policy for the local Windows build path.

  --environment <file>        JSON report written by tools/windows/bootstrap-build.ps1
  --low-resource-experiment   apply the experimental floor (RAM/CPU become warnings)
  --allow-missing-sdk         treat "no preinstalled Windows SDK" as a warning:
                              Chromium downloads the SDK it pins (see
                              build/vs_toolchain.py at the pinned revision)
  --json                      print the machine-readable verdict instead of the report
  --requirements              print what the machine has to provide

Exit codes: 0 may proceed, 1 problems exist, 2 usage or parse error.`);
      process.exitCode = 0;
    } else if (argv.includes('--requirements')) {
      for (const entry of REQUIRED_SOFTWARE) {
        console.log(`${entry.name}\n  needs: ${entry.requirement}\n  why:   ${entry.why}`);
      }
      process.exitCode = 0;
    } else {
      const environmentFile = valueOf('--environment');
      if (environmentFile === undefined) {
        console.error('--environment <file> is required (run --help)');
        process.exitCode = 2;
      } else if (!existsSync(environmentFile)) {
        console.error(`environment report not found: ${environmentFile}`);
        process.exitCode = 2;
      } else {
        const environment = JSON.parse(readFileSync(environmentFile, 'utf8'));
        const verdict = evaluateEnvironment(environment, {
          experimentMode: argv.includes('--low-resource-experiment'),
          allowMissingSdk: argv.includes('--allow-missing-sdk'),
        });
        if (argv.includes('--json')) {
          console.log(JSON.stringify(verdict, null, 2));
        } else {
          console.log(formatReport(environment, verdict));
        }
        process.exitCode = verdict.ok ? 0 : 1;
      }
    }
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exitCode = 2;
  }
}
