/**
 * Static checks for the Windows bootstrap script.
 *
 * Windows cannot run here, so this is not a functional test: it is the set of
 * invariants that must hold in the *text* of the script and would be expensive
 * to discover on the owner's machine. Everything that decides anything lives in
 * Node (tools/chromium/low-resource.mjs, tools/chromium/build.mjs) and is tested
 * there; this file checks that the PowerShell layer stays a thin, honest shell
 * around it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../../tools/chromium/build.mjs';
import { analyzePowerShellText } from '../../tools/ci/check-powershell.mjs';

const SCRIPT_PATH = path.join(
  REPO_ROOT,
  'tools',
  'windows',
  'bootstrap-build.ps1',
);
const DOC_PATH = path.join(REPO_ROOT, 'docs', 'LOCAL-WINDOWS-BUILD.md');

const script = readFileSync(SCRIPT_PATH, 'utf8');
const doc = readFileSync(DOC_PATH, 'utf8');
// Prose is wrapped and quoted, so a phrase can straddle a newline and a
// blockquote marker; normalise both before asserting on multi-word phrases.
const docText = doc.replace(/^\s*>\s?/gm, '').replace(/\s+/g, ' ');

/** Lines that are not blank and not a comment. */
const codeLines = script
  .split('\n')
  .map((line, index) => ({ line, number: index + 1 }))
  .filter(({ line }) => {
    const trimmed = line.trim();
    return trimmed !== '' && !trimmed.startsWith('#');
  });

describe('Windows bootstrap script', () => {
  it('is a clean PowerShell file', () => {
    expect(
      analyzePowerShellText('bootstrap-build.ps1', script).problems,
    ).toEqual([]);
  });

  it('offers the resumable modes the plan promises', () => {
    expect(script).toContain(
      "ValidateSet('CHECK', 'SYNC', 'VERIFY', 'BUILD', 'SMOKE', 'PACKAGE', 'ALL', 'CLEANUP')",
    );
    expect(script).toContain('[switch]$LowResourceExperiment');
    expect(script).toContain('[switch]$DryRun');
    expect(script).toContain('[switch]$Yes');
    // The experiment flag is what the operator has to type; without it the
    // reference-builder rules apply unchanged.
    expect(script).toContain("$profile = 'low-resource'");
  });

  it('keeps one pipeline implementation and calls it', () => {
    expect(script).toContain('tools\\chromium\\build.mjs');
    expect(script).toContain("'--only'");
    expect(script).toContain("'--log-dir'");
    expect(script).toContain('tools\\chromium\\low-resource.mjs');
    // The pipeline stages belong to the Node driver, not to this script.
    expect(script).not.toMatch(/&\s*gclient\b/);
    expect(script).not.toMatch(/&\s*gn\b/);
    expect(script).not.toMatch(/&\s*autoninja\b/);
  });

  it('stops with the gate verdict instead of continuing on a bad machine', () => {
    expect(script).toContain('Invoke-EnvironmentGate');
    expect(script).toContain('$exitCode = $gate');
    expect(script).toContain('return 2');
    expect(script).toContain("'--low-resource-experiment'");
  });

  it('takes every disk number from the policy module', () => {
    expect(script).toContain('$script:Verdict.disk.hardMinimumFreeGb');
    expect(script).toContain('$script:Verdict.disk.reserveGb');
    expect(script).toContain('$reference.freeDiskGb');
    // No executable line may hard-code a floor of its own.
    const offenders = codeLines.filter(({ line }) =>
      /=\s*(100|150)\b/.test(line),
    );
    expect(
      offenders.map(({ number, line }) => `${number}: ${line.trim()}`),
    ).toEqual([]);
  });

  it('reports the pagefile but never modifies system settings', () => {
    expect(script).toContain('Win32_PageFileUsage');
    expect(script).toContain('AutomaticManagedPagefile');
    expect(script).toContain('never modified');
    for (const forbidden of [
      'Set-CimInstance',
      'Win32_PageFileSetting',
      'New-CimInstance',
      'fsutil',
      'bcdedit',
      'wmic',
      'Set-ItemProperty',
      'reg add',
      'New-ItemProperty',
    ]) {
      expect(
        script,
        `script must not touch system settings: ${forbidden}`,
      ).not.toContain(forbidden);
    }
  });

  it('never weakens the browser to make the build succeed', () => {
    for (const forbidden of [
      '--no-sandbox',
      '--allow-disabled-sandbox',
      '--disable-site-isolation',
      '--ignore-certificate-errors',
      'disable_site_isolation',
      'disable_web_security',
      'is_official_build = true',
    ]) {
      expect(script).not.toContain(forbidden);
    }
  });

  it('deletes nothing except through the explicit cleanup mode', () => {
    const recursive = script.match(/Remove-Item[^\n]*-Recurse/g) ?? [];
    expect(recursive).toHaveLength(1);
    expect(script.indexOf('function Invoke-Cleanup')).toBeLessThan(
      script.indexOf('Remove-Item -LiteralPath $path -Recurse'),
    );
    expect(script).toContain("if ($answer -ne 'DELETE')");
    expect(script).toContain('refusing to delete the volume root');
    expect(script).toContain(
      'refusing to delete outside the build destination',
    );
  });

  it('guards the disk while a long build runs', () => {
    expect(script).toContain('taskkill /T /F /PID');
    expect(script).toContain('below the $ReserveGb GB reserve');
    expect(script).toContain('Get-FreeSpaceGb');
  });

  it('writes the four logs the plan promises', () => {
    for (const log of [
      'bootstrap.log',
      'environment.json',
      'build.log',
      'last-error.txt',
    ]) {
      expect(script).toContain(log);
    }
    expect(script).toContain("'artifacts\\local-build'");
    // The environment report has to be parseable by Node, so it must not be
    // written with the BOM that Set-Content -Encoding UTF8 adds in 5.1.
    expect(script).toContain('Write-Utf8NoBom');
  });

  it('limits ninja only in the low-resource profile', () => {
    expect(script).toContain("$Profile -eq 'low-resource' -and $Jobs -gt 0");
    expect(script).toContain("'--jobs'");
  });

  it('makes a dry run possible without touching anything', () => {
    expect(script).toContain("'--dry-run'");
    expect(script).toContain('Dry run: nothing was downloaded');
    expect(script).toContain('-DryRun:$DryRun.IsPresent');
  });
});

