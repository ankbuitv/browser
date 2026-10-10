// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../chromium/overlay/chrome/browser/resources/aurelia/command_palette.ts';
import '../../chromium/overlay/chrome/browser/resources/aurelia/aurelia_status_card.ts';
import '../../chromium/overlay/chrome/browser/resources/newtab/newtab_app.ts';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
describe('standalone overlay elements (not Chromium runtime)', () => {
  it('registers and renders the status card', () => {
    const card = document.createElement('aurelia-status-card');
    card.setAttribute('heading', 'Build provenance');
    document.body.appendChild(card);
    expect(card.querySelector('h2')?.textContent).toBe('Build provenance');
  });

  it('renders the isolated new tab search form only once', () => {
    const tab = document.createElement('aurelia-newtab');
    document.body.appendChild(tab);
    expect(tab.querySelectorAll('form')).toHaveLength(1);
    tab.connectedCallback();
    expect(tab.querySelectorAll('form')).toHaveLength(1);
  });

  it('renders and filters the palette without an innerHTML sink', () => {
    vi.spyOn(Element.prototype, 'innerHTML', 'set').mockImplementation(() => {
      throw new Error('HTML sink prohibited');
    });
    const palette = document.createElement('aurelia-command-palette');
    document.body.appendChild(palette);
    palette.open();
    const input = palette.querySelector('input');
    expect(input).not.toBeNull();
    input.value = 'new';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(palette.querySelector('mark')?.textContent.toLowerCase()).toBe(
      'new',
    );
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(palette.classList.contains('open')).toBe(false);
  });
});
