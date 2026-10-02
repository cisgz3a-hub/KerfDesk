# KerfDesk product audit - 2 October 2026

This audit covers the current browser and Windows desktop source, licensing and
Free/Pro admission, numeric editing, new-job settings, Frame/Start ownership,
power output, positioning marks, phone/MCP access, downloads, updates and release
controls. It combines independent reproductions, focused scenarios, actual
Windows encryption checks, public hosted responses and inspection of the actual
published installer. Software checks are not physical-machine qualification.

The source baseline is `e220d01f26336bc3575f095be75492669700096a` from current
`origin/main`. Repairs were isolated in `codex/full-product-audit-20261002`; the
dirty primary checkout, customer profiles and running applications were preserved.
The latest 30 pull requests and the one open draft were inspected. No machine was
connected or operated, no real payment or customer activation was performed, and
no customer phone or ChatGPT grant was approved.

## Confirmed findings repaired

| Severity | Verified reproduction | Repair and qualification |
| --- | --- | --- |
| P1 | A saved S255 profile with current `$30=1000` emitted S255 at 100%. In the reverse case, saved S1000/current `$30=255`, 25% emitted S250, approximately 98% of the nominal current range. Actual reviewed Start handoffs reproduced both with a mocked transport. | Fresh GRBL-family laser output uses the current session-stamped positive finite maximum before vector/raster compilation. Save, Preview, ETA, Frame preparation, worker paths and Start share it. The authored profile stays unchanged. Review, durable handoff and final wire assertion reject stale executable ownership; the unchanged spatial Frame remains valid. ADR-567 documents fallback, fractional ranges and frozen recovery bytes. |
| P2 | Subtract, Intersect and Exclude cloned existing Pro CNC settings into new independent operation IDs in desktop Free without admission. All three operation families reproduced the bypass. | Boolean results use the canonical guarded copy transaction. Deferred approvals cannot edit a replaced project, commit twice or mutate history before admission. |
| P2 | Weld created independent effective Pro operations when object power or an operation override required isolation, without admission. | An operation-only classifier guards those clones. Ordinary Weld that keeps existing operation IDs remains available in Free, as do editing, Frame, Start and export of existing Pro work. ADR-540 Amendment 3 records this boundary. |
| P2 | The actual second-pass Worker handler prepared saved S1000-scale bytes for a controller currently reporting `$30=255`; Frame and Start retained the bytes, but the review showed only generic saved-power text without the explicit current-range difference. | Second-pass review adds the saved/current-range disclosure from the execution profile and captured controller evidence. Updated evidence changes the displayed review and requires fresh affirmation. Original bytes and Frame remain intact; no new output or entitlement gate is introduced. |
| P2 | The scheduled Preview reminder failed in run 37009515797 because GitHub refused an issue body over 65,536 characters. Local CLI reproduction with the actual main history generated 74,361 UTF-16 units / 74,388 bytes. | The reminder draft is bounded to at most 60,000 UTF-8 bytes, preserving complete displayed PR links and Unicode graphemes, explicit omission/title counts, an exact comparison and full-note regeneration command. Candidate, tag and due outputs remain identical. Twenty-seven focused cases pass; three size regressions fail on the original source. Independent root review confirms 59,992 bytes, 442 displayed changes and 113 explicitly omitted. Live issue creation was not performed. |

The two Pro repairs have 53 new substantive regressions, with 121 focused cases
passing after final wiring. Six independent nested/legacy scenarios did not
substantiate another executable bypass. An unknown nested CNC property that
survives parsing does not become a compiled CNC operation; materialized legacy Pro
operations remain guarded when duplicated.

An independent after-repair witness repeats the original actual-Start mismatch
scenarios. Complete integrated checks are recorded after the final source freeze.
No claim of measured watts follows from equality of the S command and `$30`.
M4 dynamic power, acceleration, `$31`, firmware PWM limits, calibration, focus
and material behaviour still affect a real burn.

Independent review also caught an update compatibility regression in the first
power repair: older fractional vector and streamed image archives could fail
their exact-byte recovery checks. Prepared output now records power encoding
version 2; older archives without the field retain historical version 1.
The original preserved schema-2 fixtures recover and re-emit exactly their
original programs, remain unmodified, and reject unknown version 3. Fresh
fractional Marlin inline, Marlin fan and Smoothie vector output remains
byte-identical to the baseline. This qualifies the archive hydration and
re-emission seams, not a two-version installed customer upgrade.

