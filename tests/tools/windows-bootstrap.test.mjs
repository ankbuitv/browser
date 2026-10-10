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

describe('retired local Windows build path', () => {
  it('keeps the compatibility PowerShell entry point structurally valid', () => {
    expect(
      analyzePowerShellText('bootstrap-build.ps1', script).problems,
    ).toEqual([]);
    expect(script).toContain("[string]$Mode = 'ALL'");
    expect(script).toContain('[string]$Dest = $env:AURELIA_CHROMIUM_DEST');
  });

  it('exits before syncing source, compiling, or deleting files', () => {
    expect(script).toContain('local Windows Chromium build path is retired');
    expect(script).toContain('Use .github/workflows/chromium-build.yml');
    expect(script).toContain('exit 1');
    expect(script).not.toContain('sync.mjs');
    expect(script).not.toContain('autoninja');
    expect(script).not.toContain('Remove-Item');
  });

  it('documents GitHub-hosted compilation as the only supported path', () => {
    expect(doc).toContain('Local Windows Chromium build path (retired)');
    expect(doc).toContain('All Chromium compilation must run on GitHub-hosted');
    expect(doc).toContain('.github/workflows/chromium-build.yml');
    expect(doc).toMatch(/No local Chromium\s+compilation has been attempted/);
  });
});
