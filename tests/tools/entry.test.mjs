/**
 * The entry-point guard.
 *
 * Every command-line tool in `tools/` has to decide whether it was imported or
 * run directly. The naive idiom
 *
 *   import.meta.url === `file://${path.resolve(process.argv[1])}`
 *
 * is wrong on Windows (``file://D:\...`` vs ``file:///D:/...``), so the tool
 * silently does nothing and exits 0. Both of the first two hosted Windows
 * experiment runs failed exactly this way. These tests keep the idiom out of
 * the repository and pin down the helper's behaviour.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { isMainModule } from '../../tools/lib/entry.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

/** Every Aurelia-owned JavaScript/TypeScript source file under `tools/`. */
function toolSources() {
  const files = [];
  const walk = (absolute) => {
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const full = path.join(absolute, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        walk(full);
        continue;
      }
      if (entry.name.endsWith('.mjs') || entry.name.endsWith('.js')) {
        files.push(full);
      }
    }
  };
  walk(path.join(REPO_ROOT, 'tools'));
  return files;
}

describe('entry point detection', () => {
  it('matches when the module is the process entry point', () => {
    const tool = path.join(REPO_ROOT, 'tools', 'ci', 'check-builder.mjs');
    expect(isMainModule(pathToFileURL(tool).href, tool)).toBe(true);
  });

  it('does not match when the paths differ', () => {
    const tool = path.join(REPO_ROOT, 'tools', 'ci', 'check-builder.mjs');
    expect(isMainModule('file:///somewhere/else.mjs', tool)).toBe(false);
  });

  it('handles paths a URL encodes, which the naive idiom does not', () => {
    // `path.resolve` leaves this space untouched, so the naive template string
    // produces `file:///tmp/a b.mjs` while Node's `import.meta.url` is
    // `file:///tmp/a%20b.mjs`. The helper compares through `pathToFileURL`.
    const spaced = path.join(REPO_ROOT, 'tools', 'ci', 'with space.mjs');
    expect(isMainModule(pathToFileURL(spaced).href, spaced)).toBe(true);
  });

  it('is inert without a usable argv[1]', () => {
    expect(isMainModule(import.meta.url, undefined)).toBe(false);
    expect(isMainModule(import.meta.url, '')).toBe(false);
    expect(isMainModule(import.meta.url, 42)).toBe(false);
    expect(isMainModule(undefined, '/tmp/x.mjs')).toBe(false);
  });

  it('is not fooled by the naive Windows comparison', () => {
    // Documents the failure mode: on Windows the naive template string and
    // `pathToFileURL` disagree, which is why the helper exists. `path.win32`
    // gives the Windows spelling on any platform.
    const windowsPath = path.win32.resolve(
      'D:\\a\\browser\\browser\\tools\\ci\\check-builder.mjs',
    );
    const naive = `file://${windowsPath}`;
    const correct = 'file:///D:/a/browser/browser/tools/ci/check-builder.mjs';
    expect(correct).not.toBe(naive);
    expect(naive.startsWith('file://D:')).toBe(true);
  });

  it('reports itself as the entry point when actually run', () => {
    // Spawn a real tool and prove the guarded body executes: a silent no-op
    // run is the exact symptom this file exists to prevent.
    const result = spawnSync(
      process.execPath,
      ['tools/ci/check-builder.mjs', '--help'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('--record <file>');
  });
});

describe('tool entry guards', () => {
  it('never uses the naive file URL comparison', () => {
    // `tools/lib/entry.mjs` documents the broken idiom in a comment on
    // purpose; every other file must be free of it.
    const helper = path.join(REPO_ROOT, 'tools', 'lib', 'entry.mjs');
    const offenders = toolSources()
      .filter((file) => file !== helper)
      .filter((file) =>
        readFileSync(file, 'utf8').includes('import.meta.url === `file://'),
      )
      .map((file) => path.relative(REPO_ROOT, file));
    expect(offenders).toEqual([]);
  });

  it('routes every entry guard through tools/lib/entry.mjs', () => {
    const helper = path.join(REPO_ROOT, 'tools', 'lib', 'entry.mjs');
    const guarded = toolSources().filter(
      (file) =>
        file !== helper && readFileSync(file, 'utf8').includes('isMainModule('),
    );
    expect(guarded.length).toBeGreaterThanOrEqual(15);
    const withoutImport = guarded
      .filter(
        (file) =>
          !readFileSync(file, 'utf8').includes("from '../lib/entry.mjs'") &&
          !readFileSync(file, 'utf8').includes("from '../../tools/lib/entry"),
      )
      .map((file) => path.relative(REPO_ROOT, file));
    expect(withoutImport).toEqual([]);
  });
});
