/**
 * Windows `git.bat` regression tests.
 *
 * These run on Linux, which is the only place this suite runs, so every
 * Windows behaviour is pinned with an explicitly injected `platform`,
 * `spawn`, or `exists` - the same technique `tests/tools/exec.test.mjs` uses
 * for `cmd.exe` resolution.
 *
 * The bug they pin: GitHub Actions run
 * https://github.com/ankworks/aurelia/actions/runs/38043815539 failed with
 * `FileNotFoundError: [WinError 2]` in `depot_tools/git_cache.py`,
 * `Mirror.GetCachePath()`. depot_tools hard-codes `git.bat` on Windows while
 * Git for Windows (and depot_tools itself) ships only `git.exe`.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { withPathPrefix } from '../../tools/chromium/lib/exec.mjs';
import {
  GIT_BAT_NAME,
  GIT_SHIM_DIR_NAME,
  KNOWN_WINDOWS_GIT_EXECUTABLES,
  describeGitEnvironment,
  ensureWindowsGitShim,
  gitBatContents,
  gitShimDirectory,
  pathEntries,
  resolveGitExecutable,
  resolvesInPathEntries,
  whereExecutable,
} from '../../tools/chromium/lib/windows-git.mjs';
import { toolingDiagnostics } from '../../tools/chromium/sync.mjs';

/** PATH of a GitHub-hosted Windows runner, shortened to the relevant entries. */
const RUNNER_PATH_ENTRIES = [
  'C:\\Program Files\\Git\\cmd',
  'C:\\Program Files\\Git\\bin',
  'C:\\Windows\\System32',
];

/**
 * What Git for Windows actually installs: git.exe in `cmd` and `bin`, and no
 * `git.bat` anywhere. Separators are normalized so a POSIX-joined candidate
 * still matches a Windows-style entry.
 */
const GIT_FOR_WINDOWS_FILES = new Set([
  'C:\\Program Files\\Git\\cmd\\git.exe',
  'C:\\Program Files\\Git\\bin\\git.exe',
]);

const windowsExists = (candidate) =>
  GIT_FOR_WINDOWS_FILES.has(candidate.replaceAll('/', '\\'));

const RUNNER_PATH = RUNNER_PATH_ENTRIES.join(';');

/** A `spawnSync` stand-in for a GitHub-hosted Windows runner. */
function windowsSpawn(file, args) {
  if (file === 'where.exe' && args[0] === 'git.exe') {
    return {
      error: undefined,
      status: 0,
      stdout:
        'C:\\Program Files\\Git\\cmd\\git.exe\r\nC:\\Program Files\\Git\\bin\\git.exe\r\n',
      stderr: '',
    };
  }
  if (file === 'where.exe' && args[0] === 'git') {
    return {
      error: undefined,
      status: 0,
      stdout: 'C:\\Program Files\\Git\\cmd\\git.exe\r\n',
      stderr: '',
    };
  }
  if (file === 'where.exe') {
    return { error: undefined, status: 1, stdout: '', stderr: '' };
  }
  if (args[0] === '--version') {
    return {
      error: undefined,
      status: 0,
      stdout: `${String(file).includes('python') ? 'Python 3.12.6' : 'git version 2.47.1.windows.1'}\r\n`,
      stderr: '',
    };
  }
  return { error: undefined, status: 1, stdout: '', stderr: '' };
}

const created = [];

function tempDirectory() {
  const directory = mkdtempSync(path.join(tmpdir(), 'aurelia-windows-git-'));
  created.push(directory);
  return directory;
}

afterEach(() => {
  while (created.length > 0) {
    rmSync(created.pop(), { recursive: true, force: true });
  }
});

