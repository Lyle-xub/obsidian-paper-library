# Embedded Claudian runtime

- Upstream: <https://github.com/YishenTu/claudian>
- Embedded version: `2.2.5`
- Release: <https://github.com/YishenTu/claudian/releases/tag/2.2.5>
- License: MIT (`LICENSE.claudian.txt`)

`claudian.bundle.js` and `claudian.css` are the upstream release artifacts embedded
as Paper Composer's desktop runtime. The bundle is intentionally kept complete so
that Claudian's agents, sessions, tabs, Inline Edit, Plan Mode, Skills, MCP, Vault
Agents, checkpoints and settings remain available. The parent plugin disables the
standalone collaboration surface.

To coexist with a separately installed Claudian plugin, Paper Library applies only
these isolation changes to the release bundle:

- view types use the `paperlib-paper-composer-*` namespace;
- every runtime DOM class and CSS variable uses the `paper-composer-*` namespace;
- runtime storage uses `.paperlib-claudian/` instead of `.claudian/`;
- the device settings local-storage key is namespaced to Paper Library;
- the embedded runtime receives its own `paper-library-paper-composer-runtime`
  plugin identity, so command registration and unload never touch Claudian;
- activation always resolves a dedicated Paper Composer right-sidebar leaf;
- Markdown linking is handled by a parent-owned bridge that only updates the
  embedded Paper Composer controller;
- global file-menu actions are labelled `Add to Paper Composer`, while an
  installed Claudian keeps its own `Add to Claudian` action;
- visible launcher branding and the view icon are changed to Paper Composer.

Paper Library then adds its own context bridge for paper rows, PDFs, images,
research nodes, PDF text selections and Ask AI region captures. Authentication is
left to the selected official CLI harness; no OAuth credentials are copied into
the Paper Library plugin data.
