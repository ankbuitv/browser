// Copyright 2026 The Aurelia Authors
// Use of this source code is governed by the Mozilla Public License, v. 2.0,
// that can be found in the LICENSE file at the repository root.

#ifndef CHROME_BROWSER_UI_WEBUI_NEWTAB_NEWTAB_UI_H_
#define CHROME_BROWSER_UI_WEBUI_NEWTAB_NEWTAB_UI_H_

#include "chrome/common/webui_url_constants.h"
#include "content/public/browser/internal_webui_config.h"
#include "ui/webui/mojo_web_ui_controller.h"

namespace content {
class WebUI;
}

class AureliaNewTabUI;

// chrome://aurelia-newtab is Aurelia's new tab page.
// Using a custom host (aurelia-newtab) instead of replacing chrome://newtab
// to avoid breaking existing Chromium New Tab behavior and extensions.
//
// STATUS: SCAFFOLDED - C++ controller written, not compiled yet.
class AureliaNewTabUIConfig
    : public content::DefaultInternalWebUIConfig<AureliaNewTabUI> {
 public:
  AureliaNewTabUIConfig()
      : DefaultInternalWebUIConfig(chrome::kChromeUINewTabAureliaHost) {}
};

// Controller for chrome://aurelia-newtab.
//
// M1 scope: A minimal new tab page with search/URL input and quick actions.
// The page has no message handlers initially - navigation is handled through
// the standard WebUI navigation mechanism.
class AureliaNewTabUI : public ui::MojoWebUIController {
 public:
  explicit AureliaNewTabUI(content::WebUI* web_ui);
  ~AureliaNewTabUI() override;

  AureliaNewTabUI(const AureliaNewTabUI&) = delete;
  AureliaNewTabUI& operator=(const AureliaNewTabUI&) = delete;

 private:
  WEB_UI_CONTROLLER_TYPE_DECL();
};

#endif  // CHROME_BROWSER_UI_WEBUI_NEWTAB_NEWTAB_UI_H_