describe('local Windows build documentation', () => {
  it('documents the experiment, its floors and its pagefile policy', () => {
    expect(doc).toContain('LOW_RESOURCE_EXPERIMENT');
    expect(doc).toContain('-LowResourceExperiment');
    expect(doc).toContain('100 GB');
    expect(doc).toContain('15 GB reserve');
    // Every mode the operator may need.
    for (const mode of [
      '-Mode CHECK',
      '-Mode SYNC',
      '-Mode BUILD',
      '-Mode SMOKE',
      '-Mode PACKAGE',
    ]) {
      expect(doc).toContain(mode);
    }
    expect(doc).toContain('-Mode CLEANUP');
    // Honesty about what the path is not.
    expect(docText).toMatch(
      /not been executed on Windows|never executed on Windows/,
    );
    expect(docText).toContain('not a');
    expect(docText).toContain('pagefile');
    expect(docText).toContain('never modified');
  });

  it('links the documents that own the numbers', () => {
    expect(docText).toContain('BUILDING-CHROMIUM.md');
    expect(docText).toContain('PROJECT-STATUS.md');
    expect(docText).toContain('TESTING.md');
  });

  it('documents the compile-job tiers and the GN profile difference', () => {
    expect(docText).toContain('8-15 GB');
    expect(docText).toContain('16-23 GB');
    expect(docText).toContain('concurrent_links');
    expect(docText).toContain('symbol_level');
    // The document must not quietly lower the documented builder minimum.
    expect(docText).toContain('8+ cores / 32 GB RAM / 150 GB free');
    expect(docText).toContain('not lowered');
  });
});
