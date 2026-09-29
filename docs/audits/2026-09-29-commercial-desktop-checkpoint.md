# Commercial desktop preparation checkpoint, 29 September 2026

This is a local implementation checkpoint, not a customer release or deployment.
The audit repair remains draft PR #1017. Commercial changes are on
`codex/desktop-commercial-release-20260928` and have not been published.

Prepared: signed trial/paid/developer entitlements, transactional three-seat
authority, encrypted desktop credentials, pre-workspace admission, noninterrupting
licence management, fixed-price Paddle checkout/webhook handling, public signed
Preview downloads, separate eligible commercial Windows updates, explicit
commercial package preparation and a verified immutable commercial publisher.
ADR-523 and the operator documents describe the updated product contract.

## Completed evidence

- Focused integrated Vitest run: 139 files, 981 passed, two skipped. Covers desktop,
  platform adapters, licensing UI, command menus and download links.
- `pnpm test:release-integrity`: 271 passed, including real local workerd/SQLite,
  payment idempotency, publisher interruption/retry and packaged identity contracts.
- Frontend and Electron TypeScript compilation passed; web and Electron main
  builds completed. The last UI font-family adjustment needs the next web rebuild.
- Isolated actual Electron 44.4.5 cases passed for empty commercial admission,
  offline developer admission and the free edition. Gate visibility, splash
  removal, permission denial before admission, clean close and licence-panel
  workspace continuity were observed. Actual Windows safeStorage encrypted the
  synthetic developer grant. The camera listener was stubbed and external network
  access denied. These are unsigned fixtures, not signed installer proof.
- The actual old audit NSIS installer's embedded ASAR was extracted without
  installing and matched the packaged ASAR byte for byte. New commercial publisher
  pairing has regression coverage but has not processed a real signed commercial
  release.
- ADR numbering and `git diff --check` passed. Whole-repository lint/format follow-up
  was still running at this checkpoint; the first lint run found only an untracked
  browser-probe helper, now moved outside the source checkout.

Counts above are overlapping scopes and must not be added into a total.

## Remaining work

Complete the final rebuild, global checks, independent diff review and commercial
PR. Run the full release gate/CI on its final commit. Refresh #1017 checks before
merging; its four desktop package jobs passed, while CI and Chrome smoke were
still running at the last observation.

The public download page currently serves verified free Previews. Before selling
the commercial edition, add and qualify a clear signed commercial Windows
download/trial entry point backed by its separate catalog. Do not direct paid
customers only to the free Preview installer. Final commercial terms, seller
details, support/refund policy and rights review also remain unresolved.

Cloudflare's 14 current skills and five MCP connections were installed globally.
OAuth has not been verified; older requests expired before approval. The newest
request was queued in the Codex browser panel. Browser automation is stopped by
the URL-verification policy, and opening the link through PowerShell was rejected
by automatic approval review. A fresh Codex session must load the new connections
before continuing account setup. Preserve the existing default Wrangler login.

Correct-account Cloudflare deployment/R2/domain setup, Paddle onboarding and sandbox
qualification, actual developer-key issuance, Windows signing credentials, genuine
signed installation/update qualification and macOS notarization remain external
launch work. No live payment, developer key, commercial installer or hardware
operation was performed at this checkpoint.
