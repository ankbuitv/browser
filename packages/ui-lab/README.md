# UI development harness — not the Aurelia browser

This directory is a **development and test harness for components that are meant
to become real Chromium WebUI/resources**. It is not the browser, it is not a
product surface, and a preview here is never evidence that a browser feature
works (`docs/PROJECT-STATUS.md` explains why that distinction is enforced).

What it is for:

- seeing token-driven styling and both themes side by side;
- checking that a component can be built from `packages/design-tokens` before it
  is written as WebUI resources;
- keeping the "harness copies, never the reverse" rule visible: the shipped
  implementation lives in `chromium/overlay/chrome/browser/resources/aurelia/`,
  and when a component is integrated there, the harness loads the shipped
  implementation where practical.

Run it:

```bash
node tools/dev/serve-ui-lab.mjs --port 5174
```

No bundler, no framework, no build step and no runtime dependency on Node:
the harness is plain ES modules reading the same generated CSS the WebUI
consumes.

The page labels itself as a harness in a banner that cannot be missed, and the
server sends `x-aurelia-harness: development-harness-not-the-browser` with every
response so screenshots and automated checks can prove where they came from.
