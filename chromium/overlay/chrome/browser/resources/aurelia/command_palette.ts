// Copyright 2026 The Aurelia Authors
// Use of this source code is governed by the Mozilla Public License, v. 2.0,
// that can be found in the LICENSE file at the repository root.

/**
 * `<aurelia-command-palette>` - Command palette for Aurelia Browser.
 *
 * Features:
 * - Fuzzy matching search
 * - Keyboard navigation
 * - Multiple categories: tabs, bookmarks, history, settings, commands
 * - Minimal UI with glassmorphism
 * - Accessible
 *
 * STATUS: SCAFFOLDED - Component written, not integrated with C++ yet.
 * Privileged actions (tab switching, etc.) are marked as SCAFFOLDED.
 */

interface CommandResult {
  id: string;
  label: string;
  category: string;
  hint?: string;
  icon?: string;
  action: () => void;
}

export class AureliaCommandPaletteElement extends HTMLElement {
  static get is() {
    return 'aurelia-command-palette';
  }

  private input: HTMLInputElement | null = null;
  private resultsContainer: HTMLElement | null = null;
  private allResults: CommandResult[] = [];
  private filteredResults: CommandResult[] = [];
  private selectedIndex = -1;
  private isOpen = false;

  connectedCallback(): void {
    if (this.hasAttribute('data-rendered')) {
      return;
    }
    this.setAttribute('data-rendered', 'true');
    this.render();
    this.setupCommands();
  }

  disconnectedCallback(): void {
    this.isOpen = false;
    this.selectedIndex = -1;
  }

  /**
   * Open the command palette.
   * Called from C++ or from keyboard shortcut.
   */
  open(): void {
    if (this.isOpen) {
      return;
    }
    this.isOpen = true;
    this.classList.add('open');
    this.input?.focus();
    this.filter('');
    this.selectedIndex = -1;
    this.dispatchEvent(new CustomEvent('aurelia-command-palette-open'));
  }

  /**
   * Close the command palette.
   */
  close(): void {
    if (!this.isOpen) {
      return;
    }
    this.isOpen = false;
    this.classList.remove('open');
    this.filteredResults = [];
    this.renderResults();
    this.selectedIndex = -1;

    const opener = this.getAttribute('data-opener');
    if (opener) {
      const openerElement = document.getElementById(opener);
      openerElement?.focus();
    }

    this.dispatchEvent(new CustomEvent('aurelia-command-palette-close'));
  }

  /**
   * Toggle the command palette.
   */
  toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  private render(): void {
    this.classList.add('aurelia-command-palette');
    this.setAttribute('role', 'dialog');
    this.setAttribute('aria-modal', 'true');
    this.setAttribute('aria-label', 'Command Palette');

    // Overlay (click to close)
    const overlay = document.createElement('div');
    overlay.className = 'aurelia-cp-overlay';
    overlay.addEventListener('click', () => this.close());
    this.appendChild(overlay);

    // Modal container
    const container = document.createElement('div');
    container.className = 'aurelia-cp-container';

    // Header with input
    const header = document.createElement('div');
    header.className = 'aurelia-cp-header';

    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'aurelia-cp-input-wrapper';

    const searchIcon = document.createElement('span');
    searchIcon.className = 'aurelia-cp-search-icon';
    searchIcon.setAttribute('aria-hidden', 'true');
    searchIcon.textContent = '🔍';
    inputWrapper.appendChild(searchIcon);

    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.className = 'aurelia-cp-input';
    this.input.placeholder = 'Type a command or search...';
    this.input.setAttribute('aria-label', 'Search commands');
    this.input.setAttribute('autofocus', 'true');
    this.input.setAttribute('spellcheck', 'false');
    this.input.setAttribute('autocomplete', 'off');
    this.input.addEventListener('input', (e) => this.handleInput(e));
    this.input.addEventListener('keydown', (e) => this.handleKeydown(e));
    inputWrapper.appendChild(this.input);

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'aurelia-cp-close-button';
    closeButton.setAttribute('aria-label', 'Close');
    closeButton.textContent = '✕';
    closeButton.addEventListener('click', () => this.close());
    inputWrapper.appendChild(closeButton);

    header.appendChild(inputWrapper);
    container.appendChild(header);

    // Results container
    this.resultsContainer = document.createElement('div');
    this.resultsContainer.className = 'aurelia-cp-results';
    this.resultsContainer.setAttribute('role', 'listbox');
    this.resultsContainer.setAttribute('aria-label', 'Command results');
    container.appendChild(this.resultsContainer);

    // Footer with hints
    const footer = document.createElement('div');
    footer.className = 'aurelia-cp-footer';

    const hint = document.createElement('span');
    hint.className = 'aurelia-cp-hint';
    hint.textContent = 'Press Tab to select, Esc to close';
    footer.appendChild(hint);

    container.appendChild(footer);
    this.appendChild(container);

    this.classList.remove('open');
  }

