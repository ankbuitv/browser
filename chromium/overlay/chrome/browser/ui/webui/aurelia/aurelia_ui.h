// Copyright 2026 The Aurelia Authors
// Use of this source code is governed by the Mozilla Public License, v. 2.0,
// that can be found in the LICENSE file at the repository root.

#ifndef CHROME_BROWSER_UI_WEBUI_AURELIA_AURELIA_UI_H_
#define CHROME_BROWSER_UI_WEBUI_AURELIA_AURELIA_UI_H_

#include "chrome/common/webui_url_constants.h"
#include "content/public/browser/internal_webui_config.h"
#include "ui/webui/mojo_web_ui_controller.h"

namespace content {
class WebUI;
}

class AureliaUI;

// chrome://aurelia is Aurelia's own WebUI surface. An *internal* WebUI config
// is used deliberately: internal pages are not reachable from web content, so
// a hostile page cannot navigate a user to a privileged Aurelia page.
class AureliaUIConfig : public content::DefaultInternalWebUIConfig<AureliaUI> {
 public:
  AureliaUIConfig() : DefaultInternalWebUIConfig(chrome::kChromeUIAureliaHost) {}
};

// Controller for chrome://aurelia.
//
// M0/M1 scope: a static, offline status surface served from the browser's own
// resources. The page has no message handlers, no Mojo interface and performs
// no network requests. Anything that needs to talk to the browser process must
// add an explicit, reviewed Mojo interface rather than a privileged shortcut.
class AureliaUI : public ui::MojoWebUIController {
 public:
  explicit AureliaUI(content::WebUI* web_ui);
  ~AureliaUI() override;

  AureliaUI(const AureliaUI&) = delete;
  AureliaUI& operator=(const AureliaUI&) = delete;

 private:
  WEB_UI_CONTROLLER_TYPE_DECL();
};

#endif  // CHROME_BROWSER_UI_WEBUI_AURELIA_AURELIA_UI_H_
