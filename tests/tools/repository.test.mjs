/**
 * Repository-level invariants. These run against the real checked-in files, so
 * they fail the moment the pin, the patch set, the overlay or the workflows
 * drift apart.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  loadConfig,
  overlayDir,
  patchesDir,
  verificationDir,
} from '../../tools/chromium/lib/config.mjs';
import {
  collectOverlayFiles,
  listPatchFiles,
  verifyOffline,
} from '../../tools/chromium/verify-patches.mjs';
import { generateVersionHeader } from '../../tools/chromium/lib/version-header.mjs';
import { generate as generateTokens } from '../../tools/design/generate-tokens.mjs';
import { checkWorkflows } from '../../tools/ci/workflow-policy.mjs';
import { scanRepository } from '../../tools/ci/secret-scan.mjs';
import { runFastChecks } from '../../tools/ci/fast-checks.mjs';

const config = loadConfig();

describe('patch set', () => {
  it('verifies offline', () => {
    const result = verifyOffline(config);
    const failures = result.checks.filter((check) => !check.ok);
    expect(
      failures.map((failure) => `${failure.name}: ${failure.details}`),
    ).toEqual([]);
  });

  it('has metadata for every patch', () => {
    const patches = listPatchFiles(patchesDir(config));
    expect(patches.length).toBeGreaterThan(0);
    for (const patchName of patches) {
      const metaPath = path.join(
        patchesDir(config),
        patchName.replace(/\.patch$/, '.meta.json'),
      );
      expect(existsSync(metaPath)).toBe(true);
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      expect(meta.baseRevision).toBe(config.chromium.revision);
      expect(meta.summary.filesModified).toBeLessThanOrEqual(6);
      expect(meta.summary.linesAdded).toBeLessThanOrEqual(10);
    }
  });

  it('records both sides of every change for offline auditing', () => {
    const recordPath = path.join(verificationDir(config), 'pre-images.json');
    const record = JSON.parse(readFileSync(recordPath, 'utf8'));
    expect(record.baseRevision).toBe(config.chromium.revision);
    expect(record.preImages.length).toBeGreaterThan(0);
    expect(record.postImages.length).toBe(record.preImages.length);
    for (const entry of [...record.preImages, ...record.postImages]) {
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe('Chromium overlay', () => {
  const files = collectOverlayFiles(overlayDir(config));

  it('contains the WebUI controller and its resources', () => {
    const paths = files.map((file) => file.path);
    expect(paths).toContain('chrome/browser/ui/webui/aurelia/aurelia_ui.cc');
    expect(paths).toContain('chrome/browser/ui/webui/aurelia/aurelia_ui.h');
    expect(paths).toContain('chrome/browser/ui/webui/aurelia/BUILD.gn');
    expect(paths).toContain('chrome/browser/resources/aurelia/aurelia.html');
    expect(paths).toContain('chrome/browser/resources/aurelia/BUILD.gn');
  });

  it('never declares a Node.js runtime dependency', () => {
    const forbidden = [
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'node_modules',
    ];
    for (const file of files) {
      for (const name of forbidden) {
        expect(file.path.includes(name)).toBe(false);
      }
    }
  });

  it('uses the aurora-style generated resources consistently', () => {
    const gn = readFileSync(
      path.join(
        overlayDir(config),
        'chrome/browser/resources/aurelia/BUILD.gn',
      ),
      'utf8',
    );
    expect(gn).toContain('grd_prefix = "aurelia"');
    expect(gn).toContain('build_webui("build")');
    const ui = readFileSync(
      path.join(
        overlayDir(config),
        'chrome/browser/ui/webui/aurelia/aurelia_ui.cc',
      ),
      'utf8',
    );
    expect(ui).toContain('#include "chrome/grit/aurelia_resources.h"');
    expect(ui).toContain('IDR_AURELIA_AURELIA_HTML');
    expect(ui).toContain('webui::SetupWebUIDataSource');
  });

  it('never disables a Chromium security mechanism', () => {
    const patterns = [
      /--no-sandbox/,
      /disable[-_]site[-_]isolation/i,
      /allow[-_]running[-_]insecure[-_]content/i,
      /ignore[-_]certificate[-_]errors/i,
      /setIgnoreCertificateErrors/,
    ];
    for (const file of files) {
      const contents = readFileSync(
        path.join(overlayDir(config), file.path),
        'utf8',
      );
      for (const pattern of patterns) {
        expect(contents).not.toMatch(pattern);
      }
    }
  });
});

describe('generated files', () => {
  it('has an up-to-date version header', () => {
    expect(() => generateVersionHeader({ check: true, config })).not.toThrow();
  });

  it('has up-to-date design tokens', () => {
    expect(() => generateTokens({ check: true, log: () => {} })).not.toThrow();
  });

  it('centralises the NextDNS product endpoint in one module', () => {
    // Owner directive: the endpoint is a public product configuration value,
    // but it must not be duplicated across the source tree. Code (not docs)
    // may reference it only from the secure DNS policy module.
    const hits = scanCodeFor('cf9c1d');
    expect(hits.length).toBeGreaterThan(0);
    const unexpected = hits.filter(
      (file) => !/secure[-_]dns/.test(path.basename(file)),
    );
    expect(unexpected).toEqual([]);
  });
});

/**
 * Walk Aurelia-owned source directories and return the repository-relative
 * paths of files containing `needle`.
 */
