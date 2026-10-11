# KerfDesk Remote app

One React app, two targets (ADR-582):

- **Phone** (`src/entry-phone.tsx`): served by the Worker at `/app/`. Cookie session, CSRF header and a live socket (`core/phone-transport.ts`).
- **MCP Apps panel** (`src/entry-mcp.tsx`): one self-contained HTML document for ChatGPT, Claude and other hosts. Calls go through the host with `@modelcontextprotocol/ext-apps` (`core/mcp-transport.ts`); `mcp/app-tools.ts` registers the view-only `ui_*` tools and publishes model context; `mcp/McpRoot.tsx` picks the inline card, fullscreen app or picture-in-picture view.

`core/controller.ts` owns reads, live sync (socket events, else `wait_for_change`, else 5-second polling), every write (current revision plus a fresh UUID, or the identical request again after an uncertain reply) and machine actions (receipts are followed, never re-sent). `core/store.ts` is a small external store read with `useApp`. `core/scene.ts` decodes the scene and hit-tests real geometry.

Build and check from `services/remote-control`:

```sh
pnpm build:app          # writes public/app/* and electron/mcp/workspace-app-ui.ts
pnpm typecheck          # includes tsc -p app/tsconfig.json
pnpm lint
node --test test/remote-app-ui.test.mjs test/remote-app-live.test.mjs test/push-crypto.test.mjs
```

The browser tests serve the built phone app under its real CSP with a synthetic PC, and load the MCP panel in an iframe behind a minimal host that speaks the ext-apps handshake. They are not evidence for a real phone, a hosted Worker, a live MCP host or a machine.
