# M1 — kiểm tra sau chuyển repository

Ngày kiểm tra: 2026-10-10 (UTC). **Không xác nhận M1 runtime complete.**

## Repository và PR

- **PASS:** `gh repo view ankworks/aurelia` xác nhận owner `ankworks`, repository
  canonical `https://github.com/ankworks/aurelia`. Origin đã đúng; không đổi sang
  `ankworks/browser` vì GitHub API không tìm thấy repository ở đường dẫn đó.
- **PASS:** [PR #18](https://github.com/ankworks/aurelia/pull/18) vẫn OPEN,
  head `vibe/m1-shell-impl-ae699e`, SHA
  `fb5c6d8acba5aea6cfcac0de36c3effe9c85fff4` tại thời điểm kiểm tra.
- **FAIL:** CI của head PR nói trên: job code SUCCESS, job repository FAILURE,
  tại bước online patch verification, run `38014868148`.
- **BLOCKED:** cập nhật trực tiếp branch PR #18 từ phiên này. Phiên chỉ được làm
  việc/push trên `arena/8052ed1c-aurelia`. Nội dung PR được fast-forward vào nhánh
  này trước khi sửa. Không tạo PR mới, không force-push, không merge PR.

## API authentication và lỗi xác minh

Workflow trước sửa **đã** truyền `GH_TOKEN: ${{ github.token }}` cho cả pin và
patch verification; `contents: read` là permission duy nhất. `gh api` tự tạo
Authorization header. Không có token hardcode hoặc token trong command arguments.

**BLOCKED:** xác định nguyên nhân lịch sử của HTTP 403. Download log Actions
chuyển sang host ngoài allowlist của sandbox, nên không lấy được log đầy đủ.
Trong lần chạy tái hiện, API hoạt động và quota chưa hết; không thể quy kết chắc
chắn 403 là thiếu token hay quota của runner/token đã hết.

**FAIL trước sửa, PASS sau sửa:** online verification tái hiện lỗi `git apply`
của `0002`: context trộn giữa Chromium nguyên bản và tree đã có `0001`.
Generator được giữ làm nguồn sự thật; cả hai trang và các đăng ký resource được
tái sinh vào một patch nguyên tử `0001`. `0002` và metadata không hợp lệ được
loại bỏ vì nội dung đã nằm trong patch mới, không phải tắt verification.

Bản sửa bổ sung:

- Dùng chung API transport cho pin/patch; chuẩn hóa `GH_TOKEN`/`GITHUB_TOKEN`.
- Actions thiếu token phải fail trước request, không fallback anonymous.
- Sửa truyền environment vào child process; không ghi credential ra log.
- Test lỗi 403 vẫn throw; không retry vô hạn, không `continue-on-error`/`|| true`.
- Metadata thiếu pre-image record hoặc SHA-256 sai định dạng phải fail.

## Chromium / GN / GRIT

Đã đọc source từ `chromium/chromium` tại đúng revision
`cfaadc5a132d78e1828635aa8405a499f3e14864` (155.0.8059.40), gồm:

- `ui/webui/resources/tools/build_webui.gni`, `generate_grd.gni`,
  `generate_grd.py`;
- `tools/grit/grit_rule.gni`, `tools/grit/grit/format/resource_map.py`;
- `tools/gritsettings/BUILD.gn`, `resource_ids.spec`, `README.md`;
- `chrome/chrome_paks.gni`, các BUILD/registry được patch;
- controller mẫu `webui_gallery` và controller upstream `ntp/new_tab_ui.h`.

**PASS — đối chiếu source và kiểm tra tĩnh:**

1. `build_webui("build")` sinh các target `:build_ts`, `:build_grd`, `:resources`.
   HTML/CSS liên kết trực tiếp phải ở `static_files`; `css_files` tạo wrapper
   `.css.ts` rồi `.css.js`, không phải CSS URL mà trang đang tải.
2. TypeScript đi qua preprocess/ts_library; manifest static và JS đi vào
   `generate_grd`; GRIT đọc generated GRD.
3. `resource_ids.spec` có hai generated GRD với `META.sizes.includes = [20]`.
   2870/4452 chỉ là **fake start IDs** theo upstream, không phải numeric ID
   hardcode trong C++. `default_resource_ids` cấp khoảng ID thật lúc build.
4. Prefix `aurelia_newtab` tạo `chrome/grit/aurelia_newtab_resources.h`,
   `aurelia_newtab_resources_map.h/.cc`, `aurelia_newtab_resources.pak`.
   Map là `kAureliaNewtabResources`; default ID là
   `IDR_AURELIA_NEWTAB_NEWTAB_HTML`.
5. Controller phụ thuộc `:resources`; GRIT target biên dịch generated map `.cc`.
   `chrome_paks.gni` có cả pak sources lẫn dependencies cho hai trang.
6. Không tạo hay check-in generated GRIT header thủ công.

**PASS — thử generator giới hạn:** chạy `generate_grd.py` thật lấy từ revision
pin với manifest New Tab (HTML, hai CSS, JS được local tsc emit). XML sinh ra có
đúng bốn resource paths, symbolic ID và tên outputs. Đây không phải chạy toàn
bộ GN/GRIT/Chromium toolchain. Dữ liệu kiểm tra nằm trong `out/` bị Git ignore.

**NOT TESTED:** `gn gen`, `gn check`, cấp numeric IDs/GRIT build đầy đủ, C++ link,
Chromium build, Chromium TS lint/stylelint, và runtime. Không có Chromium checkout
đầy đủ, `gn`, `autoninja`; sandbox khoảng 3.8 GiB RAM / 20 GiB disk trống.

## Đăng ký New Tab

**PASS — kiểm tra source/tĩnh:**

- Host `kChromeUINewTabAureliaHost = "aurelia-newtab"`.
- `AureliaNewTabUIConfig` dùng `DefaultInternalWebUIConfig<AureliaNewTabUI>`.
- Đổi tên controller để không trùng `NewTabUI`/`NewTabUIConfig` upstream dùng
  cho incognito/guest NTP.
- Include/registration trong desktop guard, cùng các GN dependencies.
- `WebUIDataSource::CreateAndAdd` dùng đúng host; `SetupWebUIDataSource` nhận
  đúng resource map và default HTML; giữ CSP và không thêm message handler.
- Design tokens được generator xuất vào resource origin của New Tab, HTML dùng
  URL tương đối. Không dùng đường dẫn source tree như URL trình duyệt.
- **Không redirect `chrome://newtab`.**

**NOT TESTED:** mở `chrome://aurelia-newtab` trong browser build thật, console,
CSP, search/navigation, profile/incognito, đóng gói runtime. jsdom không chứng
minh WebUI runtime hoạt động. Browser-wide Ctrl+K vẫn chưa được tích hợp.

## Các kiểm tra và giới hạn

| Kiểm tra                                                       | Kết quả                                                         |
| -------------------------------------------------------------- | --------------------------------------------------------------- |
| `npm run format:check`, `npm run lint`                         | PASS                                                            |
| Workspace typecheck + standalone overlay typecheck             | PASS                                                            |
| Unit tests, gồm regression API/GN/resource/DOM/metadata        | PASS                                                            |
| `npm run build`                                                | PASS — script workspace hiện là no-op, không phải browser build |
| Offline patch metadata + generated files                       | PASS                                                            |
| `verify-pin.mjs`: tag SHA + `chrome/VERSION`                   | PASS                                                            |
| Online patch: 8 pre-images, git apply, 8 post-image digests    | PASS                                                            |
| Static GN/GRIT/WebUI consistency + fork-delta budget           | PASS                                                            |
| Actions workflow policy, deployment parity, secret/docs checks | PASS                                                            |
| Chromium compilation/runtime                                   | NOT TESTED                                                      |

Standalone overlay typecheck chỉ kiểm tra ba component không phụ thuộc module
Chromium: New Tab, command palette, status card; không thay thế Chromium's
`ts_library` build. Sửa lỗi lifecycle `override`, thiếu custom-element name,
call method không tồn tại, truy cập index/dataset sai kiểu; command palette dùng
DOM nodes thay vì `innerHTML`, giữ Trusted Types CSP.

`npm audit` còn **FAIL**: 6 cảnh báo dependency dev (2 critical, 1 high,
3 moderate), gồm Vitest/tinypool/Vite. Không tự nâng major bằng `audit fix --force`
trong bản sửa tích hợp này; cần triage riêng trước merge.

## Khuyến nghị merge

**BLOCKED / chưa nên merge PR #18:** cần chuyển commit sửa sang đúng head PR qua
phiên/quyền làm việc phù hợp, CI của chính PR phải xanh, xử lý/triage dependency
advisories, rồi có builder chạy GN + Chromium build và kiểm thử hai trang độc lập.
Không dùng kết quả local, jsdom hay generated GRD để gọi M1 runtime complete.

Kết quả cuối local: **325 tests / 27 test files PASS**.

## Danh sách file thay đổi so với head PR được kiểm tra

Các file `0002` là xóa vì đã hợp nhất vào `0001`; còn lại là sửa/thêm.

```text
.github/workflows/ci-fast.yml
BUILDING.md
README.md
chromium/overlay/chrome/browser/resources/aurelia/BUILD.gn
chromium/overlay/chrome/browser/resources/aurelia/aurelia_app.ts
chromium/overlay/chrome/browser/resources/aurelia/aurelia_status_card.ts
chromium/overlay/chrome/browser/resources/aurelia/command_palette.ts
chromium/overlay/chrome/browser/resources/newtab/BUILD.gn
chromium/overlay/chrome/browser/resources/newtab/design_tokens.css
chromium/overlay/chrome/browser/resources/newtab/newtab.html
chromium/overlay/chrome/browser/resources/newtab/newtab_app.ts
chromium/overlay/chrome/browser/ui/webui/newtab/BUILD.gn
chromium/overlay/chrome/browser/ui/webui/newtab/newtab_ui.cc
chromium/overlay/chrome/browser/ui/webui/newtab/newtab_ui.h
chromium/patches/0001-aurelia-webui-and-resources.meta.json
chromium/patches/0001-aurelia-webui-and-resources.patch
chromium/patches/0002-newtab-webui-registration.meta.json
chromium/patches/0002-newtab-webui-registration.patch
chromium/verification/pre-images.json
docs/FORK-DELTA.md
docs/M1-ARCHITECTURE.md
docs/M1-FINALIZATION.md
package.json
tests/tools/config.test.mjs
tests/tools/github-env.test.mjs
tests/tools/overlay-elements.test.mjs
tests/tools/patch-verification.test.mjs
tests/tools/patch.test.mjs
tests/tools/repository.test.mjs
tests/tools/upstream-api.test.mjs
tests/tools/webui-resources.test.mjs
tests/tools/workflows.test.mjs
tests/tsconfig.overlay.json
tools/chromium/generate-patch.mjs
tools/chromium/lib/github-env.mjs
tools/chromium/lib/patch.mjs
tools/chromium/lib/upstream-edits.mjs
tools/chromium/lib/upstream.mjs
tools/chromium/verify-patches.mjs
tools/chromium/verify-pin.mjs
tools/ci/check-webui-resources.mjs
tools/ci/fast-checks.mjs
tools/ci/workflows/ci-fast.yml
tools/design/generate-tokens.mjs
```
