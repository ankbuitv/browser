// Copyright 2026 The Aurelia Authors
// Use of this source code is governed by the Mozilla Public License, v. 2.0,
// that can be found in the LICENSE file at the repository root.

/**
 * UI Lab Harness
 * This is a DEVELOPMENT HARNESS - NOT THE AURELIA BROWSER.
 * Used to preview design tokens and WebUI components.
 */

// Import New Tab component
import './newtab-app.js';

// Import Command Palette component
import './command-palette.js';

// Initialize the harness
document.addEventListener('DOMContentLoaded', () => {
  // Set up theme switching
  const themeButtons = document.querySelectorAll('[data-theme]');
  themeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const theme = button.getAttribute('data-theme');
      const root = document.documentElement;
      if (theme === 'system') {
        root.removeAttribute('data-aurelia-theme');
      } else {
        root.setAttribute('data-aurelia-theme', theme);
      }
      updateThemeDisplay();
    });
  });

  // Update theme display
  function updateThemeDisplay() {
    const root = document.documentElement;
    const theme = root.getAttribute('data-aurelia-theme') || 'system';
    const modeLine = document.getElementById('motion-mode');
    const themeDisplay = document.getElementById('theme-display');

    if (themeDisplay) {
      themeDisplay.textContent = `Current theme: ${theme}`;
    }

    // Check reduced motion
    if (modeLine) {
      const reducedMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches;
      modeLine.textContent = `Reduced motion: ${reducedMotion ? 'enabled' : 'disabled'}`;
    }
  }

  // Initialize design token swatches
  const tokens = {
    color: {
      surfaces: [
        { name: 'background', value: '--aurelia-color-background' },
        {
          name: 'background-elevated',
          value: '--aurelia-color-background-elevated',
        },
        { name: 'surface', value: '--aurelia-color-surface' },
        { name: 'surface-glass', value: '--aurelia-color-surface-glass' },
      ],
      texts: [
        { name: 'text', value: '--aurelia-color-text' },
        { name: 'text-muted', value: '--aurelia-color-text-muted' },
      ],
      accents: [
        { name: 'accent', value: '--aurelia-color-accent' },
        { name: 'accent-light', value: '--aurelia-color-accent-light' },
        { name: 'accent-dark', value: '--aurelia-color-accent-dark' },
        { name: 'accent-subtle', value: '--aurelia-color-accent-subtle' },
      ],
      borders: [{ name: 'border', value: '--aurelia-color-border' }],
      statuses: [
        { name: 'success', value: '--aurelia-color-success' },
        { name: 'warning', value: '--aurelia-color-warning' },
        { name: 'danger', value: '--aurelia-color-danger' },
      ],
    },
  };

  // Render color swatches
  function renderSwatches(containerId, swatchList) {
    const container = document.getElementById(containerId);
    if (!container) return;

    swatchList.forEach((swatch) => {
      const swatchEl = document.createElement('div');
      swatchEl.className = 'swatch';
      swatchEl.style.background = `var(${swatch.value})`;

      const label = document.createElement('span');
      label.className = 'swatch-label';
      label.textContent = swatch.name;

      swatchEl.appendChild(label);
      container.appendChild(swatchEl);
    });
  }

  // Render all swatches
  renderSwatches('surfaces', [
    ...tokens.color.surfaces,
    ...tokens.color.texts,
    ...tokens.color.accent,
    ...tokens.color.borders,
  ]);

  renderSwatches('statuses', tokens.color.statuses);

  // Set up motion sample
  const motionSample = document.getElementById('motion-sample');
  if (motionSample) {
    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    if (reducedMotion) {
      motionSample.style.animation = 'none';
    }
  }

  // Update theme display on load
  updateThemeDisplay();

  // Listen for theme changes
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', updateThemeDisplay);
  window
    .matchMedia('(prefers-reduced-motion: reduce)')
    .addEventListener('change', updateThemeDisplay);

  // Add New Tab preview
  const newtabSection = document.createElement('section');
  newtabSection.innerHTML = `
    <h2>New Tab Preview</h2>
    <p class="lede">UI Lab preview of Aurelia's new tab page. This is NOT the browser.</p>
    <div class="preview-frame">
      <aurelia-newtab></aurelia-newtab>
    </div>
  `;

  const commandPaletteSection = document.createElement('section');
  commandPaletteSection.innerHTML = `
    <h2>Command Palette Preview</h2>
    <p class="lede">Click the button below or press Ctrl+K to open the command palette preview.</p>
    <div class="controls">
      <button onclick="document.querySelector('aurelia-newtab')?.openCommandPalette()" type="button">Open Command Palette (Ctrl+K)</button>
    </div>
  `;

  const main = document.querySelector('main');
  if (main) {
    main.appendChild(newtabSection);
    main.appendChild(commandPaletteSection);
  }

  // Add theme display
  const themeSection = document.createElement('section');
  themeSection.innerHTML = `
    <h2>Theme & Accessibility</h2>
    <p class="lede">Test theme switching and accessibility features.</p>
    <div class="controls">
      <button type="button" data-theme="light">Light</button>
      <button type="button" data-theme="dark">Dark</button>
      <button type="button" data-theme="system">System</button>
    </div>
    <div id="theme-display" style="margin-top: 12px; color: var(--aurelia-color-text-muted); font-size: 12px;"></div>
    <div id="motion-mode" style="margin-top: 4px; color: var(--aurelia-color-text-muted); font-size: 12px;"></div>
  `;
  if (main) {
    main.appendChild(themeSection);
  }

  console.log(
    'UI Lab initialized - DEVELOPMENT HARNESS - NOT THE AURELIA BROWSER',
  );
});

// Export for module system
if (typeof window !== 'undefined') {
  window.AureliaUILabLoaded = true;
}