  private setupCommands(): void {
    // SCAFFOLDED: In real implementation, these would come from:
    // - Tab list (from browser process via Mojo)
    // - Bookmarks (from browser process via Mojo)
    // - History (from browser process via Mojo)
    // - Settings (from preferences)
    // - Browser commands (static list)
    //
    // For SCAFFOLDED state, we use a static list

    this.allResults = [
      // Browser commands
      {
        id: 'new-tab',
        label: 'New Tab',
        category: 'Commands',
        hint: 'Ctrl+T',
        icon: '📄',
        action: () => this.executeAction('new-tab'),
      },
      {
        id: 'new-window',
        label: 'New Window',
        category: 'Commands',
        hint: 'Ctrl+N',
        icon: '🪟',
        action: () => this.executeAction('new-window'),
      },
      {
        id: 'close-tab',
        label: 'Close Tab',
        category: 'Commands',
        hint: 'Ctrl+W',
        icon: '✕',
        action: () => this.executeAction('close-tab'),
      },
      {
        id: 'settings',
        label: 'Settings',
        category: 'Commands',
        hint: 'Open browser settings',
        icon: '⚙️',
        action: () => this.executeAction('settings'),
      },
      {
        id: 'history',
        label: 'History',
        category: 'Commands',
        hint: 'Open history page',
        icon: '🕒',
        action: () => this.executeAction('history'),
      },
      {
        id: 'downloads',
        label: 'Downloads',
        category: 'Commands',
        hint: 'Open downloads page',
        icon: '📥',
        action: () => this.executeAction('downloads'),
      },
      {
        id: 'bookmarks',
        label: 'Bookmarks',
        category: 'Commands',
        hint: 'Open bookmarks manager',
        icon: '🔖',
        action: () => this.executeAction('bookmarks'),
      },

      // Navigation
      {
        id: 'home',
        label: 'Home',
        category: 'Navigation',
        hint: 'Go to home page',
        icon: '🏠',
        action: () => this.executeAction('home'),
      },

      // Search
      {
        id: 'search-web',
        label: 'Search Web',
        category: 'Navigation',
        hint: 'Search the web',
        icon: '🔍',
        action: () => this.executeAction('search-web'),
      },
      {
        id: 'open-url',
        label: 'Open URL',
        category: 'Navigation',
        hint: 'Navigate to a URL',
        icon: '🌐',
        action: () => this.executeAction('open-url'),
      },

      // Appearance
      {
        id: 'theme-light',
        label: 'Light Theme',
        category: 'Appearance',
        hint: 'Switch to light theme',
        icon: '☀️',
        action: () => this.executeAction('theme-light'),
      },
      {
        id: 'theme-dark',
        label: 'Dark Theme',
        category: 'Appearance',
        hint: 'Switch to dark theme',
        icon: '🌙',
        action: () => this.executeAction('theme-dark'),
      },
      {
        id: 'theme-system',
        label: 'System Theme',
        category: 'Appearance',
        hint: 'Use system theme',
        icon: '🖥️',
        action: () => this.executeAction('theme-system'),
      },

      // Developer
      {
        id: 'devtools',
        label: 'Developer Tools',
        category: 'Developer',
        hint: 'Open DevTools',
        icon: '🛠️',
        action: () => this.executeAction('devtools'),
      },

      // Help
      {
        id: 'help',
        label: 'Help',
        category: 'Help',
        hint: 'Open help page',
        icon: '❓',
        action: () => this.executeAction('help'),
      },
      {
        id: 'about',
        label: 'About Aurelia',
        category: 'Help',
        hint: 'Show about page',
        icon: 'ℹ️',
        action: () => this.executeAction('about'),
      },
    ];
  }

  private handleInput(e: Event): void {
    const target = e.target as HTMLInputElement;
    this.filter(target.value);
  }

