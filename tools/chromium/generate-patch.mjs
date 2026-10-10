/**
 * Regenerate `chromium/patches/*.patch` from the pinned upstream pre-images.
 *
 * Why generate instead of hand-editing diffs: a hand-edited patch can silently
 * drift away from the revision it claims to target. Here the pre-images are
 * fetched at the exact pinned commit, the declarative edits in
 * `tools/chromium/lib/upstream-edits.mjs` are applied, and `git diff` produces
 * the canonical patch. Pre-image and post-image digests are recorded so the
 * result can be re-verified later, offline.
 *
 * Usage:
 *   node tools/chromium/generate-patch.mjs [--checkout <chromium-checkout>]
 */
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { loadConfig, patchesDir, verificationDir } from './lib/config.mjs';
import { UPSTREAM_EDITS, summariseEdits } from './lib/upstream-edits.mjs';
import {
  extractPreImages,
  makeScratchDir,
  run,
  sha256,
} from './lib/upstream.mjs';
import { parsePatch, findPathProblems } from './lib/patch.mjs';
import { isMainModule } from '../lib/entry.mjs';

export const PATCH_FILE_NAME = '0001-aurelia-webui-and-resources.patch';

/** Apply the declarative edits to an in-memory file map. */
export function applyEdits(fileMap, edits = UPSTREAM_EDITS) {
  const result = new Map();
  const applied = [];
  for (const edit of edits) {
    const current = result.get(edit.path) ?? fileMap.get(edit.path);
    if (current === undefined) {
      throw new Error(`edit targets a file that was not fetched: ${edit.path}`);
    }
    const occurrences = current.split(edit.find).length - 1;
    if (occurrences === 0) {
      throw new Error(
        `anchor not found in ${edit.path} (upstream moved; rebase needed):\n${edit.find}`,
      );
    }
    if (occurrences > 1) {
      throw new Error(
        `anchor is ambiguous in ${edit.path} (${occurrences} matches); widen the anchor:\n${edit.find}`,
      );
    }
    const next = current.replace(edit.find, edit.replace);
    result.set(edit.path, next);
    applied.push({ path: edit.path, reason: edit.reason });
  }
  return { files: result, applied };
}

