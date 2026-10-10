# M1 Architecture: Desktop Shell

This document describes the architecture for **M1 - Desktop Shell**, the first milestone
delivering a usable Aurelia browser interface. It builds on the M0 foundation and
follows the established thin-fork, isolated-code principle.

## Overview

M1 implements the core browser shell with:
- **Native browser chrome** (C++/Views) for window frame, tab strip, toolbar
- **WebUI surfaces** (TypeScript/CSS) for new tab page and command palette
- **Glassmorphism-inspired visual system** with dark/light themes
- **Minimal Chromium delta** - new files only, no upstream patching where avoidable

## Component Model

```
┌─────────────────────────────────────────────────────────────────────┐
│                      BROWSER PROCESS (C++)                              │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │
│  │  BrowserFrame    │  │  TabStrip        │  │  Toolbar/Omnibox     │  │
│  │  (Views)        │  │  (Views)         │  │  (Views)             │  │
│  └────────┬────────┘  └────────┬────────┘  └──────────┬──────────┘  │
│           │                   │                         │              │
│           └───────────────────┼─────────────────────────┘              │
│                               ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                    RENDERER PROCESS                               │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │  │
│  │  │  chrome://aurelia │  │  chrome://newtab  │  │  Command Palette │  │  │
│  │  │  (WebUI)         │  │  (WebUI)          │  │  (WebUI Modal)   │  │  │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘  │  │
│  └─────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## Integration Points

### 1. New Tab Page (`chrome://newtab`)

**Location:** `chromium/overlay/chrome/browser/ui/webui/newtab/`

**Files:**
- `newtab_ui.h` / `newtab_ui.cc` - C++ controller
- `newtab.html` - Page shell
- `newtab_app.ts` - Main page element
- `newtab.css` - Page styles

**Registration:** Requires patching 6 upstream files (similar to `chrome://aurelia`):
- `chrome/common/webui_url_constants.h` - Add `kChromeUINewTabHost`
- `chrome/browser/resources/BUILD.gn` - Include newtab resources
- `chrome/browser/ui/webui/BUILD.gn` - Add newtab target
- `chrome/browser/ui/BUILD.gn` - Link controller
- `chrome/browser/BUILD.gn` - Link into browser
- `chrome/browser/ui/webui/chrome_web_ui_configs.cc` - Register config

**Functionality:**
- Static wallpaper (built-in, no network)
- Minimal UI - no news, no ads, no AI
- Quick access to command palette
- Theme-aware

### 2. Command Palette (`chrome://aurelia/command-palette`)

**Location:** `chromium/overlay/chrome/browser/resources/aurelia/command_palette/`

**Files:**
- `command_palette.ts` - Main component
- `command_palette.css` - Styles

**Integration:**
- Triggered by Ctrl+K / Cmd+K accelerator
- Opens as a modal overlay from the browser frame
- Searches: tabs, bookmarks, history, settings, browser commands
- Fuzzy matching with keyboard navigation

**Accelerator Registration:**
- Requires patching `chrome/browser/ui/accelerators/accelerator_configuration.cc`
- Or using existing command system via `ui::Accelerator`

### 3. Browser Frame Customization

**Location:** `chromium/overlay/chrome/browser/ui/views/frame/`

**Files:**
- `aurelia_frame_view.h` / `aurelia_frame_view.cc` - Custom frame view
- Extends `BrowserFrameView` or `OpaqueBrowserFrameView`

**Customizations:**
- Custom window controls (close, minimize, maximize)
- Glassmorphism effect on Windows
- DPI scaling support
- Custom border radius
- Custom title bar appearance

### 4. Tab Strip Customization

**Location:** `chromium/overlay/chrome/browser/ui/views/tabs/`

**Files:**
- `aurelia_tab_strip.h` / `aurelia_tab_strip.cc` - Custom tab strip
- Extends `TabStrip`

**Customizations:**
- Rounded tab corners (top only)
- Glass effect on active tab
- Subtle borders between tabs
- Pinned tab support
- Drag/reorder support (inherited from Chromium)