The new encoding version is also included in the pending second-pass source
seal. Real native Chromium Worker checks reproduced an in-place version change
escaping the old seal; regressions cover version 2 to 1 and a legacy missing
version changing to invalid null. Historical missing/1 share version-1 semantics;
invalid versions cannot retain a previously valid preparation proof.

## Checklist and evidence boundaries

| Area | Result | Evidence boundary |
| --- | --- | --- |
| Blank/delete/retype numeric fields | Pass in nine native Chromium scenarios, plus focused component cases. Decimal typing, min/max handling and automatic recovery selection checked. | No new typing defect reproduced in the current source. This does not identify every customer's older installed build or input method. |
| Font browsing and text editing | Three actual Chrome end-to-end scenarios pass at 1024 by 600 and 1024 by 768: popup containment, scrolling without moving the text panel, retained browse position while typing, selected-font visibility on reopen, keyboard focus and a long imported filename. | Desktop renderer with isolated test contexts; no customer text or font was accessed. |
| New canvas and machine retention | Pass. Remembered machine/profile and mode persist; New resets stock/process settings and disables previous operation defaults. Open/recovery preserve independently remembered machine choice. | Source/store scenarios; no customer data changed. |
| Frame and previous-job lifecycle | Existing completion, return, cancellation, session replacement, geometry changes and Frame reuse scenarios checked. Power/speed changes retain unchanged spatial Frame. | Software/controller-simulator evidence. Physical bounds, actual return position and mechanical accuracy remain unqualified. |
| Positioning mark and Line start | Existing exact final-program entry, dark travel/return, bounded one-second pulse, consent, session/ACK ownership, concurrent Start/Frame refusal and Line start persistence scenarios reviewed and checked. | Commanded low power is capped separately from normal job normalization. No material was marked. |
| Saved paid/trial licence | Eleven isolated Electron 44.5.1 processes with real Windows safeStorage passed encryption, relaunch, device binding, offline failure, update coverage, trial expiry and rollback scenarios. | Synthetic signed entitlements and separate profiles; app-process restart, not an OS reboot, power loss or installed customer upgrade. |
| Trial reuse and entitlement signatures | Service/source scenarios pass. The authority reuses the original 30-day trial for the same stable Windows installation digest; modified claims, wrong devices/signers and malformed grants fail closed. | Not a unique immutable physical-PC identity. Administrator modification, Windows identity replacement and restored clock/state snapshots remain DRM limitations. |
| Browser Free / desktop Pro | Current hosted browser is Free. Prepared commercial desktop prompts for new Pro work; existing Pro projects stay usable. | Deliberate existing-work reuse is product policy, not a newly discovered bypass. Source/Preview builds must not be mistaken for commercial builds. |
| Electron privileges and project files | Context isolation, sandbox, CSP, origin/header guards, constrained navigation, token-bound paths and atomic project saving pass source/software checks. | Two existing Windows symlink tests remain skipped; no customer project was opened. |
| Actual Windows download | Fresh signed metadata and signed improvement notes verify. The 1.0.7 installer has the exact authenticated size/hash; extraction, configured binary fuses, packaged dependency closure, renderer CSP and commercial trust metadata pass. | Installer inspected, never executed. Resource readback hashes are derived from the authenticated artifact, not an independent producer receipt. |
| Unsigned update flow | Discovery, improvement notes, consent, interrupted downloads, restart cleanup, approved close and interactive installer handoff pass. | This channel is unsigned. Ed25519 release authentication does not supply Windows Authenticode. OS notification delivery and current installed upgrades were not observed. |
| Browser update | Actual Chrome audit tab detected a waiting update and applied it. Current Free build and Frame text appeared. | Old cached builds intentionally await the user's update action. Other tabs and their work were preserved. |
| Mobile website setup | Android/touch emulation at 390 by 844 opens the licence page with no canvas. The visible Phone & MCP link opens the setup instructions and relay connection link. | Actual Chrome with phone emulation; no physical phone qualification. Width alone does not identify a phone. |
| Phone/MCP authorization | Current relay assets match source. Canonical MCP rejects missing authorization, foreign Origin and credentials in URL. Five read/five edit tools expose bounded workspace work; no machine movement, Start, Frame, firing, raw G-code, local file opening, licence or payment tool. | Twelve prior actual live relay/source-Electron scenarios reviewed. Two fresh workerd adversarial cases prove durable revocation after restart with positive controls and refusal of a result after lease expiry. Customer ChatGPT linking remains pending. |
| Download countries and retention | Twenty-nine local report/server scenarios pass retention margins, aggregation, partial downloads, security and error handling. | No analytics-read credential was available. Live country totals and retention were not freshly qualified. Request counts estimate downloads, not unique people or completed installations; countries reflect network location. |
| Dependency security/licences | Fresh audits report zero advisories across the app's 960 dependencies, including 66 production dependencies, and the remote service's 216 dependencies. The reachable desktop graph matches the packaged allowlist. Licence and full release checks are final integration gates. | A clean advisory result does not prove absence of every vulnerability. |