  private handleKeydown(e: KeyboardEvent): void {
    const items = this.querySelectorAll<HTMLElement>('.aurelia-cp-result');

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        this.close();
        break;

      case 'ArrowDown':
        e.preventDefault();
        this.selectedIndex = Math.min(this.selectedIndex + 1, items.length - 1);
        this.updateSelection();
        break;

      case 'ArrowUp':
        e.preventDefault();
        this.selectedIndex = Math.max(this.selectedIndex - 1, -1);
        this.updateSelection();
        break;

      case 'Tab':
        e.preventDefault();
        if (this.selectedIndex < items.length - 1) {
          this.selectedIndex++;
        } else {
          this.selectedIndex = 0;
        }
        this.updateSelection();
        break;

      case 'Enter':
        e.preventDefault();
        if (this.selectedIndex >= 0 && this.selectedIndex < this.filteredResults.length) {
          this.filteredResults[this.selectedIndex]?.action();
          this.close();
        } else if (this.input?.value.trim()) {
          if (this.filteredResults.length > 0) {
            this.filteredResults[0]?.action();
            this.close();
          } else {
            this.executeAction('search-web', this.input.value);
            this.close();
          }
        }
        break;

      default:
        break;
    }
  }

  private filter(query: string): void {
    const lowerQuery = query.toLowerCase();

    if (!lowerQuery) {
      this.filteredResults = [...this.allResults];
    } else {
      // Fuzzy matching
      this.filteredResults = this.allResults.filter(result => {
        const label = result.label.toLowerCase();
        const category = result.category.toLowerCase();
        const hint = result.hint?.toLowerCase() || '';

        return this.fuzzyMatch(lowerQuery, label) ||
               this.fuzzyMatch(lowerQuery, category) ||
               this.fuzzyMatch(lowerQuery, hint);
      });
    }

    // Sort by relevance
    this.filteredResults.sort((a, b) => {
      const aLabel = a.label.toLowerCase();
      const bLabel = b.label.toLowerCase();
      const query = lowerQuery;

      const aStartsWith = aLabel.startsWith(query);
      const bStartsWith = bLabel.startsWith(query);

      if (aStartsWith && !bStartsWith) return -1;
      if (!aStartsWith && bStartsWith) return 1;

      const aIncludes = aLabel.includes(query);
      const bIncludes = bLabel.includes(query);

      if (aIncludes && !bIncludes) return -1;
      if (!aIncludes && bIncludes) return 1;

      return aLabel.localeCompare(bLabel);
    });

    this.renderResults();
  }

  private fuzzyMatch(query: string, target: string): boolean {
    let queryIndex = 0;
    for (let i = 0; i < target.length && queryIndex < query.length; i++) {
      if (target[i] === query[queryIndex]) {
        queryIndex++;
      }
    }
    return queryIndex === query.length;
  }

  private renderResults(): void {
    if (!this.resultsContainer) {
      return;
    }

    this.resultsContainer.replaceChildren();

    if (this.filteredResults.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'aurelia-cp-empty';
      empty.textContent = this.input?.value ? 'No results found' : 'Start typing to search commands';
      empty.setAttribute('role', 'status');
      this.resultsContainer.appendChild(empty);
      this.selectedIndex = -1;
      return;
    }

    // Group by category
    const categories: Map<string, CommandResult[]> = new Map();
    for (const result of this.filteredResults) {
      if (!categories.has(result.category)) {
        categories.set(result.category, []);
      }
      categories.get(result.category)!.push(result);
    }

    // Render each category
    for (const [category, results] of categories) {
      const categoryHeader = document.createElement('div');
      categoryHeader.className = 'aurelia-cp-category-header';
      categoryHeader.textContent = category;
      categoryHeader.setAttribute('role', 'heading');
      categoryHeader.setAttribute('aria-level', '2');
      this.resultsContainer.appendChild(categoryHeader);

      for (const result of results) {
        const globalIndex = this.filteredResults.indexOf(result);

        const item = document.createElement('div');
        item.className = 'aurelia-cp-result';
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(globalIndex === this.selectedIndex));
        item.tabIndex = 0;
        item.dataset['index'] = String(globalIndex);

        // Icon
        if (result.icon) {
          const icon = document.createElement('span');
          icon.className = 'aurelia-cp-result-icon';
          icon.textContent = result.icon;
          icon.setAttribute('aria-hidden', 'true');
          item.appendChild(icon);
        }

        // Label and hint
        const content = document.createElement('div');
        content.className = 'aurelia-cp-result-content';

        const label = document.createElement('span');
        label.className = 'aurelia-cp-result-label';
        label.textContent = result.label;
        content.appendChild(label);

        if (result.hint) {
          const hint = document.createElement('span');
          hint.className = 'aurelia-cp-result-hint';
          hint.textContent = result.hint;
          content.appendChild(hint);
        }

        item.appendChild(content);

        // Highlight matching characters
        if (this.input?.value) {
          this.highlightMatch(label, result.label, this.input.value);
          if (result.hint) {
            const hintElement = item.querySelector('.aurelia-cp-result-hint');
            if (hintElement) {
              this.highlightMatch(hintElement, result.hint, this.input.value);
            }
          }
        }

        item.addEventListener('click', () => {
          result.action();
          this.close();
        });

        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            result.action();
            this.close();
          }
        });

        item.addEventListener('mouseenter', () => {
          this.selectedIndex = globalIndex;
          this.updateSelection();
        });

        this.resultsContainer.appendChild(item);
      }
    }
  }

  private highlightMatch(element: Element, text: string, query: string): void {
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();

    if (!lowerQuery || !lowerText.includes(lowerQuery)) {
      return;
    }

    const index = lowerText.indexOf(lowerQuery);
    if (index === -1) {
      return;
    }

    const before = text.slice(0, index);
    const match = text.slice(index, index + query.length);
    const after = text.slice(index + query.length);

    const mark = document.createElement('mark');
    mark.className = 'aurelia-cp-highlight';
    mark.textContent = match;
    element.replaceChildren(document.createTextNode(before), mark,
                            document.createTextNode(after));
  }

  private updateSelection(): void {
    const items = this.querySelectorAll<HTMLElement>('.aurelia-cp-result');
    items.forEach((item) => {
      const globalIndex = parseInt(item.dataset['index'] || '-1', 10);
      if (globalIndex === this.selectedIndex) {
        item.classList.add('selected');
        item.setAttribute('aria-selected', 'true');
        item.scrollIntoView({ block: 'nearest' });
      } else {
        item.classList.remove('selected');
        item.setAttribute('aria-selected', 'false');
      }
    });
  }

  private executeAction(action: string, data?: string): void {
    // SCAFFOLDED: In real implementation, these would communicate with
    // the browser process via Mojo interfaces or existing Chromium APIs.
    // For SCAFFOLDED state, we just log the action.
    // Do NOT claim these work in the real browser without C++ integration.

    console.log('Execute action:', action, data);

    this.dispatchEvent(new CustomEvent('aurelia-command-palette-action', {
      detail: { action, data },
    }));

    // SCAFFOLDED actions - these would be implemented in C++
    switch (action) {
      case 'new-tab':
        // chrome.send('newTab');
        break;
      case 'new-window':
        // chrome.send('newWindow');
        break;
      case 'close-tab':
        // chrome.send('closeTab');
        break;
      case 'switch-tab':
        // chrome.send('switchTab', data);
        break;
      case 'settings':
        // chrome.send('openSettings');
        break;
      case 'history':
        // chrome.send('openHistory');
        break;
      case 'downloads':
        // chrome.send('openDownloads');
        break;
      case 'bookmarks':
        // chrome.send('openBookmarks');
        break;
      case 'home':
        // chrome.send('navigateHome');
        break;
      case 'search-web':
        // chrome.send('searchWeb', data);
        break;
      case 'open-url':
        // chrome.send('navigateTo', data);
        break;
      case 'devtools':
        // chrome.send('openDevTools');
        break;
      case 'help':
        // chrome.send('openHelp');
        break;
      case 'about':
        // chrome.send('openAbout');
        break;
      case 'theme-light':
      case 'theme-dark':
      case 'theme-system':
        // chrome.send('setTheme', action.replace('theme-', ''));
        break;
    }
  }

  /**
   * Add a command dynamically.
   * SCAFFOLDED: Would be called from C++ when tabs/bookmarks/history change.
   */
  addCommand(command: Omit<CommandResult, 'action'> & { action: () => void }): void {
    this.allResults.push(command);
    if (this.isOpen) {
      this.filter(this.input?.value || '');
    }
  }

  /**
   * Remove a command.
   */
  removeCommand(id: string): void {
    this.allResults = this.allResults.filter(c => c.id !== id);
    if (this.isOpen) {
      this.filter(this.input?.value || '');
    }
  }

  /**
   * Update tabs - SCAFFOLDED: Would be called from C++
   */
  updateTabs(tabs: Array<{ id: string; title: string; url: string; active: boolean }>): void {
    this.allResults = this.allResults.filter(c => !c.id.startsWith('tab-'));
    tabs.forEach((tab) => {
      this.allResults.push({
        id: `tab-${tab.id}`,
        label: tab.title || 'Untitled',
        category: 'Tabs',
        hint: tab.url,
        icon: tab.active ? '📄' : '📄',
        action: () => this.executeAction('switch-tab', tab.id),
      });
    });
    if (this.isOpen) {
      this.filter(this.input?.value || '');
    }
  }

  /**
   * Update bookmarks - SCAFFOLDED: Would be called from C++
   */
  updateBookmarks(bookmarks: Array<{ id: string; title: string; url: string }>): void {
    this.allResults = this.allResults.filter(c => !c.id.startsWith('bookmark-'));
    bookmarks.forEach(bookmark => {
      this.allResults.push({
        id: `bookmark-${bookmark.id}`,
        label: bookmark.title,
        category: 'Bookmarks',
        hint: bookmark.url,
        icon: '🔖',
        action: () => this.executeAction('open-bookmark', bookmark.url),
      });
    });
    if (this.isOpen) {
      this.filter(this.input?.value || '');
    }
  }
}

customElements.define(AureliaCommandPaletteElement.is, AureliaCommandPaletteElement);

declare global {
  interface HTMLElementTagNameMap {
    'aurelia-command-palette': AureliaCommandPaletteElement;
  }
}
