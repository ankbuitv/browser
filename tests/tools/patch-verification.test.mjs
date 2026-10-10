import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, REPO_ROOT } from '../../tools/chromium/lib/config.mjs';
import {
  verifyOffline,
  verifyOnline,
} from '../../tools/chromium/verify-patches.mjs';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'aurelia-metadata-test-'));
  roots.push(root);
  const config = structuredClone(loadConfig());
  for (const key of ['directory', 'verificationDirectory']) {
    const destination = path.join(root, key);
    cpSync(path.join(REPO_ROOT, config.patchSet[key]), destination, {
      recursive: true,
    });
    config.patchSet[key] = path.relative(REPO_ROOT, destination);
  }
  return { config, root };
}
describe('patch verification fails closed', () => {
  it('rejects a missing upstream digest record', () => {
    const { config, root } = fixture();
    const file = path.join(root, 'verificationDirectory/pre-images.json');
    const record = JSON.parse(readFileSync(file, 'utf8'));
    record.preImages.pop();
    writeFileSync(file, JSON.stringify(record));
    expect(verifyOffline(config).ok).toBe(false);
  });

  it('rejects malformed metadata digests before any online fetch', () => {
    const { config, root } = fixture();
    const file = path.join(
      root,
      'directory/0001-aurelia-webui-and-resources.meta.json',
    );
    const meta = JSON.parse(readFileSync(file, 'utf8'));
    meta.files[0].postImageSha256 = 'invalid';
    writeFileSync(file, JSON.stringify(meta));
    const offline = verifyOffline(config);
    expect(offline.ok).toBe(false);
    expect(verifyOnline({ config })).toEqual(offline);
  });
});