### 5. Omnibox Customization

**Location:** `chromium/overlay/chrome/browser/ui/views/location_bar/`

**Files:**
- `aurelia_location_bar.h` / `aurelia_location_bar.cc` - Custom location bar
- Extends `LocationBarView`

**Customizations:**
- Custom styling (radius, colors)
- Integration with Aurelia search engine preferences
- Custom focus states

## WebUI Component Architecture

### New Tab Page Components

```
newtab_app.ts
├── NewTabAppElement (main container)
├── WallpaperElement (background)
├── SearchBoxElement (centered search/URL input)
└── QuickActionsElement (optional quick access buttons)
```

### Command Palette Components

```
command_palette.ts
├── CommandPaletteElement (modal container)
├── SearchInputElement (fuzzy search input)
├── ResultsListElement (scrollable results)
└── ResultItemElement (individual result with matching highlights)
```

## Design System Integration

The existing design tokens (`packages/design-tokens/tokens.json`) are extended with:

### New Token Categories

1. **Omnibox tokens** - Colors, radii, borders for the address bar
2. **Tab tokens** - Active/inactive/hover states, borders
3. **Toolbar tokens** - Background with transparency
4. **Command palette tokens** - Modal styling, highlight colors
5. **New tab tokens** - Wallpaper, card styling
6. **Z-index tokens** - Layer ordering
7. **Motion tokens** - Animation durations and easings

### Glassmorphism Implementation

```css
/* Transparency is opt-in via preference */
:root[data-aurelia-transparency="on"] {
  --aurelia-surface: var(--aurelia-color-surface-glass);
}

/* Backdrop blur for supported platforms */
@supports (backdrop-filter: blur(1px)) {
  .glass-surface {
    backdrop-filter: blur(var(--aurelia-effect-blur));
    -webkit-backdrop-filter: blur(var(--aurelia-effect-blur));
  }
}

/* Fallback for unsupported platforms */
@supports not (backdrop-filter: blur(1px)) {
  .glass-surface {
    background: var(--aurelia-color-background-elevated);
  }
}
```

## C++/WebUI Communication

### Message Passing

Chromium uses **Mojo** for inter-process communication. For M1:

1. **No Mojo interfaces initially** - Keep command palette and new tab as
   read-only or client-side only
2. **Future interfaces** (M2+) for:
   - Tab list queries
   - Bookmark queries
   - History queries
   - Settings access

### Current Approach (M1)

- **New Tab Page**: Pure client-side, no browser process communication
- **Command Palette**: Client-side search of cached/preloaded data
- **Keyboard shortcuts**: Handled via existing Chromium accelerator system

## File Structure

```
chromium/overlay/
├── chrome/browser/ui/webui/
│   ├── aurelia/                    (existing - chrome://aurelia)
│   │   ├── BUILD.gn
│   │   ├── aurelia_ui.h
│   │   ├── aurelia_ui.cc
│   │   └── aurelia_version.h
│   └── newtab/                    (NEW - chrome://newtab)
│       ├── BUILD.gn
│       ├── newtab_ui.h
│       ├── newtab_ui.cc
│       └── resources/
│           ├── BUILD.gn
│           ├── newtab.html
│           ├── newtab_app.ts
│           ├── newtab.css
│           └── design_tokens.css (generated)
├── chrome/browser/resources/aurelia/
│   ├── command_palette.ts        (NEW - shared component)
│   └── command_palette.css        (NEW - shared styles)
└── chrome/browser/ui/views/
    ├── frame/                     (NEW - custom frame)
    │   ├── aurelia_frame_view.h
    │   └── aurelia_frame_view.cc
    └── tabs/                      (NEW - custom tab strip)
        ├── aurelia_tab_strip.h
        └── aurelia_tab_strip.cc
```

## Build Integration

### GN Targets

```gn
# New Tab WebUI
webui_newtab {
  name = "newtab"
  html = "newtab.html"
  js_modules = [ "newtab_app.js" ]
  css = [ "design_tokens.css", "newtab.css" ]
}

# Command Palette (shared resource)
webui_resource("command_palette") {
  js = [ "command_palette.js" ]
  css = [ "command_palette.css" ]
}
```