function scanCodeFor(needle) {
  const roots = ['packages', 'tools', 'chromium/overlay', 'config'];
  const extensions = new Set([
    '.ts',
    '.mjs',
    '.js',
    '.cc',
    '.h',
    '.gn',
    '.json',
    '.css',
    '.html',
  ]);
  const hits = [];

  const walk = (absolute) => {
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const full = path.join(absolute, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'generated')
          continue;
        walk(full);
        continue;
      }
      if (!extensions.has(path.extname(entry.name))) continue;
      if (readFileSync(full, 'utf8').includes(needle)) {
        hits.push(
          path.relative(path.resolve(import.meta.dirname, '../..'), full),
        );
      }
    }
  };

  for (const root of roots) {
    const absolute = path.resolve(import.meta.dirname, '../..', root);
    if (existsSync(absolute)) walk(absolute);
  }
  return hits;
}

describe('.gitignore', () => {
  it('never ignores Aurelia-owned source, tooling or overlay', () => {
    // Regression guard: an unanchored `chromium/` pattern once hid this
    // project's own `chromium/` overlay and `tools/chromium/` tooling from Git.
    // A pattern that hides the fork tooling would be discovered far too late.
    const critical = [
      'config/chromium_version.json',
      'tools/chromium/cli.mjs',
      'tools/chromium/lib/config.mjs',
      'chromium/patches/0001-aurelia-webui-and-resources.patch',
      'chromium/verification/pre-images.json',
      'chromium/overlay/chrome/browser/ui/webui/aurelia/aurelia_ui.cc',
      'chromium/overlay/chrome/browser/resources/aurelia/aurelia.html',
      'docs/FORK-DELTA.md',
      'packages/core/src/url/classify.ts',
    ];
    const ignored = critical.filter((relativePath) =>
      isGitIgnored(relativePath),
    );
    expect(ignored).toEqual([]);
  });
});

/** True when `git check-ignore` reports the path as ignored. */
function isGitIgnored(
  relativePath,
  root = path.resolve(import.meta.dirname, '../..'),
) {
  try {
    execFileSync('git', ['-C', root, 'check-ignore', '--quiet', relativePath], {
      stdio: 'pipe',
    });
    return true;
  } catch (error) {
    // Exit code 1 means "not ignored"; anything else is a real failure.
    if (error.status === 1) return false;
    throw error;
  }
}

describe('workflows', () => {
  it('satisfies the supply-chain policy', () => {
    const { problems, workflowCount } = checkWorkflows();
    expect(workflowCount).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });
});

describe('secret scan', () => {
  it('finds no credentials in tracked files', () => {
    expect(scanRepository()).toEqual([]);
  });
});

describe('fast checks', () => {
  it('all pass', () => {
    const result = runFastChecks({ log: () => {} });
    const failures = result.checks.filter((check) => !check.ok);
    expect(
      failures.map((failure) => `${failure.name}: ${failure.details}`),
    ).toEqual([]);
  });
});
