// @vitest-environment jsdom
// Regression test for a confirmed defect: the Command Palette was bundled into
// chrome://aurelia but never mounted, so its JS and CSS never ran on the page.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { REPO_ROOT } from '../../tools/chromium/lib/config.mjs';

const OVERLAY = path.join(
  REPO_ROOT,
  'chromium/overlay/chrome/browser/resources/aurelia',
);
const read = (file) => readFileSync(path.join(OVERLAY, file), 'utf8');

vi.mock('//resources/js/load_time_data.js', () => ({
  loadTimeData: { valueExists: () => false, getString: () => '' },
}));

// Import once: custom elements can only be registered a single time per realm.
beforeAll(async () => {
  await import('../../chromium/overlay/chrome/browser/resources/aurelia/aurelia_app.ts');
});

afterEach(() => {
  document.body.replaceChildren();
  document.head.replaceChildren();
});

describe('chrome://aurelia page wiring', () => {
  it('links the command palette stylesheet from the page', () => {
    expect(read('aurelia.html')).toMatch(
      /<link rel="stylesheet" href="command_palette\.css">/,
    );
  });

  it('declares the palette stylesheet and script in the GN resource lists', () => {
    const gn = read('BUILD.gn');
    expect(gn).toMatch(/"command_palette\.css"/);
    expect(gn).toMatch(/"command_palette\.ts"/);
  });

  it('mounts the palette and opens it with Ctrl+K', async () => {
    const app = document.createElement('aurelia-app');
    document.body.appendChild(app);

    const palette = app.querySelector('aurelia-command-palette');
    expect(palette).not.toBeNull();
    expect(palette.classList.contains('open')).toBe(false);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }),
    );
    expect(palette.classList.contains('open')).toBe(true);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }),
    );
    expect(palette.classList.contains('open')).toBe(false);
  });

  it('opens the palette from the visible opener button', async () => {
    const app = document.createElement('aurelia-app');
    document.body.appendChild(app);
    app.querySelector('#aurelia-open-palette').click();
    expect(
      app.querySelector('aurelia-command-palette').classList.contains('open'),
    ).toBe(true);
  });
});
