// Copyright 2026 The Aurelia Authors
// Use of this source code is governed by the Mozilla Public License, v. 2.0,
// that can be found in the LICENSE file at the repository root.

/**
 * `<aurelia-status-card>` - a light-DOM card used by Aurelia's WebUI surfaces.
 *
 * Deliberately dependency-free: plain custom element, no template engine, no
 * `innerHTML` (Aurelia WebUI pages run with the trusted-types CSP enabled, and
 * building nodes programmatically keeps that guarantee intact).
 */
export class AureliaStatusCardElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return ['heading', 'description'];
  }

  override connectedCallback(): void {
    this.render();
  }

  override attributeChangedCallback(
      _name: string, oldValue: string|null, newValue: string|null): void {
    if (oldValue !== newValue && this.isConnected) {
      this.render();
    }
  }

  private render(): void {
    // Only the generated heading/description are owned by this element; slotted
    // content (rows added by the parent) is left untouched.
    for (const existing of Array.from(
             this.querySelectorAll(':scope > .aurelia-card-chrome'))) {
      existing.remove();
    }

    const chrome = document.createElement('div');
    chrome.className = 'aurelia-card-chrome';

    const heading = this.getAttribute('heading');
    if (heading !== null && heading.length > 0) {
      const headingElement = document.createElement('h2');
      headingElement.className = 'aurelia-card-heading';
      headingElement.textContent = heading;
      chrome.appendChild(headingElement);
    }

    const description = this.getAttribute('description');
    if (description !== null && description.length > 0) {
      const descriptionElement = document.createElement('p');
      descriptionElement.className = 'aurelia-card-description';
      descriptionElement.textContent = description;
      chrome.appendChild(descriptionElement);
    }

    this.prepend(chrome);
  }
}

customElements.define(AureliaStatusCardElement.is, AureliaStatusCardElement);

declare global {
  interface HTMLElementTagNameMap {
    'aurelia-status-card': AureliaStatusCardElement;
  }
}
