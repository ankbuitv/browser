// Copyright 2026 The Aurelia Authors
// Use of this source code is governed by the Mozilla Public License, v. 2.0,
// that can be found in the LICENSE file at the repository root.

#include "chrome/browser/ui/webui/newtab/newtab_ui.h"

#include "chrome/browser/profiles/profile.h"
#include "chrome/common/webui_url_constants.h"
#include "chrome/grit/aurelia_newtab_resources.h"
#include "chrome/grit/aurelia_newtab_resources_map.h"
#include "content/public/browser/web_ui.h"
#include "content/public/browser/web_ui_data_source.h"
#include "services/network/public/mojom/content_security_policy.mojom.h"
#include "ui/webui/webui_util.h"

namespace {

// Populates chrome://aurelia-newtab's data source.
//
// The new tab page is a minimal, static page with no network requests.
// It provides a search/URL input and quick access to browser features.
//
// STATUS: SCAFFOLDED - Data source setup written, not compiled yet.
void CreateAndAddAureliaNewTabUIHtmlSource(Profile* profile) {
  content::WebUIDataSource* source = content::WebUIDataSource::CreateAndAdd(
      profile, chrome::kChromeUINewTabAureliaHost);

  webui::SetupWebUIDataSource(source, kAureliaNewtabResources,
                            IDR_AURELIA_NEWTAB_NEWTAB_HTML);

  // New tab pages are never embedded. The remaining CSP comes from
  // SetupWebUIDataSource() (which enables trusted types and a strict policy).
  source->OverrideContentSecurityPolicy(
      network::mojom::CSPDirectiveName::FrameAncestors,
      "frame-ancestors 'none';");
}

}  // namespace

AureliaNewTabUI::AureliaNewTabUI(content::WebUI* web_ui)
    : ui::MojoWebUIController(web_ui, /*enable_chrome_send=*/false) {
  CreateAndAddAureliaNewTabUIHtmlSource(Profile::FromWebUI(web_ui));
}

AureliaNewTabUI::~AureliaNewTabUI() = default;

WEB_UI_CONTROLLER_TYPE_IMPL(AureliaNewTabUI)
