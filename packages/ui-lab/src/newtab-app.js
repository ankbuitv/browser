// Copyright 2026 The Aurelia Authors
// Use of this source code is governed by the Mozilla Public License, v. 2.0,
// that can be found in the LICENSE file at the repository root.

/**
 * `<aurelia-newtab>` - The new tab page for Aurelia Browser.
 *
 * UI Lab version - for development harness only.
 * This is NOT the browser - it's a preview harness.
 *
 * STATUS: SCAFFOLDED - WebUI component for UI Lab testing.
 */
export class AureliaNewTabElement extends HTMLElement {
  static get is() {
    return 'aurelia-newtab';
  }

  searchInput = null;

  connectedCallback() {
    if (this.hasAttribute('data-rendered')) {
      return;
    }
    this.setAttribute('data-rendered', 'true');
    this.render();
    this.setupKeyboard();
  }

  render() {
    const container = document.createElement('div');
    container.className = 'newtab-container';

    const wallpaper = document.createElement('div');
    wallpaper.className = 'newtab-wallpaper';
    wallpaper.setAttribute('aria-hidden', 'true');
    container.appendChild(wallpaper);

    const main = document.createElement('main');
    main.className = 'newtab-main';

    const logoArea = document.createElement('div');
    logoArea.className = 'newtab-logo-area';

    const logo = document.createElement('div');
    logo.className = 'newtab-logo';
    logo.setAttribute('aria-label', 'Aurelia - UI Lab Preview');
    logoArea.appendChild(logo);

    main.appendChild(logoArea);

    const searchForm = document.createElement('form');
    searchForm.className = 'newtab-search-form';
    searchForm.setAttribute('role', 'search');
    searchForm.addEventListener('submit', (e) => this.handleSearch(e));

    const searchWrapper = document.createElement('div');
    searchWrapper.className = 'newtab-search-wrapper';

    const searchIcon = document.createElement('span');
    searchIcon.className = 'newtab-search-icon';
    searchIcon.setAttribute('aria-hidden', 'true');
    searchIcon.textContent = '\ud83d\udd0d';
    searchWrapper.appendChild(searchIcon);

    this.searchInput = document.createElement('input');
    this.searchInput.type = 'text';
    this.searchInput.className = 'newtab-search-input';
    this.searchInput.placeholder = 'Search or enter address';
    this.searchInput.setAttribute('aria-label', 'Search or enter address');
    this.searchInput.setAttribute('autofocus', 'true');
    this.searchInput.setAttribute('spellcheck', 'false');
    this.searchInput.setAttribute('autocomplete', 'off');
    this.searchInput.addEventListener('keydown', (e) => this.handleKeydown(e));
    searchWrapper.appendChild(this.searchInput);

    const searchButton = document.createElement('button');
    searchButton.type = 'submit';
    searchButton.className = 'newtab-search-button';
    searchButton.setAttribute('aria-label', 'Search');
    searchButton.textContent = '\ud83d\udd0d';
    searchWrapper.appendChild(searchButton);

    searchForm.appendChild(searchWrapper);
    main.appendChild(searchForm);

    const quickActions = document.createElement('div');
    quickActions.className = 'newtab-quick-actions';

    const paletteHint = document.createElement('button');
    paletteHint.type = 'button';
    paletteHint.className = 'newtab-quick-action';
    paletteHint.textContent = 'Open Command Palette';
    paletteHint.setAttribute(
      'aria-label',
      'Press Ctrl+K to open command palette',
    );
    paletteHint.addEventListener('click', () => this.openCommandPalette());

    const kbd = document.createElement('kbd');
    kbd.className = 'newtab-kbd';
    kbd.textContent = 'Ctrl+K';
    paletteHint.appendChild(kbd);

    quickActions.appendChild(paletteHint);
    main.appendChild(quickActions);

    container.appendChild(main);
    this.appendChild(container);

    requestAnimationFrame(() => {
      this.searchInput?.focus();
    });
  }

  setupKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (
        e.ctrlKey &&
        e.key === 'k' &&
        !e.altKey &&
        !e.metaKey &&
        !e.shiftKey
      ) {
        e.preventDefault();
        this.openCommandPalette();
      }

      if (e.key === 'Escape' && document.activeElement === this.searchInput) {
        if (this.searchInput) {
          this.searchInput.value = '';
        }
      }
    });
  }

  handleSearch(e) {
    e.preventDefault();
    const query = this.searchInput?.value.trim();
    if (!query) {
      return;
    }
    this.navigate(query);
  }

  handleKeydown(e) {
    if (e.key === 'ArrowDown') {
      // SCAFFOLDED: suggestions not implemented in UI Lab
    }
    if (e.key === 'ArrowUp') {
      // SCAFFOLDED: suggestions not implemented in UI Lab
    }
  }

  navigate(query) {
    let url = query;
    const isSearch =
      !url.startsWith('http://') &&
      !url.startsWith('https://') &&
      !url.startsWith('file://') &&
      !url.startsWith('ftp://') &&
      url.includes(' ');

    if (isSearch) {
      url = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
    } else if (
      !url.startsWith('http://') &&
      !url.startsWith('https://') &&
      !url.startsWith('file://') &&
      !url.startsWith('ftp://')
    ) {
      url = `https://${url.startsWith('www.') ? url : `www.${url}`}`;
    }

    // UI Lab: just log, don't actually navigate
    console.log('UI Lab: Navigate to:', url);
  }

  openCommandPalette() {
    // UI Lab: open the command palette preview
    const palette = document.createElement('aurelia-command-palette');
    palette.setAttribute('id', 'ui-lab-command-palette');
    document.body.appendChild(palette);

    // Wait for element to be defined and rendered
    setTimeout(() => {
      const cp = document.getElementById('ui-lab-command-palette');
      if (cp && typeof cp.open === 'function') {
        cp.open();
      }
    }, 50);
  }
}

customElements.define(AureliaNewTabElement.is, AureliaNewTabElement);