The desktop lane passed 325 distinct cases with two existing Windows skips.
Counts from focused lanes overlap the full suite and must not be added together
to produce an inflated audit total.

The independent final cancellation recheck passed 28 scenarios, including the
console-jog accessory cleanup and replacement-controller hold-Abort simulations.
Four independent actual-Start/control scenarios passed after the power repair.

Six native Chromium Worker scenarios passed image scaling, fractional grayscale,
changed-range cache identity and actual-font variable-text snapshot/async parity.
Separate native second-pass Worker checks qualify structured-clone version
retention and the pending version seal. These use isolated browser contexts and
injected controller observations, with no physical machine.

The final nine-file follow-up batch passes 132 cases, including the seven
failures from the first integrated run. Five failures came from a shared test
fixture incorrectly carrying an ordinary fresh-job power binding into a frozen
second pass. The other two assertions expected the earlier power/warning
behaviour. The production Worker already omitted that fresh binding; its exact
bytes remain unchanged. Two final actual native second-pass Worker scenarios
pass fractional version retention and refusal of a pending source-version change.

The full local `pnpm release:check` passed on the frozen application/licensing
tree from 14:42 to 15:17 UTC. It recorded **26,852 passed / 29 skipped** tests
across **3,469 passed / 18 skipped** files, 495 release-integrity cases, 39 website
cases and 42 remote-service cases. TypeScript, lint, formatting, privacy,
dependency licences, ADR numbering, Actions pinning, web/Electron main builds,
file-size and index-export checks passed. All 64 changed file hashes remained
unchanged during the gate.

The isolated two-file reminder repair was integrated after that frozen run.
The integrated release-integrity suite passed **500/500** cases, with scoped lint
and formatting also passing. Its first attempt encountered a Node cloned-data
deserialization error in an unchanged packaging test file; that file's 13 cases
and the whole unchanged rerun passed. Both receipts remain available.
The final PR and main commits require their own complete GitHub checks and actual
Pages publication proof. Local focused counts overlap and are not added to the
full test total.

## Production and release state

At the public check on 2 October at 13:18 UTC, the browser served Free source
`e220d01f`, version `0.1.3005`. Website and relay assets matched current source.
The published desktop was **1.0.7**, source
`a03d8b2e3d44ff4eda66acbea78620167c3db0ff`, published 1 October at
23:04 UTC. Its authenticated installer is 116,845,331 bytes with SHA-256
`5b6b4bce7b960c37820e7cdd325c134e347c13021f52f57d89e58c06b724a890`.

The actual 1.0.7 archive lacks the newer monotonic pairing-state module from
PR #1060. Desktop/renderer changes in #1062 and the later job/Pro fixes also await
a desktop release. Current source and a current live relay do not prove that an
installed 1.0.7 customer has those improvements.

The verified release planner reports **4 of 20** merged PRs after the current
desktop release. This audit repair will count as one further PR when merged.
The maintainer's 20-PR rule remains in force; this audit does not silently override
it or claim that a merge updates installed desktop bytes.

The approved Cloudflare OAuth identity, account and membership were verified.
Account identifiers remain in the local protected-identity receipt. Three
subsequent protected licensing deployment
reads returned HTTP 429; advertised cooldowns were honoured. No alternate account,
credential or expanded scope was used. The current production worker version,
crypto/admin binding presence and live trial/paid activation remain unverified.
After more than an hour, a single unchanged-credential identity recheck at
14:19 UTC also returned HTTP 429 from `/user`. No protected operation followed
that refused identity read.

The separate credential-free public check at 13:30 UTC returned HTTP 200 and
`ok:true` from `/v1/public/health`. `/v1/public/config` returned `enabled:false`
with no checkout provider. This verifies service liveness and that public
checkout is disabled; it does not establish signing readiness or successful
activation. Production purchases are not qualified as open.

Paid/trial licences remain encrypted through normal app shutdown and startup.
Covered paid versions remain usable after their update-eligibility year ends;
that is distinct from entitlement to a later release. Trial expiry stops new
Pro choices without deleting the saved credential. Transient refresh failure
keeps saved rights. Definite revocation, seat release and explicit deactivation
have separate removal semantics. Existing paid session access remains latched
until restart by current policy. No licence-retention policy was changed here.