describe('the missing git.bat (confirmed Windows failure)', () => {
  it('is not provided by Git for Windows, which ships only git.exe', () => {
    // git.exe resolves exactly as it does on the runner...
    expect(
      resolvesInPathEntries('git.exe', RUNNER_PATH_ENTRIES, {
        exists: windowsExists,
        separator: '\\',
      }),
    ).toBe('C:\\Program Files\\Git\\cmd\\git.exe');
    // ...but the name depot_tools asks for resolves to nothing. This is the
    // FileNotFoundError [WinError 2] in git_cache.py Mirror.GetCachePath().
    expect(
      resolvesInPathEntries(GIT_BAT_NAME, RUNNER_PATH_ENTRIES, {
        exists: windowsExists,
        separator: '\\',
      }),
    ).toBeNull();
  });

  it('resolves the exact command git_cache.py runs once the shim is on PATH', () => {
    const dest = tempDirectory();
    const shim = ensureWindowsGitShim({
      dest,
      env: { PATH: RUNNER_PATH },
      platform: 'win32',
      spawn: windowsSpawn,
      exists: windowsExists,
    });

    // Mirror.GetCachePath() runs:
    //   subprocess.check_output(['git.bat', 'config', '--type', 'path',
    //                            'cache.cachepath'])
    const gitCacheCommand = [
      GIT_BAT_NAME,
      'config',
      '--type',
      'path',
      'cache.cachepath',
    ];
    const existsEverywhere = (candidate) =>
      existsSync(candidate) || windowsExists(candidate);

    expect(
      resolvesInPathEntries(gitCacheCommand[0], RUNNER_PATH_ENTRIES, {
        exists: existsEverywhere,
      }),
    ).toBeNull();
    expect(
      resolvesInPathEntries(
        gitCacheCommand[0],
        [shim.directory, ...RUNNER_PATH_ENTRIES],
        {
          exists: existsEverywhere,
        },
      ),
    ).toBe(shim.gitBat);
  });

  it('reports the runner PATH as missing git.bat before the shim exists', () => {
    // The read-only description used by the validation driver's preflight.
    const before = describeGitEnvironment({
      env: { PATH: RUNNER_PATH },
      platform: 'win32',
      spawn: windowsSpawn,
      exists: (candidate) => windowsExists(candidate),
    });
    expect(before.gitBatResolvable).toBeNull();
    expect(before.git).toMatchObject({
      path: 'C:\\Program Files\\Git\\cmd\\git.exe',
      version: 'git version 2.47.1.windows.1',
    });
    expect(before.gitPathEntries).toEqual([
      'C:\\Program Files\\Git\\cmd',
      'C:\\Program Files\\Git\\bin',
    ]);
  });
});

