/**
 * The structural PowerShell lint.
 *
 * A lint that never fails is decoration, so every rule is asserted with a
 * deliberately broken source *and* the real script is asserted to pass. None of
 * this proves the script runs on Windows - only a Windows run can do that - but
 * it does prove the check would catch the class of mistake it claims to catch.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  analyzePowerShellText,
  checkPowerShellScripts,
  powerShellFiles,
  stripPowerShell,
} from '../../tools/ci/check-powershell.mjs';
import { REPO_ROOT } from '../../tools/chromium/lib/config.mjs';

const SCRIPT = 'tools/windows/bootstrap-build.ps1';

describe('the repository scripts', () => {
  it('contains the Windows bootstrap script', () => {
    const files = powerShellFiles().map((file) =>
      path.relative(REPO_ROOT, file).split(path.sep).join('/'),
    );
    expect(files).toContain(SCRIPT);
  });

  it('passes every structural check', () => {
    const result = checkPowerShellScripts();
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('is Windows PowerShell 5.1 compatible on the evidence a text check can give', () => {
    const text = readFileSync(path.join(REPO_ROOT, SCRIPT), 'utf8');
    // 5.1 has no ternary operator, no null-coalescing and no class-based enums.
    for (const future of [
      /\?\?/,
      /\s\?\s/,
      /\bclass\s+\w+\s*\{/,
      /\$using:/,
      /\bForEach-Object\s+-Parallel\b/,
      /\bGet-Error\b/,
      /\bConvertFrom-Json\s+-AsHashtable\b/,
    ]) {
      expect(text).not.toMatch(future);
    }
    expect(text).toContain('#Requires -Version 5.1');
  });

  it('does not spawn local tools and directs users to the hosted workflow', () => {
    const text = readFileSync(path.join(REPO_ROOT, SCRIPT), 'utf8');
    for (const tool of ['gclient', 'gn', 'autoninja', 'ninja']) {
      expect(text).not.toMatch(new RegExp(`&\\s+${tool}\\b`));
    }
    expect(text).toContain('.github/workflows/chromium-build.yml');
    expect(text).toContain('exit 1');
  });
});

describe('rules that must fail on broken input', () => {
  const cases = [
    ['unbalanced brace', 'function A {\n  if ($true) {\n}\n', /never closed/],
    ['extra closer', 'function A {\n}\n}\n', /closes nothing/],
    ['unbalanced parenthesis', 'Write-Log ("a" -f 1\n', /never closed/],
    ['unterminated here-string', "@'\nno end\n", /here-string/],
    ['unterminated single quote', "Write-Log 'oops\n", /never closed/],
    [
      'continuation backtick plus space',
      'Write-Log ` \n',
      /backtick followed by whitespace/,
    ],
    ['tab character', 'Write-Log\t"x"\n', /contains a tab/],
    ['CRLF ending', 'Write-Log "x"\r\n', /CRLF line ending/],
    ['byte-order mark', '\uFEFFWrite-Log "x"\n', /byte-order mark/],
    [
      'Set-Content -Encoding UTF8',
      'Set-Content -LiteralPath $p -Value $j -Encoding UTF8\n',
      /byte-order mark/,
    ],
  ];

  for (const [name, text, expected] of cases) {
    it(`reports ${name}`, () => {
      const problems = analyzePowerShellText('broken.ps1', text).problems;
      expect(problems.join('\n')).toMatch(expected);
    });
  }

  it('accepts what the real script does instead', () => {
    const good = [
      '#Requires -Version 5.1',
      'function Write-Utf8NoBom {',
      '    param([string]$Path, [string]$Text)',
      '    $encoding = New-Object System.Text.UTF8Encoding($false)',
      '    [System.IO.File]::WriteAllText($Path, $Text, $encoding)',
      '}',
      "$here = @'",
      'text with { unbalanced and ( unclosed',
      "'@",
      'Write-Utf8NoBom -Path $p -Text ($payload | ConvertTo-Json -Depth 6)',
      '',
    ].join('\n');
    expect(analyzePowerShellText('good.ps1', good).problems).toEqual([]);
  });
});

describe('comment and string handling', () => {
  it('ignores delimiters inside comments and strings', () => {
    const text = [
      '# a comment with { and (',
      '<#',
      'block { comment',
      '#>',
      'Write-Log "a string with } and ]"',
      "Write-Log 'and a { literal'",
      '',
    ].join('\n');
    expect(analyzePowerShellText('comments.ps1', text).problems).toEqual([]);
  });

  it('keeps line numbers when it blanks out code', () => {
    const text = ['# one', 'Write-Log 1', '# two', 'Write-Log 2'].join('\n');
    const { code } = stripPowerShell(text);
    expect(code.split('\n')).toHaveLength(4);
    expect(code).not.toContain('#');
    expect(code.trim()).toContain('Write-Log 1');
  });
});
