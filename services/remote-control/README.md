# KerfDesk phone control and remote MCP

This separate Cloudflare Worker relays approved workspace reads and edits to an open KerfDesk desktop app. It serves a small phone page at `/control?deviceId=<public UUID>` and standard MCP Streamable HTTP at `/mcp`. The public origin is fixed to `https://kerfdesk-phone-control.cisgz3a.workers.dev`.

The first-party website provides the [Phone & MCP setup page](https://kerfdesk.com/phone.html), with a link into these controls. Controls stay in a top-level page so the existing Secure, HttpOnly, SameSite=Strict session and framing protections remain effective.

No route can start or frame a job, jog a machine, operate a laser or spindle, access files, run shell commands, or grant Pro access. Each desktop request still passes the desktop app's current workspace, revision, client permission and existing Pro-tool checks. A disconnected PC reports unavailable. This service does not make the PC available while KerfDesk is closed.

## Set up a client

1. Enable phone access in the desktop app. Its owner credential is a random 32-byte secret, stored by Electron using the operating system's secure storage.
2. Open the phone control URL shown by the desktop app. Create a pairing code on the PC, enter it on the phone, and request read access or read and edit access.
3. Approve that client explicitly on the PC. A submitted code alone does not authorize a client. No pairing code or owner credential goes in a URL.
4. Use the phone page directly, or configure an OAuth-capable MCP client with the service's `/mcp` URL. The authorization page requires this paired browser, shows the validated client's name and return address, and offers a separate consent decision. Reconnect with a new pairing if the PC initially approved read access only.

OAuth clients must support the maintained provider's OAuth discovery, resource audience, S256 PKCE, and either client metadata documents or dynamic registration. Individual hosted clients can impose their own connector or account requirements; local protocol qualification does not certify every external client's product UI.

## Desktop envelope, version 1

Registration is `POST /api/desktop/register` with `{v:1, deviceId, label, ownerSecret}`. The device ID is a UUID, and the secret is a 43-character base64url encoding of 32 random bytes. An existing ID accepts only its original owner's secret. Only its digest is stored in the Durable Object.

The desktop opens WSS `/api/desktop/connect?deviceId=<public UUID>` with `Authorization: Bearer <ownerSecret>`. The header is required. The relay sends `connected`, then a `clients` snapshot before any commands. Each approved client's ID, label, scopes and creation time appear in the snapshot. Desktop messages and snapshots stay on the same ordered WebSocket; snapshot request IDs must also be correlated in the native consumer.

| Desktop sends | Relay responds or forwards |
| --- | --- |
| `{v:1,type:'pair.create',requestId}` | `pair.offer` with the same UUID request ID, code, original `expiresAt` and remaining `expiresInMs` |
| `{v:1,type:'pair.decide',pairingId,approved,scopes}` | Updated `clients` snapshot; approval must be a subset of the requested scopes |
| `{v:1,type:'clients.list',requestId}` | `clients` snapshot with the same UUID request ID |
| `{v:1,type:'client.revoke',clientId}` | Updated `clients` snapshot; pending work is cancelled |
| `{v:1,type:'clients.revokeAll',requestId}` | Empty `clients` snapshot, then `clients.revoked` with the same UUID request ID |
| `{v:1,type:'result',requestId,result}` | Direct allowed SDK result, such as `{revision,...allowedData}` |
| `{v:1,type:'error',requestId,error:{code,message}}` | Fixed public error; the supplied message is discarded |

Relay commands are `{v:1,type:'command',requestId,clientId,scopes,command:{name,args}}`. Cancellation is `{v:1,type:'cancel',requestId}`. Pair requests include `pairingId`, `clientLabel`, `requestedScopes` and `expiresAt`. Unsolicited snapshots have fresh UUID request IDs. A replacement desktop connection cancels pending old work and does not replay commands. Client revocation is checked again immediately before returning results.

Pairing offers, approval requests, phone claim responses and pending phone status include `expiresInMs`, an integer from 1 to 300000 computed from the original server expiry at dispatch. A replayed pending approval includes only its remaining lifetime; reconnect and status requests never renew it. Consumers use a monotonic local deadline so a PC or phone clock offset cannot hide a server-valid approval. `expiresAt` remains on offers, approval requests and claim responses for released 1.0.7 compatibility. The backend still enforces the original absolute expiry according to server time.

If a claim is rejected, check that the PC reports **Connected to the remote service**, that its computer ID matches, and that the latest code matches exactly, including capitals. Another Create request replaces the preceding code immediately. A successful claim consumes its code once. The phone form accepts either spelling of a public UUID by normalising input to lowercase; this does not migrate owner records or relax case-sensitive pairing codes. A generic rejection does not establish which private condition failed.

The shared portable MCP server in `electron/mcp` defines the exact tools, argument schemas and projected output. The read tools are `get_workspace`, `get_machine`, `get_app_status`, `list_material_recipes` and `review_job`. The edit tools are `set_selection`, `add_text`, `add_rectangle`, `transform_artwork` and `update_operation`. Edits include a fresh `expectedRevision` and caller-generated UUID `requestId`.

## Stored data and expiry

| Record | Behaviour |
| --- | --- |
| Pairing offer and pending claim | Five minutes; one successful claim, at most five incorrect well-formed code attempts per offer |
| Phone cookie and phone-only approval | Fixed eight hours from explicit PC approval; repeated status requests do not renew it |
| OAuth access token | 30 minutes; requires the same live PC approval and audience |
| OAuth refresh grant | Fixed 30 days only when `offline_access` is explicitly approved; refresh does not renew the PC approval lease |
| Consent transaction and unexchanged authorization code | Ten minutes, managed by the official OAuth provider |
| Dynamically registered OAuth client | 90 days of inactivity; successful token exchanges renew registration after half the idle lifetime |
| Owner digest and PC label | Retained for subsequent re-enablement; this version has no device-record deletion action |
| Pending command arguments and results | Memory only, at most 32 concurrent exchanges per PC and a 20-second timeout; no command history or artwork is persisted |

New OAuth token issuance can extend the paired client's approval lease for its token/grant lifetime, without shortening the still-valid phone session. Expired offers and approvals fail immediately according to server time. Physical metadata cleanup happens at the next claim, list, session, authorization or desktop interaction; there is no idle deletion alarm. A PC has at most 20 current clients. Expired phone-only approvals do not consume that capacity after cleanup.

Disconnecting a phone, revoking a client, or disabling access with revoke-all removes the corresponding approval metadata and cancels pending commands. Owner identity remains. Existing OAuth tokens cease authorizing commands immediately. OAuth KV records are not all deleted synchronously by a desktop revocation: a denied refresh triggers the official provider's grant cleanup, otherwise records expire on their own TTLs. The maintained provider accepts the current and most recent previous refresh token for retry compatibility; older tokens fail once the window advances.

The browser uses a Secure, HttpOnly, same-origin cookie and a CSRF token. It does not persist a bearer token in localStorage, sessionStorage or a URL. Project data passes through the relay only for approved reads/edits. Public request limiting uses a hash of Cloudflare connection metadata; the app does not persist the raw IP. Configured provider diagnostics are sampled at 1%, query strings are redacted, and invocation logs are disabled. Provider errors may still contain diagnostic client metadata, so do not promise zero provider logs.

Cancellation covers HTTP disconnect, SDK cancellation, revocation, reconnect and timeout, and ignores late results. Modern protocol clients cancel the HTTP exchange; legacy clients send `notifications/cancelled`. The latter is associated with the authenticated OAuth client, an encrypted per-grant UUID and the exact JSON-RPC request ID in the PC's Durable Object. These associations remain only in memory, are capped at 32 and expire after 20 seconds. Token refresh preserves the grant association. Another app or new authorization sharing the same paired browser cannot cancel that exchange. A cancelled reservation cannot later dispatch to a replacement desktop connection.

MCP tool request IDs must be strings of at most 512 characters or safe integers. An already active ID under the same grant is refused rather than replacing its association. Each reservation also has a fresh UUID required for dispatch and cleanup: an expired request cannot attach to or remove a later reservation that reuses its wire key. Cancellation notifications target the currently active request under the authenticated wire key. The MCP response stream is established before forwarding a tool command so a real HTTP abort can cancel a pending desktop request. Network cancellation is best effort and cannot roll back an edit that already committed.

## Verification and deployment

Use Node 24 and pnpm 11.3.0. The service has an isolated workspace and lockfile. Install the root dependencies first for the shared portable MCP source, then install this service:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm --dir services/remote-control install --frozen-lockfile --ignore-scripts
pnpm --dir services/remote-control exec playwright install chromium
```

Run the service checks from this directory:

```sh
pnpm typecheck
pnpm lint
pnpm format:check
pnpm license-check
pnpm test
```

Set `KERFDESK_TEST_BROWSER=chromium` in CI. By default the mobile tests use installed Chrome on Windows. Tests execute the built Worker with Wrangler's pinned real workerd runtime, synthetic owner identities, isolated SQLite Durable Objects, local OAuth KV, official SDK clients and a mobile browser. Expiry checks use a wrapper injected only into the local witness bundle; no debug clock or audit route is shipped. The local vendor runtime supports compatibility date 2026-09-30; hosted production identity and the configured 2026-10-01 date need qualification after actual deployment.

`pnpm build` is a local Wrangler dry run. It does not deploy or create resources. `pnpm deploy` first checks the fixed name, account, origin, SQLite migration, existing dedicated OAuth namespace and lack of custom routes, then invokes Wrangler. Before deployment, verify the signed-in account is **10d5d0bdb9bf11ca0468db275a787e20**, that **55981c23524446d4ac69a04bfba21803** is the dedicated `kerfdesk-phone-control-oauth` namespace, and that the reviewed candidate matches the native connector. Credentials belong in Wrangler's protected operator profile, never this repository.

Initial deployment creates only the separate `kerfdesk-phone-control` Worker and its SQLite Durable Object namespace under that Free account, binding the existing dedicated OAuth KV. Do not bind the licence service's database or secrets. This configuration uses workers.dev and creates no custom domain or paid plan. Cloudflare Free daily quotas apply to shared account usage and can make requests unavailable. No paid upgrade is required by this implementation.

Production dependencies are pinned and their complete packaged licence texts are generated at `/third-party-notices.txt`. `pnpm license-check` validates the actual transitive production inventory and refuses missing or stale notices. Regenerate notices with `pnpm generate:notices` after a dependency change. First-party KerfDesk source remains proprietary.

Primary references: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [KV pricing](https://developers.cloudflare.com/kv/platform/pricing/), [WebSocket hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [official OAuth provider](https://github.com/cloudflare/workers-oauth-provider), [legacy MCP cancellation](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation), [request cancellation](https://developers.cloudflare.com/changelog/post/2025-05-22-handle-request-cancellation/) and [Workers compatibility flags](https://developers.cloudflare.com/workers/configuration/compatibility-flags/).
