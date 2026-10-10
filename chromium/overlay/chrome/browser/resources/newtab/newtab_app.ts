// Copyright 2026 The Aurelia Authors
// Use of this source code is governed by the Mozilla Public License, v. 2.0,
// that can be found in the LICENSE file at the repository root.

/**
 * `<aurelia-newtab>` - The new tab page for Aurelia Browser.
 *
 * Design principles:
 * - Minimal: No news, no ads, no AI, no unnecessary widgets
 * - Fast: No network requests, minimal JavaScript
 * - Clean: Centered search box, subtle wallpaper
 * - Accessible: Full keyboard navigation, high contrast support
 *
 * STATUS: SCAFFOLDED - WebUI component written, not compiled in Chromium yet.
 * Integration with browser process requires C++ controller and patch.
 */
export class AureliaNewTabElement extends HTMLElement {
  static get is() {
    return 'aurelia-newtab';
  }

  private searchInput: HTMLInputElement | null = null;

  connectedCallback(): void {
    if (this.hasAttribute('data-rendered')) {
      return;
    }
    this.setAttribute('data-rendered', 'true');
    this.render();
    this.setupKeyboard();
  }

  private render(): void {
    // Container
    const container = document.createElement('div');
    container.className = 'newtab-container';

    // Wallpaper background - subtle gradient
    const wallpaper = document.createElement('div');
    wallpaper.className = 'newtab-wallpaper';
    wallpaper.setAttribute('aria-hidden', 'true');
    container.appendChild(wallpaper);

    // Main content
    const main = document.createElement('main');
    main.className = 'newtab-main';

    // Logo/Icon area
    const logoArea = document.createElement('div');
    logoArea.className = 'newtab-logo-area';

    const logo = document.createElement('div');
    logo.className = 'newtab-logo';
    logo.setAttribute('aria-label', 'Aurelia');
    logoArea.appendChild(logo);

    main.appendChild(logoArea);

    // Search/URL input form
    const searchForm = document.createElement('form');
    searchForm.className = 'newtab-search-form';
    searchForm.setAttribute('role', 'search');
    searchForm.addEventListener('submit', (e) => this.handleSearch(e));

    const searchWrapper = document.createElement('div');
    searchWrapper.className = 'newtab-search-wrapper';

    const searchIcon = document.createElement('span');
    searchIcon.className = 'newtab-search-icon';
    searchIcon.setAttribute('aria-hidden', 'true');
    searchIcon.textContent = '🔍';
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
    searchButton.textContent = '🔍';
    searchWrapper.appendChild(searchButton);

    searchForm.appendChild(searchWrapper);
    main.appendChild(searchForm);

    // Quick actions
    const quickActions = document.createElement('div');
    quickActions.className = 'newtab-quick-actions';

    const paletteHint = document.createElement('button');
    paletteHint.type = 'button';
    paletteHint.className = 'newtab-quick-action';
    paletteHint.textContent = 'Open Command Palette';
    paletteHint.setAttribute('aria-label', 'Press Ctrl+K to open command palette');
    paletteHint.addEventListener('click', () => this.openCommandPalette());

    const kbd = document.createElement('kbd');
    kbd.className = 'newtab-kbd';
    kbd.textContent = 'Ctrl+K';
    paletteHint.appendChild(kbd);

    quickActions.appendChild(paletteHint);
    main.appendChild(quickActions);

    container.appendChild(main);
    this.appendChild(container);

    // Focus the search input after render
    requestAnimationFrame(() => {
      this.searchInput?.focus();
    });
  }

  private setupKeyboard(): void {
    // Global keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Ctrl+K - Open command palette (SCAFFOLDED: actual C++ integration needed)
      if (e.ctrlKey && e.key === 'k' && !e.altKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        this.openCommandPalette();
      }

      // Escape - Clear search if focused
      if (e.key === 'Escape' && document.activeElement === this.searchInput) {
        if (this.searchInput) {
          this.searchInput.value = '';
        }
      }
    });
  }

  private handleSearch(e: Event): void {
    e.preventDefault();
    const query = this.searchInput?.value.trim();
    if (!query) {
      return;
    }
    this.navigate(query);
  }

  private handleKeydown(e: KeyboardEvent): void {
    // Arrow Down - could open suggestions in future
    if (e.key === 'ArrowDown') {
      // SCAFFOLDED: suggestions dropdown not implemented
    }
    // Arrow Up
    if (e.key === 'ArrowUp') {
      // SCAFFOLDED: suggestions navigation not implemented
    }
  }

  private navigate(query: string): void {
    // Basic URL parsing
    let url = query;

    // Check if it's a search query (contains spaces, no protocol)
    const isSearch = !url.startsWith('http://') && 
                    !url.startsWith('https://') && 
                    !url.startsWith('file://') && 
                    !url.startsWith('ftp://') &&
                    url.includes(' ');

    if (isSearch) {
      // SCAFFOLDED: Use configurable search engine
      // For now, default to Google
      url = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
    } else if (!url.startsWith('http://') && 
               !url.startsWith('https://') &&
               !url.startsWith('file://') &&
               !url.startsWith('ftp://')) {
      // Assume it's a URL without protocol
      url = `https://${url.startsWith('www.') ? url : `www.${url}`}`;
    }

    // SCAFFOLDED: In real Chromium WebUI, this would use chrome.send() or Mojo
    // For now, use window.location as fallback in WebUI context
    // Actual integration requires C++ controller with navigation handler
    if (typeof window !== 'undefined') {
      window.location.href = url;
    }
  }

  private openCommandPalette(): void {
    // SCAFFOLDED: In real implementation, this would trigger C++ handler
    // to open the command palette modal from browser frame
    // For now, in WebUI context, we can only focus the search input
    this.searchInput?.focus();
    
    // In a full implementation with C++ integration:
    // chrome.send('openCommandPalette');
    // or use a Mojo interface call
  }
}

customElements.define(AureliaNewTabElement.is, AureliaNewTabElement);

declare global {
  interface HTMLElementTagNameMap {
    'aurelia-newtab': AureliaNewTabElement;
  }
}
