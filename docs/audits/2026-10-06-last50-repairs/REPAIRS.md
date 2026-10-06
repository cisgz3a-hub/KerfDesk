# Latest-50-PR audit repairs

Source baseline: `402bddb9314099fcc2da6550fb9246cd3b9d0f72` (main, 6 October 2026).
This candidate integrates the pending #1070 and #1071 heads and repairs the six
additional defects reproduced by the latest-50-PR audit.

## Repair checklist

| Finding | Implemented behavior | Regression evidence |
| --- | --- | --- |
| D01: cancelled Install and close retains consent | A rejected/cancelled guarded close retires that exact installer arm. A newer explicit deferred-install choice remains intact. | Actual update/close/licensing owners with synthetic signed releases; six new composed cases plus close/route regressions. |
| D02: failed trial request blocks Free updates | No-licence Free and ended signed trials still accept matching signed updates after trial request/refresh failure. Active paid/trial rights retain trust, identity, expiry and mutation checks. | Six real-crypto cases across both Free lanes and negative entitlement boundaries. |
| M1: grblHAL integer decimal suffix changes value | Integer settings use exact digit-only encoding before dispatch. Fractions, overflow and representations the firmware would corrupt are refused. | Pinned firmware parser and guarded-settings simulator, including decimals and unsafe precision. |
| M2: old Wake clears replacement recovery | Wake reads, writes, cleanup and errors belong to one operation and connection/session owner. Owned reset-banner and Alarm settlement still work. | Fourteen final ownership races, including the helper-await microtask gap and pure Alarm status. |
| PHONE-01: polling exhausts software Abort admission | Public ingress, credential verification, approved ordinary commands and approved Abort use separate bounded allowances. Legacy Abort-only batches retain the reserved lane; authentication and scopes precede approved quotas. | Real local Workerd, both official SDK generations, phone CSRF/revocation negatives and token/grant rotation. |
| PHONE-02: remote review silently truncates facts | Complete native totals and contiguous bounded pages replace silent slices. Page reads recheck caller, review and revision; both UIs clear cached/late private pages on disclosure changes. | Actual compiler beyond 200 warnings/operations, both Chromium UIs, an independent 80-model/1,336-page reconstruction oracle. |
| #1070: recipe envelope exceeds MCP budget | Ordered bounded recipes fit the complete text/structured envelope, with truthful total/truncation metadata. | Actual material catalogue through both SDK generations and byte-budget tests. |
| #1070: dialog restores descendant autofocus | Opener capture precedes descendant autofocus; closing restores the valid opener or existing fallback. | Mounted hook cases and four real Chromium focus workflows. |
| #1071: extra Free tracing modes | Line Art alone is Free; other visible tracing choices request desktop Pro. Browser-Free excludes Pro tracer data. Existing desktop work/output follows ADR-540. | Picker/entitlement/data-boundary tests. |
| #1071: large Save blocks the interface | Canonical preparation runs in a real background worker; file picking follows a fresh gesture, and cancellation preserves dirty edits. Strict packed transfer preserves unsupported data via fallback. | Large-project/packed eligibility tests and two real Chromium worker/save workflows. |

## Local verification

These counts describe separate runs and overlap; they are not summed into a
unique test count.

- Desktop update/licence: 98 tests across seven files passed.
- Machine/settings: 154 tests across eleven files passed; all fourteen final
  recovery ownership cases passed after the last continuation repair.
- Pending #1070/#1071 integration: 129 tests across twelve files passed.
- Final MCP integration after pagination/disclosure changes: 75 tests across
  five files passed.
- Native remote-control suites: 31 tests across six files passed.
- Worker/phone suites: 52 tests across five files passed; nineteen additional
  focused authentication, replay and cancellation cases passed.
- Browser dialog/background-save workflows: six passed in installed headless
  Chrome. Both new review interfaces passed ten paging/disclosure/Abort cases.
- Independent Workerd/SDK probes verified legacy Abort batches, modern Abort,
  and ordinary quota continuity across token/grant rotation. The independent
  page oracle verified 1,336 pages from eighty deterministic models.
- Unsigned installer/update-note/CI contract scripts: sixteen cases passed.
- Renderer, Electron and e2e type checks, scoped/full lint checks, owned-file
  formatting, file-size, index-export, ADR/action-pin, privacy and browser
  discovery checks passed. The Worker production-configured dry run passed
  with all four rate bindings.

No dependency or lockfile change was needed. Existing NTFS-linked dependencies
matched the root/service lockfiles. Hosted exact-head CI is a separate gate.

## Publication and qualification boundary

The repair source does not by itself update a customer installation or the
hosted relay. The relay must deploy with all four rate bindings; complete review
paging also requires the updated desktop renderer. No new Durable Object
migration or re-pairing is required.

At fresh signed-feed readback on 6 October, the public desktop remained
**1.0.10**, source `6c62d5a6bfd16210a9c6fa340e60722dba4edad0`.
The next reviewed customer highlights name that exact baseline. The standing
ten-PR release cadence is unchanged; this work does not request an early release.

DEPLOY-01 is the obsolete Cloudflare Worker named `kerfdesk`, whose duplicate
Git build fails after successful app compilation. Its workers.dev URL, routes
and custom domains are disabled. The canonical Pages deployment is separate.
Disconnecting only that unused Git build trigger is prepared but awaits the
owner's approval after automatic approval review rejected that exact provider
change. No trigger, Worker data, legal terms or seller state was changed.

Local tests use synthetic credentials, approvals and controller replies.
This repair does not qualify native customer installation/shutdown, live paid
activation, hosted ChatGPT rendering, physical phones, physical controllers,
material output or a guaranteed network emergency stop.