export function generatePatch({ checkoutPath, log = () => {} } = {}) {
  const config = loadConfig();
  const edits = UPSTREAM_EDITS;
  const paths = [...new Set(edits.map((edit) => edit.path))];

  const scratch = makeScratchDir();
  log(`scratch: ${scratch}`);
  log(`pinned revision: ${config.chromium.revision} (${config.chromium.version})`);

  const preImageDir = path.join(scratch, 'pre');
  mkdirSync(preImageDir, { recursive: true });
  const extracted = extractPreImages({
    config,
    paths,
    destinationDir: preImageDir,
    transport: checkoutPath === undefined ? 'api' : 'git',
    checkoutPath,
  });
  log(`fetched ${extracted.entries.length} pre-image file(s) via ${extracted.transport}`);

  const preImages = new Map();
  for (const entry of extracted.entries) {
    preImages.set(entry.path, readFileSync(path.join(preImageDir, entry.path), 'utf8'));
  }

  const { files: postImages } = applyEdits(preImages, edits);


  // Use a throwaway git repository so `git diff` emits a canonical patch with
  // a/ and b/ prefixes that `git apply -p1` accepts inside a Chromium checkout.
  const repoDir = path.join(scratch, 'repo');
  mkdirSync(repoDir, { recursive: true });
  run('git', ['init', '--quiet', repoDir]);
  run('git', ['-C', repoDir, 'config', 'user.email', 'bot@aurelia.invalid']);
  run('git', ['-C', repoDir, 'config', 'user.name', 'Aurelia Bot']);
  run('git', ['-C', repoDir, 'config', 'core.autocrlf', 'false']);

  for (const [filePath, contents] of preImages) {
    const destination = path.join(repoDir, filePath);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, contents);
  }
  run('git', ['-C', repoDir, 'add', '--all']);
  run('git', ['-C', repoDir, 'commit', '--quiet', '--message', 'pre-image']);

  for (const [filePath, contents] of postImages) {
    writeFileSync(path.join(repoDir, filePath), contents);
  }
  run('git', ['-C', repoDir, 'add', '--all']);

  const patchText = run('git', [
    '-C',
    repoDir,
    'diff',
    '--cached',
    '--no-color',
    '--no-ext-diff',
    '--unified=3',
    '--src-prefix=a/',
    '--dst-prefix=b/',
  ]);

  const parsed = parsePatch(patchText);
  const pathProblems = findPathProblems(parsed);
  if (pathProblems.length > 0) {
    throw new Error(`refusing to write patch:\n- ${pathProblems.join('\n- ')}`);
  }

  const patchDir = patchesDir(config);
  mkdirSync(patchDir, { recursive: true });
  const patchPath = path.join(patchDir, PATCH_FILE_NAME);
  writeFileSync(patchPath, patchText);

  const postDigests = new Map();
  for (const [filePath, contents] of postImages) {
    postDigests.set(filePath, sha256(Buffer.from(contents, 'utf8')));
  }
  const preDigests = new Map(
    extracted.entries.map((entry) => [entry.path, entry.sha256]),
  );

  const meta = {
    patch: PATCH_FILE_NAME,
    title: 'Register the Aurelia status and isolated New Tab WebUIs and resources',
    description:
      'Adds Aurelia\'s own WebUI surface to a pinned Chromium tree. All new code lives in chromium/overlay/; this patch only wires it into existing upstream build files, the WebUI config registry, URL constants, GRIT ID allocation and browser repacking.',
    patchSetVersion: config.patchSet.version,
    baseRevision: config.chromium.revision,
    baseVersion: config.chromium.version,
    sha256: sha256(Buffer.from(patchText, 'utf8')),
    generatedBy: 'tools/chromium/generate-patch.mjs',
    summary: {
      filesModified: parsed.files.length,
      linesAdded: parsed.addedLines,
      linesRemoved: parsed.removedLines,
      hunks: parsed.files.reduce((total, file) => total + file.hunks, 0),
    },
    files: parsed.files.map((file) => {
      const edit = edits.find((candidate) => candidate.path === file.newPath);
      const preDigest = preDigests.get(file.newPath) ?? null;
      const postDigest = postDigests.get(file.newPath) ?? null;
      return {
        path: file.newPath,
        added: file.added,
        removed: file.removed,
        hunks: file.hunks,
        component: edit?.component ?? 'unknown',
        reason: edit?.reason ?? '',
        rebaseDifficulty: edit?.rebaseDifficulty ?? 'unknown',
        couldBecomeOverlay: edit?.couldBecomeOverlay ?? false,
        upstreamable: edit?.upstreamable ?? 'unknown',
        preImageSha256: preDigest,
        postImageSha256: postDigest,
      };
    }),
  };

  const metaPath = path.join(patchDir, `${PATCH_FILE_NAME.replace(/\.patch$/, '')}.meta.json`);
  writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);

  // Record pre-image digests so patches can be audited and re-verified without
  // network access, and so a tampered patch is detectable.
  const verification = {
    baseRevision: config.chromium.revision,
    baseVersion: config.chromium.version,
    upstreamRepository: config.chromium.upstreamRepository,
    recordedAt: new Date().toISOString().slice(0, 10),
    note: 'Digests of the untouched upstream pre-images each patch expects. Records both sides of every change so patch verification is possible offline.',
    preImages: extracted.entries
      .map((entry) => ({ path: entry.path, bytes: entry.bytes, sha256: entry.sha256 }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    postImages: [...postDigests.entries()]
      .map(([filePath, digest]) => ({ path: filePath, sha256: digest }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
  const verificationPath = path.join(verificationDir(config), 'pre-images.json');
  mkdirSync(path.dirname(verificationPath), { recursive: true });
  writeFileSync(verificationPath, `${JSON.stringify(verification, null, 2)}\n`);

  rmSync(scratch, { recursive: true, force: true });

  return {
    patchPath,
    metaPath,
    verificationPath,
    meta,
    summary: summariseEdits(edits),
  };
}

const isMain = isMainModule(import.meta.url);

if (isMain) {
  const checkoutIndex = process.argv.indexOf('--checkout');
  const checkoutPath =
    checkoutIndex === -1 ? undefined : process.argv[checkoutIndex + 1];
  try {
    const result = generatePatch({ checkoutPath, log: console.log });
    console.log(`wrote ${path.relative(process.cwd(), result.patchPath)}`);
    console.log(`wrote ${path.relative(process.cwd(), result.metaPath)}`);
    console.log(
      `delta: ${result.meta.summary.filesModified} file(s), +${result.meta.summary.linesAdded}/-${result.meta.summary.linesRemoved}`,
    );
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  }
}
