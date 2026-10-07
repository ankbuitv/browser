/**
 * Generate the compiled-in Aurelia version header from the pin configuration.
 *
 * The header is checked in (the Chromium build must not run Node.js tooling)
 * and `--check` fails when it is stale, so config/chromium_version.json stays
 * the single source of truth for the product name, version and Chromium pin.
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { REPO_ROOT, loadConfig } from './config.mjs';

export const HEADER_PATH = path.join(
  REPO_ROOT,
  'chromium/overlay/chrome/browser/ui/webui/aurelia/aurelia_version.h',
);

export function renderHeader(config) {
  const { product, chromium, patchSet } = config;
  return `// Copyright 2026 The Aurelia Authors
// Use of this source code is governed by the Mozilla Public License, v. 2.0,
// that can be found in the LICENSE file at the repository root.
//
// GENERATED FILE - DO NOT EDIT.
// Source: config/chromium_version.json
// Regenerate: node tools/chromium/cli.mjs generate-version
//
// Product identity lives here so that a rename is a one-file change on the C++
// side. "${product.codename}" is a development codename until the naming review
// completes; see docs/NAMING.md.

#ifndef CHROME_BROWSER_UI_WEBUI_AURELIA_AURELIA_VERSION_H_
#define CHROME_BROWSER_UI_WEBUI_AURELIA_AURELIA_VERSION_H_

namespace aurelia {

inline constexpr char kProductCodename[] = "${product.codename}";
inline constexpr char kProductVersion[] = "${product.version}";
inline constexpr char kBuildChannel[] = "${product.channel}";
inline constexpr char kChromiumPin[] = "${chromium.version}";
inline constexpr char kChromiumRevision[] = "${chromium.revision}";
inline constexpr char kPatchSetVersion[] = "${patchSet.version}";

}  // namespace aurelia

#endif  // CHROME_BROWSER_UI_WEBUI_AURELIA_AURELIA_VERSION_H_
`;
}

export function generateVersionHeader({ check = false, config = loadConfig() } = {}) {
  const contents = renderHeader(config);
  const existing = existsSync(HEADER_PATH) ? readFileSync(HEADER_PATH, 'utf8') : null;
  if (existing === contents) {
    return { changed: false, path: HEADER_PATH };
  }
  if (check) {
    throw new Error(
      `${path.relative(REPO_ROOT, HEADER_PATH)} is out of date; run: node tools/chromium/cli.mjs generate-version`,
    );
  }
  mkdirSync(path.dirname(HEADER_PATH), { recursive: true });
  writeFileSync(HEADER_PATH, contents);
  return { changed: true, path: HEADER_PATH };
}