describe('the generated git.bat shim', () => {
  it('forwards every argument to git.exe and returns its exit code', () => {
    const contents = gitBatContents('C:\\Program Files\\Git\\cmd\\git.exe');
    expect(contents).toContain('"C:\\Program Files\\Git\\cmd\\git.exe" %*');
    expect(contents).toContain('exit /b %ERRORLEVEL%');
    // cmd.exe wants CRLF; a LF-only batch file can truncate.
    expect(contents).toMatch(/\r\n/);
    expect(contents.split('\r\n')[0]).toBe('@echo off');
  });

  it('is written inside the Chromium destination, not into depot_tools', () => {
    const dest = path.join('D:', 'a', '_temp', 'aurelia-chromium');
    expect(gitShimDirectory(dest)).toBe(path.join(dest, GIT_SHIM_DIR_NAME));
    expect(gitShimDirectory(dest)).not.toContain('depot_tools');
  });

  it('is created on Windows and is a no-op everywhere else', () => {
    const dest = tempDirectory();
    const shim = ensureWindowsGitShim({
      dest,
      env: { PATH: RUNNER_PATH },
      platform: 'win32',
      spawn: windowsSpawn,
      exists: windowsExists,
    });
    expect(existsSync(shim.gitBat)).toBe(true);
    expect(shim.gitExecutable).toBe('C:\\Program Files\\Git\\cmd\\git.exe');
    expect(shim.alreadyResolvable).toBe(false);
    expect(readFileSync(shim.gitBat, 'utf8')).toContain(
      '"C:\\Program Files\\Git\\cmd\\git.exe" %*',
    );

    expect(
      ensureWindowsGitShim({
        dest,
        env: { PATH: RUNNER_PATH },
        platform: 'linux',
      }),
    ).toBeNull();
  });

  it('is rewritten on every run so a moved git cannot leave a stale shim', () => {
    const dest = tempDirectory();
    const first = ensureWindowsGitShim({
      dest,
      env: { PATH: RUNNER_PATH },
      platform: 'win32',
      spawn: windowsSpawn,
      exists: windowsExists,
    });
    writeFileSync(first.gitBat, 'stale\r\n');
    ensureWindowsGitShim({
      dest,
      env: { PATH: RUNNER_PATH },
      platform: 'win32',
      spawn: windowsSpawn,
      exists: windowsExists,
    });
    expect(readFileSync(first.gitBat, 'utf8')).toContain('%*');
  });

  it('stops with a clear message when no git.exe exists at all', () => {
    expect(() =>
      ensureWindowsGitShim({
        dest: tempDirectory(),
        env: { PATH: 'C:\\Windows\\System32' },
        platform: 'win32',
        spawn: () => ({ error: undefined, status: 1, stdout: '', stderr: '' }),
        exists: () => false,
      }),
    ).toThrow(/git\.exe/);
  });

  it('falls back to the documented Git for Windows locations without where.exe', () => {
    const dest = tempDirectory();
    const installed = new Set(['C:\\Program Files\\Git\\bin\\git.exe']);
    const shim = ensureWindowsGitShim({
      dest,
      env: { PATH: 'C:\\Windows\\System32' },
      platform: 'win32',
      spawn: (file, args) =>
        file === 'where.exe'
          ? { error: undefined, status: 1, stdout: '', stderr: '' }
          : windowsSpawn(file, args),
      exists: (candidate) => installed.has(candidate.replaceAll('/', '\\')),
    });
    expect(shim.gitExecutable).toBe('C:\\Program Files\\Git\\bin\\git.exe');
    expect(KNOWN_WINDOWS_GIT_EXECUTABLES).toContain(shim.gitExecutable);
  });
});

describe('executable lookup helpers', () => {
  it('reads PATH case-insensitively, the way Windows does', () => {
    expect(pathEntries({ Path: 'C:\\one;C:\\two' }, 'win32')).toEqual([
      'C:\\one',
      'C:\\two',
    ]);
    expect(pathEntries({ PATH: '/usr/bin:/bin' }, 'linux')).toEqual([
      '/usr/bin',
      '/bin',
    ]);
    expect(pathEntries({}, 'win32')).toEqual([]);
  });

  it('parses where.exe output, quoted or not', () => {
    expect(whereExecutable('git.exe', { spawn: windowsSpawn })).toEqual([
      'C:\\Program Files\\Git\\cmd\\git.exe',
      'C:\\Program Files\\Git\\bin\\git.exe',
    ]);
    expect(
      whereExecutable('python', {
        spawn: () => ({ error: undefined, status: 1, stdout: '', stderr: '' }),
      }),
    ).toEqual([]);
    expect(
      whereExecutable('git', {
        spawn: () => ({ error: new Error('ENOENT'), stdout: '', stderr: '' }),
      }),
    ).toEqual([]);
  });

  it('finds git through where.exe first', () => {
    expect(
      resolveGitExecutable({
        env: { PATH: RUNNER_PATH },
        platform: 'win32',
        spawn: windowsSpawn,
        exists: windowsExists,
      }),
    ).toMatchObject({ path: 'C:\\Program Files\\Git\\cmd\\git.exe' });
  });
});

