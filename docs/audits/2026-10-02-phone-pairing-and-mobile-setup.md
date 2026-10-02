# Phone pairing and mobile website audit, 2026-10-02

Baseline: `a03d8b2e3d44ff4eda66acbea78620167c3db0ff`, the source published in unsigned Windows 1.0.7. The reported phone rejection and absent desktop prompt motivated this audit. The customer states that the code was newly created. No customer code was submitted during the investigation.

## Confirmed findings

- An older same-session poll can restore an offer after Create pairing code clears it. Separately, native offer handling accepts an earlier creation response while a replacement request is pending. Immutable baseline reproductions confirm both races. A newly shown offer can consequently already have been replaced at the relay.
- Native offer and request parsing uses the PC's wall clock to validate a server timestamp. A PC 30 seconds behind discards a fresh five-minute offer; a PC 150 seconds ahead hides a request with 149 seconds of server lifetime. These are independently reproduced native-runtime defects.
- The unsolicited approval dialog initially focuses Reject. A keypress intended for another field can activate that button. The repair uses the existing surface-focus option, retaining explicit buttons and keyboard navigation.
- UUID validation accepts either letter case, but textual relay routing distinguishes case. Real workerd rejects an uppercase spelling of the same fresh ID and accepts the original lowercase spelling immediately afterward. The first-party phone form now normalises the ID; existing owner-record routing is preserved. The photographed ID is lowercase, so this finding does not diagnose that incident.
- The mobile website exposes purchasing and download links without a discoverable phone-control setup entry. The repair adds a Phone & MCP entry and setup page while preserving the canvas-free mobile flow.

## Interpretation and trust boundaries

The photographed message matches the baseline phone page's generic HTTP 403 fallback. The visible pairing form and absent desktop prompt are consistent with claim rejection, but the exact request and approval-delivery stage remain unverified. The message does not establish code expiry. Fresh same-origin mobile Chrome pairing succeeds in the unchanged baseline, returns HTTP 202 and delivers the actual approval request. Origin remains present under the production no-referrer policy.

Clock skew alone would ordinarily leave the phone waiting after HTTP 202; it does not explain the photographed 403-style message. The stale-offer race is a plausible cause, but the customer's exact event remains unverified. Missing Origin, a disconnected owner, a replaced or used code, failed-attempt lockout and capacity can also reject a claim. The same generic message can also cover permission or CSRF refusal, and the visible panels are not a request trace.

Server expiry, single-use codes, explicit PC approval, Origin checks, OAuth scopes and client revocation remain authoritative. New remaining-lifetime fields support monotonic desktop presentation without extending backend expiry. Existing 1.0.7 clients retain the absolute timestamp field. No motion, Frame, Start, machine connection, G-code or shell capability is added.

Controls open through a full-page navigation to the existing relay. Secure/HttpOnly/SameSite Strict cookies, framing refusal and the fixed public origin are preserved. No credentials enter the static setup page. PWA fallback excludes the setup page so an unavailable page cannot become the desktop canvas.

## Verification and publication

Local verification passes 79 focused native/UI cases, 41 real workerd/mobile service cases, 39 website cases and two production-browser scenarios. Independent browser checks cover keyboard/touch navigation, direct setup routes, mobile widths and service-worker exclusions. Type checking, lint, privacy generation, formatting, licence policy and the focused update-note checks pass. A fresh independent review finds no additional attributable blocker; seven more native presentation-state scenarios pass. The complete PR checks passed at `4666db08daa2a1d2ae860da5f929fb52c36cb0b6`. Final integrated release and publication receipts are kept with the external evidence.

Publication is separate from these results. The relay must be updated before a new desktop build requires remaining-lifetime fields. Record exact source, checks, deployment identity and served asset hashes before treating the repairs as published. Source tests do not prove a customer's installed runtime or a physical phone. The desktop release remains subject to the maintainer's 20-PR cadence unless the maintainer requests an exception.

External causal receipts are retained under `D:/LaserForge/phone-pairing-evidence-20261002`, including `baseline-pairing-races.json` and `independent-baseline-pairing.json`. Baseline source hashes identify the unchanged code used for reproduction.

## Primary sources checked

- [Node performance clock](https://nodejs.org/docs/latest-v24.x/api/perf_hooks.html#performancenow): process-relative timing supports local lifetime tracking independently of wall-clock correction.
- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security): validate privileged callers and retain sandbox/context-isolation boundaries.
- [Cloudflare Durable Object WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/): attachments and socket recovery are separate from in-memory state. No hibernation defect was substantiated.
- [Cloudflare Wrangler profiles](https://developers.cloudflare.com/workers/wrangler/profiles/): verify the authorised account/profile before deploying the fixed relay target.
