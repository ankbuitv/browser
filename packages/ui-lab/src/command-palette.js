// Copyright 2026 The Aurelia Authors
// Use of this source code is governed by the Mozilla Public License, v. 2.0,
// that can be found in the LICENSE file at the repository root.

/**
 * `<aurelia-command-palette>` - Command palette for Aurelia Browser.
 *
 * UI Lab version - for development harness only.
 * This is NOT the browser - it's a preview harness.
 *
 * STATUS: SCAFFOLDED - Component for UI Lab testing.
 * Privileged actions are SCAFFOLDED (require C++ integration).
 */

const COMMANDS = [
  {
    id: 'new-tab',
    label: 'New Tab',
    category: 'Commands',
    hint: 'Ctrl+T',
    icon: '\ud83d\udcc4',
  },
  {
    id: 'new-window',
    label: 'New Window',
    category: 'Commands',
    hint: 'Ctrl+N',
    icon: '\ud83e\ude9f',
  },
  {
    id: 'close-tab',
    label: 'Close Tab',
    category: 'Commands',
    hint: 'Ctrl+W',
    icon: '\u2715',
  },
  {
    id: 'settings',
    label: 'Settings',
    category: 'Commands',
    hint: 'Open settings',
    icon: '\u2699\ufe0f',
  },
  {
    id: 'history',
    label: 'History',
    category: 'Commands',
    hint: 'Open history',
    icon: '\ud83d\udd52',
  },
  {
    id: 'downloads',
    label: 'Downloads',
    category: 'Commands',
    hint: 'Open downloads',
    icon: '\ud83d\udce5',
  },
  {
    id: 'bookmarks',
    label: 'Bookmarks',
    category: 'Commands',
    hint: 'Open bookmarks',
    icon: '\ud83d\udd16',
  },
  {
    id: 'home',
    label: 'Home',
    category: 'Navigation',
    hint: 'Go to home',
    icon: '\ud83c\udfe0',
  },
  {
    id: 'search-web',
    label: 'Search Web',
    category: 'Navigation',
    hint: 'Search web',
    icon: '\ud83d\udd0d',
  },
  {
    id: 'open-url',
    label: 'Open URL',
    category: 'Navigation',
    hint: 'Open URL',
    icon: '\ud83c\udf10',
  },
  {
    id: 'theme-light',
    label: 'Light Theme',
    category: 'Appearance',
    hint: 'Switch light',
    icon: '\u2600\ufe0f',
  },
  {
    id: 'theme-dark',
    label: 'Dark Theme',
    category: 'Appearance',
    hint: 'Switch dark',
    icon: '\ud83c\udf19',
  },
  {
    id: 'theme-system',
    label: 'System Theme',
    category: 'Appearance',
    hint: 'Use system',
    icon: '\ud83d\udda5\ufe0f',
  },
  {
    id: 'devtools',
    label: 'Developer Tools',
    category: 'Developer',
    hint: 'Open DevTools',
    icon: '\ud83d\udee0\ufe0f',
  },
  {
    id: 'help',
    label: 'Help',
    category: 'Help',
    hint: 'Open help',
    icon: '\u2753',
  },
  {
    id: 'about',
    label: 'About Aurelia',
    category: 'Help',
    hint: 'Show about',
    icon: '\u2139\ufe0f',
  },
];

export class AureliaCommandPaletteElement extends HTMLElement {
  static get is() {
    return 'aurelia-command-palette';
  }

  input = null;
  resultsContainer = null;
  allResults = COMMANDS.map((cmd) => ({
    ...cmd,
    action: () => this.executeAction(cmd.id),
  }));
  filteredResults = [];
  selectedIndex = -1;
  isOpen = false;

  connectedCallback() {
    if (this.hasAttribute('data-rendered')) return;
    this.setAttribute('data-rendered', 'true');
    this.render();
    this.setupKeyboard();
  }

