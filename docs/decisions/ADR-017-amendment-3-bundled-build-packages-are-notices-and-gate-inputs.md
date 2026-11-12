## ADR-017 Amendment 3 - Packages the build bundles are notice and licence-gate inputs (2026-11-12)

**Status:** Accepted on 2026-11-12 |
**Amends:** ADR-017 policy 2 (the enforced allowlist) and the release-notice scope that
`scripts/generate-third-party-notices.mjs` implements

### Context

Oracle audit O1 area O11 (supply-chain truth) found code that ships without being a production
dependency. `pnpm licenses list --prod` sees only `dependencies`, but the build also copies code
from development dependencies into what users run:

- `src/ui/app/PwaUpdateWatcher.tsx` imports `virtual:pwa-register/react`, which bundles
  vite-plugin-pwa's register hook and workbox-window into the app (ADR-060, ADR-227).
- `vite.config.ts` runs `VitePWA` in its default `generateSW` mode. Workbox writes a service-worker
  runtime (`workbox-<hash>.js`) from workbox-core, -precaching, -routing, -strategies, -expiration
  and -cacheable-response.
- `services/remote-control/scripts/build-app.mjs` bundles the phone service's MCP workspace view,
  with @modelcontextprotocol/client and @modelcontextprotocol/ext-apps, into
  `electron/mcp/workspace-app-ui.ts`, which ships in the desktop's `dist-electron`.

All of these are MIT or Apache-2.0, so nothing forbidden shipped. But the minified files keep no
copyright line, the release notices did not name them (rolling v2 11-P3-5, O11-P3-1, O11-P3-2),
and the licence gate could not have stopped a copyleft package arriving the same way.

ADR-017 policy 2 also approves Zlib on its own, but the gate accepted it only inside
`(MIT AND Zlib)`.

### Decision

1. `scripts/third-party-closure.mjs` keeps a pinned list, `BUNDLED_BUILD_PACKAGES`, of the
   development packages the build bundles. The notices generator reproduces each one's licence
   files under "Development packages the build bundles into the app", and fails if a listed
   package is missing from the install or installed at more than one version.
2. `DESKTOP_MCP_VIEW_PACKAGES` names the phone-service packages bundled into the desktop MCP view
   that the root install lacks. The generator checks the version the phone service pins and that
   the root package it shares a LICENSE with still has the reviewed SHA-256.
3. `pnpm license-check`, run from the repository root, also checks the licences of
   `BUNDLED_BUILD_PACKAGES` from `pnpm licenses list --dev`.
4. Adding a development package whose code ships means adding it to that list in the same change,
   with the same licence review as a production dependency.
5. Both notice generators read every top-level `LICENSE*`, `LICENCE*`, `COPYING*` and `NOTICE*`
   file, so an Apache-2.0 §4(d) NOTICE travels with its package (O11-P3-3).
6. The gate's allowlist adds standalone `Zlib`, as policy 2 already allows.

### Consequences

- The release notices name every package the shipped app contains code from, not just the
  production closure.
- A change in how Vite, Workbox or the phone build bundle code shows up as a failing notice
  check rather than as unlisted code.
- The list is maintained by hand. Its test (`scripts/third-party-closure.test.mjs`) checks that
  every listed package is installed and has a notice section; it cannot discover a new bundled
  package by itself.
