/**
 * UI development harness logic - NOT the Aurelia browser.
 *
 * Plain ES modules, no framework and no build step, so the harness stays a
 * harness: a place to see token-driven styling, not a second application next
 * to Chromium. The real component surface is TypeScript inside
 * chromium/overlay/.../resources/aurelia/ and is compiled by Chromium's
 * toolchain, not by anything in this folder.
 */

const TOKEN_PREFIX = '--aurelia-';

/**
 * Collect every token name the generated stylesheet defines, including the ones
 * inside media queries. Values are read afterwards through getComputedStyle so
 * the harness shows what the active theme actually applies - including
 * `prefers-color-scheme` and the explicit `data-aurelia-theme` overrides.
 */
function collectTokenNames(sheet, names = new Set()) {
  let rules;
  try {
    rules = sheet.cssRules;
  } catch {
    return names; // cross-origin sheet; cannot read it
  }
  for (const rule of rules) {
    if (rule.cssRules !== undefined && rule.selectorText === undefined) {
      collectTokenNames(rule, names); // @media and friends
      continue;
    }
    if (
      typeof rule.selectorText === 'string' &&
      rule.selectorText.startsWith(':root')
    ) {
      for (const property of rule.style) {
        if (property.startsWith(TOKEN_PREFIX)) {
          names.add(property);
        }
      }
    }
  }
  return names;
}

function readTokens() {
  const names = new Set();
  for (const sheet of document.styleSheets) {
    collectTokenNames(sheet, names);
  }
  const computed = getComputedStyle(document.documentElement);
  const tokens = new Map();
  for (const name of names) {
    tokens.set(name, computed.getPropertyValue(name).trim() || '(unset)');
  }
  return tokens;
}

function swatch(name, value, { background = null, foreground = null } = {}) {
  const element = document.createElement('div');
  element.className = 'swatch';

  const chip = document.createElement('div');
  chip.className = 'swatch-color';
  chip.style.background = background ?? value;
  if (foreground !== null) {
    chip.textContent = 'Aa';
    chip.style.color = foreground;
    chip.style.display = 'flex';
    chip.style.alignItems = 'center';
    chip.style.justifyContent = 'center';
  }

  const label = document.createElement('div');
  label.className = 'swatch-label';
  label.textContent = name;

  const shown = document.createElement('div');
  shown.className = 'swatch-value';
  shown.textContent = value;

  element.append(chip, label, shown);
  return element;
}

function render() {
  const tokens = readTokens();
  const get = (name) => tokens.get(`--aurelia-${name}`) ?? '(missing)';

  const surfaces = document.getElementById('surfaces');
  surfaces.replaceChildren(
    swatch('background', get('color-background')),
    swatch('background-elevated', get('color-background-elevated')),
    swatch(
      'surface-glass (composited over background)',
      get('color-surface-glass'),
      { background: get('color-background') },
    ),
    swatch('text on background', get('color-text'), {
      background: get('color-background'),
      foreground: get('color-text'),
    }),
    swatch('text-muted on background', get('color-text-muted'), {
      background: get('color-background'),
      foreground: get('color-text-muted'),
    }),
    swatch('accent', get('color-accent')),
    swatch('accent-text on accent', get('color-accent-text'), {
      background: get('color-accent'),
      foreground: get('color-accent-text'),
    }),
  );

  const statuses = document.getElementById('statuses');
  statuses.replaceChildren(
    ...['success', 'warning', 'danger'].map((status) =>
      swatch(status, get(`color-${status}`), {
        background: get('color-background'),
        foreground: get(`color-${status}`),
      }),
    ),
  );

  const modeLine = document.getElementById('motion-mode');
  modeLine.textContent = window.matchMedia('(prefers-reduced-motion: reduce)')
    .matches
    ? 'prefers-reduced-motion: reduce is active - the sample must not move.'
    : 'prefers-reduced-motion: no-preference - the sample moves slightly on hover.';

  const theme = document.documentElement.dataset.aureliaTheme;
  document.title = theme
    ? `UI development harness — not the Aurelia browser (${theme})`
    : 'UI development harness — not the Aurelia browser (system)';
}

function wireControls() {
  const root = document.documentElement;
  for (const button of document.querySelectorAll('[data-theme]')) {
    button.addEventListener('click', () => {
      const choice = button.dataset.theme;
      if (choice === 'system') {
        delete root.dataset.aureliaTheme;
      } else {
        root.dataset.aureliaTheme = choice;
      }
      render();
    });
  }
  window
    .matchMedia('(prefers-reduced-motion: reduce)')
    .addEventListener('change', render);
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', render);
}

render();
wireControls();
