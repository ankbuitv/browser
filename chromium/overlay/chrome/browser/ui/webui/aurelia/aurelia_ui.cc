// Copyright 2026 The Aurelia Authors
// Use of this source code is governed by the Mozilla Public License, v. 2.0,
// that can be found in the LICENSE file at the repository root.

#include "chrome/browser/ui/webui/aurelia/aurelia_ui.h"

#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/webui/aurelia/aurelia_version.h"
#include "chrome/common/webui_url_constants.h"
#include "chrome/grit/aurelia_resources.h"
#include "chrome/grit/aurelia_resources_map.h"
#include "components/version_info/version_info.h"
#include "content/public/browser/web_ui.h"
#include "content/public/browser/web_ui_data_source.h"
#include "services/network/public/mojom/content_security_policy.mojom.h"
#include "ui/webui/webui_util.h"

namespace {

// Populates chrome://aurelia's data source.
//
// The values below are either compile-time constants from
// chrome/browser/ui/webui/aurelia/aurelia_version.h (generated from
// config/chromium_version.json) or read from Chromium's own version_info. No
// content is fetched from the network and nothing is read from the profile,
// so the page cannot leak browsing data by construction.
void CreateAndAddAureliaUIHtmlSource(Profile* profile) {
  content::WebUIDataSource* source = content::WebUIDataSource::CreateAndAdd(
      profile, chrome::kChromeUIAureliaHost);

  webui::SetupWebUIDataSource(source, kAureliaResources,
                              IDR_AURELIA_AURELIA_HTML);

  // Aurelia pages are never embedded. The remaining CSP comes from
  // SetupWebUIDataSource() (which enables trusted types and a strict policy).
  source->OverrideContentSecurityPolicy(
      network::mojom::CSPDirectiveName::FrameAncestors,
      "frame-ancestors 'none';");

  // Product identity. These are the only strings that need to change if the
  // codename is replaced; see docs/NAMING.md.
  source->AddString("productCodename", aurelia::kProductCodename);
  source->AddString("productVersion", aurelia::kProductVersion);
  source->AddString("buildChannel", aurelia::kBuildChannel);

  // Build provenance: the pin Aurelia was built from, and the Chromium
  // version this binary actually reports. If these two disagree, the build
  // was not produced from the pinned revision.
  source->AddString("chromiumPin", aurelia::kChromiumPin);
  source->AddString("chromiumPinRevision", aurelia::kChromiumRevision);
  source->AddString("chromiumBuiltVersion",
                    std::string(version_info::GetVersionNumber()));
  source->AddString("patchSetVersion", aurelia::kPatchSetVersion);
}

}  // namespace

AureliaUI::AureliaUI(content::WebUI* web_ui)
    : ui::MojoWebUIController(web_ui, /*enable_chrome_send=*/false) {
  CreateAndAddAureliaUIHtmlSource(Profile::FromWebUI(web_ui));
}

AureliaUI::~AureliaUI() = default;

WEB_UI_CONTROLLER_TYPE_IMPL(AureliaUI)