## Earlier six claims rechecked

| Earlier claim | Current verdict |
| --- | --- |
| #1039 unsigned NSIS verification always searches the wrong outer archive | Not reproduced with the supported actual candidates and bundled extractor. Current five-resource verification passes cached 1.0.3 and freshly authenticated 1.0.7. The extractor detects the embedded payload. |
| #1025 console-jog Abort leaves accessories on | Corrected by the intervening cancellation cleanup on main; focused regression and final suite cover accessory-off cleanup. No hardware was operated. |
| #1025 pending Abort resets a replacement controller | Corrected by session ownership on main; cancellation race regressions cover replacement connections. |
| #1039 offset/outline clones bypass Pro admission | Corrected on main; copy admission controls pass. Boolean and isolated Weld were separate omissions found and repaired by this audit. |
| #1041 automatic recovery leaves an invalid numeric draft | Current numeric/component and Chromium scenarios pass; automatic selection clears the invalid draft. |
| #1033 saved licence refresh precedes first-use agreement | The currently pinned draft wraps startup in its terms gate; current Electron waits for trusted workspace-ready. The old finding does not reproduce against that combination. The draft remains unpublished, conflicting and unmerged; activating it still needs integration qualification. |

The only open PR at the refreshed audit read was draft
[#1033](https://github.com/cisgz3a-hub/KerfDesk/pull/1033), exact head
`775abeaa1556df188ae9e376cb65a166cc5ff87c`. Its legal publication date, legal text,
LICENSE and EULA were not changed or merged.

## Qualification still required

- Correct production licensing deployment/signing proof, a real trial and paid
  activation/revocation lifecycle, and analytics-read access for live country and
  retention evidence.
- A new authenticated desktop release followed by two-version installed upgrade
  qualification with paid/trial profiles; actual Windows shutdown/power-loss and
  native notification delivery.
- A physical phone and the customer's actual ChatGPT account connection. The
  prepared connection page grants no access until pairing and explicit PC approval.
- Real controller, material and optical-power qualification. This audit cannot
  certify mechanical position, laser watts or safe operation of a physical machine.

## Research and local receipts

Primary sources were read for [Electron security](https://www.electronjs.org/docs/latest/tutorial/security),
[safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage),
[electron-builder updates](https://www.electron.build/auto-update.html),
[LightBurn licence management](https://docs.lightburnsoftware.com/latest/Reference/LicenseManagement/),
[MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization),
[OpenAI plugin authentication](https://developers.openai.com/plugins/build/auth),
[Durable Object lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)
and the pinned GRBL/grblHAL/FluidNC sources linked in ADR-567. Research informed
checks; it does not substitute for the deployment and hardware gaps above.

Local evidence is under `D:/LaserForge/full-product-audit-evidence-20261002`:

- `licensing/audit-report.md`, `licensing/owned-source-freeze.json`, eleven
  `licensing/native-*-receipt.json` files and focused test JSON.
- `jobs/power-scale-receipt.json` (before repair),
  `jobs/power-scale-root-postfix-receipt.json` (independent after repair), numeric
  Chromium receipt/screenshot and job repair qualification.
- `licensing/power-review/independent-review.md`,
  `prior-archives-after-fix-receipt.json` and
  `dialect-isolation-after-fix-receipt.json` preserve the independent update
  compatibility checks and their original fixtures.
- `jobs/power-browser-worker-receipt.json`,
  `second-pass-live-range-disclosure-receipt.json`,
  `second-pass-native-worker-before-seal-receipt.json` and final follow-up
  receipts qualify actual Worker routes and the saved-job protections.
- `desktop/desktop-audit.json`, `desktop/remote-security-audit.json`,
  `desktop/published-1.0.7-inspection.json` and runtime dependency audit.
- `abort-recheck-vitest.json`, `font-picker-e2e.json`, `full-dependency-audit.json` and
  `remote-dependency-audit.json`.
- `live-distribution-2026-10-02T13-18-36-498Z.json`,
  `public-licensing-2026-10-02T13-30-03-260Z.json`, rate-limit receipts,
  `download-dashboard-checks.log` and `mobile-phone-setup.png`.
- Final integrated release-check and exact PR/main/deployment receipts, recorded
  after source freeze. These final checks are not claimed by the earlier receipts.
- `preview-cadence/cadence-repair-qualification.json`,
  `preview-cadence/root-independent-review-receipt.json`, original/updated CLI
  drafts and the integrated release-script receipt preserve the reminder repair.