describe('PATH construction for gclient children', () => {
  it('leaves exactly one PATH key, whichever spelling the runner used', () => {
    // GitHub-hosted Windows runners spell it `Path`. Spreading process.env
    // and assigning `PATH` would leave both keys in the object, and which one
    // survives into the child environment block is not deterministic.
    const env = { Path: '/usr/bin', SystemRoot: 'C:\\Windows' };
    const child = withPathPrefix(env, '/opt/depot_tools');
    expect(
      Object.keys(child).filter((key) => key.toUpperCase() === 'PATH'),
    ).toEqual(['PATH']);
    expect(child.PATH).toBe(`/opt/depot_tools${path.delimiter}/usr/bin`);
    expect(child.SystemRoot).toBe('C:\\Windows');
  });

  it('does not repeat a directory that is already on PATH', () => {
    const first = withPathPrefix({ PATH: '/usr/bin' }, '/opt/tools');
    const second = withPathPrefix(first, '/opt/tools');
    expect(second.PATH).toBe(first.PATH);
    expect(second.PATH).toBe(`/opt/tools${path.delimiter}/usr/bin`);
  });

  it('ignores empty and missing directory arguments', () => {
    expect(withPathPrefix({ PATH: '/usr/bin' }).PATH).toBe('/usr/bin');
    expect(withPathPrefix({}, '/opt/tools').PATH).toBe('/opt/tools');
  });

  it('does not mutate the environment it was given', () => {
    const env = { Path: '/usr/bin' };
    withPathPrefix(env, '/opt/tools');
    expect(env).toEqual({ Path: '/usr/bin' });
  });
});

describe('pre-sync tooling diagnostics', () => {
  it('reports git, where.exe, python, git.bat and the git PATH entries', () => {
    const dest = tempDirectory();
    const shim = ensureWindowsGitShim({
      dest,
      env: { PATH: RUNNER_PATH },
      platform: 'win32',
      spawn: windowsSpawn,
      exists: windowsExists,
    });
    const report = toolingDiagnostics({
      depotTools: path.join(dest, 'depot_tools'),
      // Build the PATH the way Windows will see it: ';' separated, shim first.
      env: { PATH: [shim.directory, ...RUNNER_PATH_ENTRIES].join(';') },
      platform: 'win32',
      windowsGit: shim,
      spawn: windowsSpawn,
      exists: (candidate) => existsSync(candidate) || windowsExists(candidate),
    });
    const text = report.lines.join('\n');
    expect(text).toContain('git: C:\\Program Files\\Git\\cmd\\git.exe');
    expect(text).toContain('where.exe git:');
    expect(text).toContain('python:');
    expect(text).toContain('PATH entries containing "git":');
    // The shim is on PATH, so git.bat is no longer reported as missing.
    expect(text).toContain(shim.gitBat);
    expect(text).not.toContain('NOT RESOLVABLE');
    // The gclient entry point does not exist yet in this fixture.
    expect(report.problems.join('; ')).toContain(
      'gclient entry point is missing',
    );
  });

  it('fails with a named problem when git is missing', () => {
    const report = toolingDiagnostics({
      env: { PATH: 'C:\\Windows\\System32' },
      platform: 'win32',
      spawn: () => ({ error: undefined, status: 1, stdout: '', stderr: '' }),
      exists: () => false,
    });
    expect(report.lines).toContain('git: NOT FOUND');
    expect(report.problems.join('; ')).toMatch(/git\.exe/);
  });

  it('never reports a credential that happens to be in the environment', () => {
    const dest = tempDirectory();
    // A deliberately fake, token-shaped value, assembled at runtime so this
    // fixture does not itself trip the repository secret scanner.
    const secret = ['ghp', '0123456789abcdefghijklmnopqrstuvwxyz'].join('_');
    const report = toolingDiagnostics({
      depotTools: dest,
      env: {
        PATH: `/usr/bin${path.delimiter}/opt/git-cmd`,
        GITHUB_TOKEN: secret,
        GIT_ASKPASS: secret,
        DEPOT_TOOLS_AUTH: secret,
      },
      platform: 'linux',
      spawn: spawnSync,
      exists: existsSync,
    });
    for (const line of report.lines) {
      expect(line).not.toContain(secret);
    }
    // PATH entries whose name mentions git are reported - that is exactly
    // what the diagnostics are for - but only as paths, never as values of
    // the credential variables above.
    expect(report.lines.join('\n')).toContain('/opt/git-cmd');
  });
});
