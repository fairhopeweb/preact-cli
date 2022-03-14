---
'@preact/async-loader': major
'preact-cli': major
---

- Upgrades to Webpack v5
  - Any custom configuration you do in your `preact.config.js` may need to be altered to account for this. Plugins may need replacements or different option formats.

- `--esm` flag has been removed
  - Dual output is now enabled by default in production builds.
