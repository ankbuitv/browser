// ESLint flat configuration (ESLint v9+).
//
// Scope: Aurelia-owned TypeScript/JavaScript only. Upstream Chromium code is
// governed by Chromium's own lint rules (see tools/chromium/README.md).
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'chromium/**',
      'coverage/**',
      'out/**',
      'dist/**',
      'artifacts/**',
      'packages/*/generated/**',
      'packages/design-tokens/src/tokens.generated.ts',
      'packages/ui-lab/src/tokens.generated.css',
      'chromium/overlay/chrome/browser/resources/aurelia/design_tokens.css',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Aurelia-owned TypeScript and tooling run in a Node environment (tooling)
    // or in a DOM environment (the WebUI resources are compiled by Chromium,
    // so only the policy/TS packages are linted here).
    files: ['**/*.ts', '**/*.mjs', '**/*.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    // Node tooling legitimately writes to stdout.
    files: ['tools/**/*.mjs', 'tools/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.test.ts', '**/*.test.mjs'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
