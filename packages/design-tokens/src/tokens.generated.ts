// GENERATED FILE - DO NOT EDIT.
// Source: packages/design-tokens/tokens.json
// Regenerate: node tools/design/generate-tokens.mjs

/** Every CSS custom property the Aurelia design system defines. */
export const CSS_VARIABLE_NAMES = [
  '--aurelia-color-accent',
  '--aurelia-color-accent-subtle',
  '--aurelia-color-accent-text',
  '--aurelia-color-background',
  '--aurelia-color-background-elevated',
  '--aurelia-color-border',
  '--aurelia-color-danger',
  '--aurelia-color-success',
  '--aurelia-color-surface-glass',
  '--aurelia-color-text',
  '--aurelia-color-text-muted',
  '--aurelia-color-warning',
  '--aurelia-effect-blur',
  '--aurelia-effect-focus-ring-offset',
  '--aurelia-effect-focus-ring-width',
  '--aurelia-motion-duration-fast',
  '--aurelia-motion-duration-normal',
  '--aurelia-motion-easing-standard',
  '--aurelia-radius-lg',
  '--aurelia-radius-md',
  '--aurelia-radius-pill',
  '--aurelia-radius-sm',
  '--aurelia-space-lg',
  '--aurelia-space-md',
  '--aurelia-space-sm',
  '--aurelia-space-xl',
  '--aurelia-space-xs',
  '--aurelia-space-xxl',
  '--aurelia-type-family',
  '--aurelia-type-family-monospace',
  '--aurelia-type-size-base',
  '--aurelia-type-size-lg',
  '--aurelia-type-size-sm',
  '--aurelia-type-size-title',
  '--aurelia-type-weight-medium',
  '--aurelia-type-weight-regular',
  '--aurelia-type-weight-semibold',
] as const;

/** Shared (theme-independent) token values. */
export const SHARED_TOKENS = {
  '--aurelia-color-accent': "#6e7bf2",
  '--aurelia-radius-sm': "6px",
  '--aurelia-radius-md': "10px",
  '--aurelia-radius-lg': "16px",
  '--aurelia-radius-pill': "999px",
  '--aurelia-space-xs': "4px",
  '--aurelia-space-sm': "8px",
  '--aurelia-space-md': "12px",
  '--aurelia-space-lg': "16px",
  '--aurelia-space-xl': "24px",
  '--aurelia-space-xxl': "32px",
  '--aurelia-type-family': "\"Segoe UI Variable Text\", \"Segoe UI\", system-ui, -apple-system, \"SF Pro Text\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
  '--aurelia-type-family-monospace': "\"Cascadia Mono\", \"SFMono-Regular\", ui-monospace, Consolas, \"Liberation Mono\", monospace",
  '--aurelia-type-size-sm': "12px",
  '--aurelia-type-size-base': "13px",
  '--aurelia-type-size-lg': "15px",
  '--aurelia-type-size-title': "22px",
  '--aurelia-type-weight-regular': "400",
  '--aurelia-type-weight-medium': "500",
  '--aurelia-type-weight-semibold': "600",
  '--aurelia-motion-duration-fast': "120ms",
  '--aurelia-motion-duration-normal': "180ms",
  '--aurelia-motion-easing-standard': "cubic-bezier(0.2, 0, 0, 1)",
  '--aurelia-effect-blur': "12px",
  '--aurelia-effect-focus-ring-width': "2px",
  '--aurelia-effect-focus-ring-offset': "2px",
} as const;

/** Light-theme token values. */
export const LIGHT_TOKENS = {
  '--aurelia-color-accent-text': "#ffffff",
  '--aurelia-color-accent-subtle': "rgba(79, 91, 213, 0.10)",
  '--aurelia-color-background': "#f6f7fb",
  '--aurelia-color-background-elevated': "#ffffff",
  '--aurelia-color-surface-glass': "rgba(255, 255, 255, 0.72)",
  '--aurelia-color-text': "#14161c",
  '--aurelia-color-text-muted': "#5a6072",
  '--aurelia-color-border': "rgba(20, 22, 28, 0.12)",
  '--aurelia-color-success': "#1c7a4d",
  '--aurelia-color-warning': "#8a5a00",
  '--aurelia-color-danger': "#b3261e",
} as const;

/** Dark-theme token values. */
export const DARK_TOKENS = {
  '--aurelia-color-accent-text': "#0b0d12",
  '--aurelia-color-accent-subtle': "rgba(139, 149, 255, 0.16)",
  '--aurelia-color-background': "#0e1015",
  '--aurelia-color-background-elevated': "#161922",
  '--aurelia-color-surface-glass': "rgba(22, 25, 34, 0.66)",
  '--aurelia-color-text': "#eef0f6",
  '--aurelia-color-text-muted': "#a3a9bb",
  '--aurelia-color-border': "rgba(238, 240, 246, 0.14)",
  '--aurelia-color-success': "#5fd39a",
  '--aurelia-color-warning': "#f0c05a",
  '--aurelia-color-danger': "#ff8a80",
} as const;

export type AureliaCssVariableName = (typeof CSS_VARIABLE_NAMES)[number];