### Patch Strategy

Following M0's approach:

1. **Minimal upstream edits** - Only registration points
2. **All new code in overlay** - Isolated from upstream changes
3. **Verifiable patches** - Each patch has pre/post digests
4. **No behavior changes** - Only additions, no modifications

**New patches required for M1:**

| Patch # | Purpose | Files Modified | Lines Added |
|---------|---------|----------------|--------------|
| 0002 | Register `chrome://newtab` WebUI | 6 | 7 |
| 0003 | Register Ctrl+K accelerator for command palette | 1-2 | 3-5 |

## Implementation Order

### Phase 1: WebUI Components (Testable in UI Lab)
1. ✅ Extend design tokens for M1
2. Create New Tab WebUI components
3. Create Command Palette WebUI components
4. Test in `packages/ui-lab` harness

### Phase 2: C++ Integration (Requires Full Build)
1. Create `chrome://newtab` WebUI controller
2. Add newtab registration patches
3. Create custom frame view overlay
4. Create custom tab strip overlay
5. Add command palette accelerator

### Phase 3: Assembly
1. Wire up Ctrl+K to open command palette
2. Set newtab as default new tab page
3. Apply custom frame styling
4. Apply custom tab strip styling

## Testing Strategy

### Without Full Build
- ✅ Design token generation and validation
- ✅ TypeScript type checking
- ✅ Unit tests for WebUI components (where applicable)
- ✅ UI Lab visual testing
- ✅ Patch verification against pinned revision

### With Full Build (Future)
- GN configuration verification
- Compilation success
- Runtime smoke tests
- Command palette functionality test
- New tab page rendering test

## Security Considerations

1. **WebUI Isolation**: All WebUI pages are internal-only, not reachable from web content
2. **No Privilege Escalation**: Command palette and new tab have no special privileges
3. **No Network Access**: New tab page makes no network requests
4. **CSP**: Strict Content Security Policy on all WebUI pages
5. **Trusted Types**: Enabled on all WebUI pages

## Performance Considerations

1. **Low-end Hardware Target**: Intel Core i5-3230M, 6 GB RAM, Intel HD 4000
2. **Adaptive Rendering**: Disable expensive effects on low-end hardware
3. **Reduced Motion**: Respect `prefers-reduced-motion`
4. **Reduced Transparency**: Respect `prefers-reduced-transparency`
5. **Memory**: Minimize JavaScript heap usage in WebUI

## Accessibility

1. **Keyboard Navigation**: Full keyboard support for all controls
2. **Focus Management**: Visible focus indicators
3. **Screen Reader**: ARIA attributes on all interactive elements
4. **High Contrast**: Support for `forced-colors: active`
5. **Color Contrast**: All text/background pairs meet WCAG 2.1 AA

## Next Steps

1. Implement New Tab WebUI components
2. Implement Command Palette WebUI components
3. Create C++ overlay files for new integration points
4. Generate and verify new patches
5. Test all components in UI Lab
6. Document fork delta changes

## Status Tracking

| Component | State | Notes |
|-----------|-------|-------|
| Design tokens (M1) | ✅ IMPLEMENTED | Extended with new categories |
| New Tab WebUI | 🛠 SCAFFOLDED | Components to be created |
| Command Palette WebUI | 🛠 SCAFFOLDED | Components to be created |
| New Tab C++ controller | 🛠 NOT STARTED | Requires full build |
| Frame customization | 🛠 NOT STARTED | Requires full build |
| Tab strip customization | 🛠 NOT STARTED | Requires full build |
| Command palette accelerator | 🛠 NOT STARTED | Requires full build |
| Patch set (new registrations) | 🛠 NOT STARTED | To be generated |

---

*See [PROJECT-STATUS.md](PROJECT-STATUS.md) for the official status vocabulary and
[FORK-DELTA.md](FORK-DELTA.md) for the current delta measurement.*