  disconnectedCallback() {
    this.isOpen = false;
    this.selectedIndex = -1;
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.classList.add('open');
    this.input?.focus();
    this.filter('');
    this.selectedIndex = -1;
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.classList.remove('open');
    this.filteredResults = [];
    this.renderResults();
    this.selectedIndex = -1;
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  render() {
    this.classList.add('aurelia-command-palette');
    this.setAttribute('role', 'dialog');
    this.setAttribute('aria-modal', 'true');
    this.setAttribute('aria-label', 'Command Palette - UI Lab Preview');

    const overlay = document.createElement('div');
    overlay.className = 'aurelia-cp-overlay';
    overlay.addEventListener('click', () => this.close());
    this.appendChild(overlay);

    const container = document.createElement('div');
    container.className = 'aurelia-cp-container';

    const header = document.createElement('div');
    header.className = 'aurelia-cp-header';

    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'aurelia-cp-input-wrapper';

    const searchIcon = document.createElement('span');
    searchIcon.className = 'aurelia-cp-search-icon';
    searchIcon.setAttribute('aria-hidden', 'true');
    searchIcon.textContent = '\ud83d\udd0d';
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
    closeButton.textContent = '\u2715';
    closeButton.addEventListener('click', () => this.close());
    inputWrapper.appendChild(closeButton);

    header.appendChild(inputWrapper);
    container.appendChild(header);

    this.resultsContainer = document.createElement('div');
    this.resultsContainer.className = 'aurelia-cp-results';
    this.resultsContainer.setAttribute('role', 'listbox');
    container.appendChild(this.resultsContainer);

    const footer = document.createElement('div');
    footer.className = 'aurelia-cp-footer';
    const hint = document.createElement('span');
    hint.className = 'aurelia-cp-hint';
    hint.textContent = 'UI Lab: Press Tab to select, Esc to close';
    footer.appendChild(hint);
    container.appendChild(footer);

    this.appendChild(container);
    this.classList.remove('open');
  }

  setupKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        e.preventDefault();
        this.close();
      }
    });
  }

  handleInput(e) {
    const target = e.target;
    this.filter(target.value);
  }

  handleKeydown(e) {
    const items = this.querySelectorAll('.aurelia-cp-result');

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
        if (
          this.selectedIndex >= 0 &&
          this.selectedIndex < this.filteredResults.length
        ) {
          this.filteredResults[this.selectedIndex].action();
          this.close();
        } else if (this.input?.value.trim()) {
          if (this.filteredResults.length > 0) {
            this.filteredResults[0].action();
            this.close();
          } else {
            this.executeAction('search-web', this.input.value);
            this.close();
          }
        }
        break;
    }
  }

  filter(query) {
    const lowerQuery = query.toLowerCase();

    if (!lowerQuery) {
      this.filteredResults = [...this.allResults];
    } else {
      this.filteredResults = this.allResults.filter((result) => {
        const label = result.label.toLowerCase();
        const category = result.category.toLowerCase();
        const hint = result.hint?.toLowerCase() || '';
        return (
          this.fuzzyMatch(lowerQuery, label) ||
          this.fuzzyMatch(lowerQuery, category) ||
          this.fuzzyMatch(lowerQuery, hint)
        );
      });
    }

    this.filteredResults.sort((a, b) => {
      const aLabel = a.label.toLowerCase();
      const bLabel = b.label.toLowerCase();
      const q = lowerQuery;
      const aStarts = aLabel.startsWith(q);
      const bStarts = bLabel.startsWith(q);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      const aInc = aLabel.includes(q);
      const bInc = bLabel.includes(q);
      if (aInc && !bInc) return -1;
      if (!aInc && bInc) return 1;
      return aLabel.localeCompare(bLabel);
    });

    this.renderResults();
  }

  fuzzyMatch(query, target) {
    let queryIndex = 0;
    for (let i = 0; i < target.length && queryIndex < query.length; i++) {
      if (target[i] === query[queryIndex]) {
        queryIndex++;
      }
    }
    return queryIndex === query.length;
  }

  renderResults() {
    if (!this.resultsContainer) return;
    this.resultsContainer.innerHTML = '';

    if (this.filteredResults.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'aurelia-cp-empty';
      empty.textContent = this.input?.value
        ? 'No results found'
        : 'Start typing to search commands';
      empty.setAttribute('role', 'status');
      this.resultsContainer.appendChild(empty);
      this.selectedIndex = -1;
      return;
    }

    const categories = new Map();
    for (const result of this.filteredResults) {
      if (!categories.has(result.category)) {
        categories.set(result.category, []);
      }
      categories.get(result.category).push(result);
    }

    for (const [category, results] of categories) {
      const categoryHeader = document.createElement('div');
      categoryHeader.className = 'aurelia-cp-category-header';
      categoryHeader.textContent = category;
      categoryHeader.setAttribute('role', 'heading');
      categoryHeader.setAttribute('aria-level', '2');
      this.resultsContainer.appendChild(categoryHeader);

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const globalIndex = this.filteredResults.indexOf(result);

        const item = document.createElement('div');
        item.className = 'aurelia-cp-result';
        item.setAttribute('role', 'option');
        item.setAttribute(
          'aria-selected',
          String(globalIndex === this.selectedIndex),
        );
        item.tabIndex = 0;
        item.dataset.index = String(globalIndex);

        if (result.icon) {
          const icon = document.createElement('span');
          icon.className = 'aurelia-cp-result-icon';
          icon.textContent = result.icon;
          icon.setAttribute('aria-hidden', 'true');
          item.appendChild(icon);
        }

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

        if (this.input?.value) {
          this.highlightMatch(label, result.label, this.input.value);
          if (result.hint) {
            const hintEl = item.querySelector('.aurelia-cp-result-hint');
            if (hintEl)
              this.highlightMatch(hintEl, result.hint, this.input.value);
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

  highlightMatch(element, text, query) {
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    if (!lowerQuery || !lowerText.includes(lowerQuery)) return;
    const index = lowerText.indexOf(lowerQuery);
    if (index === -1) return;
    const before = text.slice(0, index);
    const match = text.slice(index, index + query.length);
    const after = text.slice(index + query.length);
    element.innerHTML = `${this.escapeHtml(before)}<mark class="aurelia-cp-highlight">${this.escapeHtml(match)}</mark>${this.escapeHtml(after)}`;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  updateSelection() {
    const items = this.querySelectorAll('.aurelia-cp-result');
    items.forEach((item) => {
      const globalIndex = parseInt(item.dataset.index || '-1', 10);
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

  executeAction(action, data) {
    // SCAFFOLDED: In UI Lab, just log actions
    // In real Chromium, these would use chrome.send() or Mojo
    console.log('UI Lab: Execute action:', action, data);

    // Show a brief notification in UI Lab
    const existingNotice = document.getElementById('aurelia-action-notice');
    if (existingNotice) existingNotice.remove();

    const notice = document.createElement('div');
    notice.id = 'aurelia-action-notice';
    notice.textContent = `Action: ${action}${data ? ` (${data})` : ''}`;
    notice.style.cssText =
      'position:fixed;bottom:20px;right:20px;background:#6e7bf2;color:white;padding:10px 16px;border-radius:8px;font-family:system-ui;z-index:9999;';
    document.body.appendChild(notice);
    setTimeout(() => notice.remove(), 2000);
  }
}

customElements.define(
  AureliaCommandPaletteElement.is,
  AureliaCommandPaletteElement,
);
