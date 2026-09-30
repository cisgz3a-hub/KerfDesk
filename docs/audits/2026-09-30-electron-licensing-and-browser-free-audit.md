# Electron licensing and browser Free audit

Date: 30 September 2026. Baseline: `b232944069681a00c319404ced30c4e4d816c11d`.

At the baseline, the desktop licence system was already substantially implemented and merged, but was not ready for a paid commercial launch. The browser still exposed Pro features, and changing its existing Free switch alone would not meet the requested strict browser Free policy. This audit reproduced both an outbound checkout failure and normal UI paths that apply Pro operations without a Pro check.

This is a source, local test, repository/release evidence and public endpoint audit. It does not certify the installed commercial product, penetration resistance, physical machines or legal enforceability. The audit phase changed no application code. Following the owner's instruction to carry out the work, the local implementation below was prepared. No provider settings, licences, purchases, releases or hardware were changed. The primary dirty checkout and the other active audit's work were preserved.

## Implementation continuation

Work is isolated on `codex/browser-free-desktop-licensing-20260930` in
`D:\LaserForge\electron-licensing-audit-20260930`. It has not been pushed, merged or
deployed. The implementation verification below describes this local draft.
Sections explicitly labelled baseline retain the original audit evidence; local
fixes are not yet serving customers.

- Browser Free is enabled, with Pro implementations removed from renderer and
  worker entry points. Desktop uses an explicit build mode, and package checks
  reject a browser renderer accidentally supplied to a desktop installer.
- Pro operation creation is guarded through sharing, settings paste, cloning,
  recipes, duplication and arrays. Existing desktop Pro work remains editable and
  runnable. No licence check was added to Frame, Start or output.
- Browser admission preserves Pro projects for desktop. Rejected Pro autosaves
  retain their own storage session through subsequent Free editing, unload and
  manual saves. Portable copies keep the full artwork and operations.
- The actual workerd checkout failure is fixed. Authenticated reconciliation can
  attach a positively verified existing Paddle transaction to its original intent;
  it cannot create a second payable order or grant an entitlement.
- An isolated Windows sandbox package is prepared with separate identity/profile,
  pinned sandbox trust, no file associations, no updates and no publication.
- Dependency patch floors were repaired; the fresh runtime and full scans both
  returned zero advisories. Commercial preflight now runs the advisory report.

Decisions are recorded in [ADR-540 Amendment 1](../decisions/ADR-540-amendment-1-browser-free-build-and-project-preservation.md)
and [ADR-523 Amendment 4](../decisions/ADR-523-amendment-4-checkout-reconciliation-and-sandbox-package.md).
Production service activation, signed installer and update qualification, provider
verification, public downloads and final legal publication remain separate work.

### Implementation verification

Verification evidence is in
`D:/LaserForge/electron-licensing-audit-evidence-20260930/`. These are local draft
results; the source has not been committed or published.

| Check | Result |
| --- | --- |
| App, Electron and browser-test TypeScript | Passed. |
| App and Electron lint | Passed; the final Electron main file also passes its 400-line limit. |
| Formatting and diff whitespace | Passed. |
| Release-integrity tests | 365 passed, including the licensing service and new package checks. |
| Website tests | 35 passed. |
| Browser Free compilation tests | Five passed, including all nine ordinary CNC choices and all five Free tracing presets; Pro compiler entries reject use. |
| Production browser smoke | Passed in Chrome against the actual Free production bundle; Pro notice, ordinary text work and worker/assets checks passed. |
| Dependency licence policy | Passed for all 56 production packages. |
| Dependency advisories | Zero runtime and zero full-graph advisory records after the targeted patch-floor updates. |
| Repository policy checks | ADR numbering, action pins, hard file-size limits and index-export ratchet passed. Soft-size output remains informational. |
| Full application regression suite | `pnpm test --maxWorkers=2` exited 0: 3,403 files passed and 18 skipped; 25,800 tests passed and 29 skipped. Duration 3,271.19 seconds. |

The full run includes expected negative-path React/jsdom console errors, retained
in `implementation-tests-full.log`; the runner reported no failed tests or
unhandled-error summary. Skipped tests are not counted as verified. The changed
source files are identified by `implementation-source-manifest.json` in the
evidence directory.

Browser admission and autosave checks additionally cover unchanged original Pro
projects, paged assets, failed/cancelled preservation, active-job notices and
same-session recovery-slot retention. The saved-camera Job Watch path now uses
the same browser capability boundary, preserving raw viewing without restoring
Pro alignment.

### Unsigned-first follow-up

The owner approved unsigned testing first on 30 September 2026. Version 0.0.1's
packaged launch/import/save smoke passed, but inspection found missing external
licence and third-party notice copies. The sandbox and ordinary Windows builder
configurations now include those copies; the sandbox packaging hook rejects
missing or altered notices. Their licence terms were not edited.

The replacement installer is
`D:/LaserForge/electron-unsigned-first-20260930/artifacts/KerfDesk-Sandbox-0.0.2-windows-x64-setup.exe`.
Its exact hashes, source snapshot and package checks are recorded in
`package-verification.json`, `windows-identity-verification.json` and
`source-manifest.json` under `D:/LaserForge/electron-unsigned-first-20260930/`.
This is an unsigned local draft with isolated identity/profile, fixed sandbox
trust, no file associations, no automatic updates and no publication channel.

The actual packaged executable passed its native smoke in a disposable profile:
startup, renderer isolation, disabled DevTools, SVG import and project save with
stubbed file pickers and an in-memory destination. Read-only local licence routes
reported `commercial`, `activation-required`, `edition: free`, `proEnabled: false`
and updates `unavailable`. The evidence is in `native-smoke/run-k4ILaX/`.
No trial, activation, purchase, remote update or device operation was initiated.

Follow-up verification passed 12 package/preparation tests, 15 native renderer
tests and 40 smoke runner/validation tests, plus Electron TypeScript, lint,
formatting and diff checks. The full regression suite above preceded this narrow
follow-up; it was not repeated without a reason.

The installer has not been installed. Actual native dialogs, live packaged
trial/payment activation, three-installation seat behaviour, signed installation
and two-version updates remain unqualified. The subsequent browser welcome work
rebuilds `dist/web` as browser Free; the saved sandbox installer is unchanged.

### Browser welcome follow-up

The owner requested a polished browser popup with a direct desktop download or
Free continuation. The local browser now offers that choice on its first visit,
using the existing KerfDesk wood artwork and copper theme. It remembers dismissal
when local storage is available; the Free/Pro status button reopens it. Continue,
close and Escape all preserve access to Free. The dialog defers to other modals,
preserved Pro projects and machine activity; it never starts a trial or download
automatically.

The download resolver verifies the existing commercial catalogue against the
website's own trust keys, constructs the fixed versioned Windows installer URL,
and bounds network/body work to eight seconds. The browser CSP permits only the
additional download origin needed for the metadata check. An unavailable or
invalid catalogue leaves Free usable and offers an honest unavailable state.
At this follow-up, both public stable and beta catalogues returned HTTP 404. No
public installer has been published by this work, so the current welcome shows
**Download coming soon**. The local unsigned sandbox is not offered to customers.

Evidence is in `D:/LaserForge/browser-welcome-evidence-20260930/`. The direct
download check uses publisher-signed test metadata and an intercepted inert
fixture, not a production installer. Screenshots labelled `ready` show that
fixture state; `welcome-unreleased-desktop.png` shows the unreleased state.
Public hosting, catalogue publication and browser deployment remain separate
actions.

Follow-up verification passed 19 focused UI/edition/CSP tests, seven download
resolver tests, app and browser-test TypeScript, scoped lint, formatting and diff
checks. The actual browser Free production bundle built successfully and passed
the Chrome production smoke, including Free continuation, blocked Pro entry and
ordinary text/worker use. A separate Chrome check against that production bundle
passed remembered dismissal, reopening, keyboard dismissal/focus containment,
mobile layout without horizontal overflow, and exactly one user-initiated test
download. Light, dark and mobile screenshots were visually inspected. The full
application suite above predates this follow-up and was not repeated.

## Audited baseline and evidence

| Area | Verified result | Implication |
| --- | --- | --- |
| Remote main | `b232944069681a00c319404ced30c4e4d816c11d`, refreshed again before reporting | Frozen audit matches current main at this checkpoint. |
| Public browser app | Served assets identify version `0.1.2969`, commit `b2329440`, built `2026-09-29T23:50:46.000Z` | The audited edition policy is represented by the current hosted app. This is served-bundle evidence, not a new browser interaction test. |
| Licensing integration | [#1021](https://github.com/cisgz3a-hub/KerfDesk/pull/1021) and [#1030](https://github.com/cisgz3a-hub/KerfDesk/pull/1030) merged | Older handoffs saying #1017/#1018 are unmerged are superseded. Those PRs were closed as included in #1021. |
| Browser edition | `UNLICENSED_BUILDS_RUN_FREE = false` | Browser, source and Preview builds still deliberately expose all tools before sales open. |
| Production payment config | `https://license.kerfdesk.com/v1/public/config`: HTTP 200, `enabled:false`, provider/environment null | Live payments are not enabled. This route does not independently report every licensing-service flag. |
| Production health | `/v1/public/health`: HTTP 503, `service_unavailable` | Current main's always-available health route is not established on the deployed service; consistent with the older deployment described in the PRs. |
| Separate sandbox | Public config reports enabled Paddle sandbox | A staging service exists. The launch guide's “No staging service” section is stale. |
| Historical sandbox lifecycle | 29 September evidence verifies purchase, signed activation, renewal and duplicate webhook replay | Successful Node/backend qualification; not a packaged Electron purchase test. Original interrupted intent remains unresolved. |
| Download catalogues | Commercial stable, commercial beta and Preview latest metadata all returned HTTP 404 at the configured download URLs | No working customer download catalogue was established. This alone does not establish whether R2 billing or a bucket exists. |
| Public legal/pricing pages | `/pricing/`, `/terms/`, `/privacy/`, `/refunds/` all returned HTTP 404 | Paddle domain review and customer publication remain incomplete. |
| Draft legal work | [#1033](https://github.com/cisgz3a-hub/KerfDesk/pull/1033), open draft, head `fc871eca202080ed8742a815af266118da53d4d0` | Another active chat is fixing this work. Its local changes are not merged or published evidence. |
| Repository visibility | GitHub reports public | Current proprietary notices do not hide source, withdraw older copies or provide technical protection. No visibility change was made. |

Public probe receipts and test logs are under `D:/LaserForge/electron-licensing-audit-evidence-20260930/`. The audit snapshot became the isolated implementation worktree at `D:/LaserForge/electron-licensing-audit-20260930/`.

## Baseline findings and current follow-through

### Baseline P1, fixed locally: checkout failed in the repository's Cloudflare runtime

[paddle.mjs:220](../../services/desktop-licensing/paddle.mjs) uses `redirect: 'error'`. The installed workerd rejects that value before performing an outbound request. The catch at lines 240–241 maps it to an ambiguous checkout result, and [checkout.mjs:58](../../services/desktop-licensing/checkout.mjs) preserves the pending intent on subsequent requests.

An independent probe ran the actual frozen Worker with local SQLite, synthetic keys and all networking intercepted. The first and repeated checkout requests both returned HTTP 409 `checkout_pending`, with **zero outbound provider calls**. All 57 existing service tests passed, demonstrating that their outbound-provider stubs do not cover this runtime failure.

The separate hosted sandbox already uses the necessary `redirect: 'manual'` compatibility repair. Port that repair into current source, reject redirect responses without following them, add a real-workerd outbound regression, then repeat the sandbox lifecycle against the exact candidate source. Browser/Node client fetch implementations are separate runtimes; do not indiscriminately replace every `redirect:'error'` in the repository.

Add an operator recovery procedure for unbound pending intents. Prove whether a transaction exists before releasing/retrying an intent. A fresh successful purchase is not proof that a previous ambiguous order recovered. Evidence: `licensing-service-evidence.txt` and the earlier `D:/LaserForge/paddle-sandbox-20260929/RESULTS.md`.

### Baseline P1, fixed locally: browser policy did not implement “no Pro features”

[edition-policy.ts:6](../../src/ui/licensing/edition-policy.ts) leaves the switch false. [EditionProvider.tsx:38](../../src/ui/licensing/EditionProvider.tsx) renders an unrestricted app when no licence client exists. Turning that switch on adds UI checks, but the same renderer/core implementation still ships to browsers and desktop. [vite.config.ts](../../vite.config.ts) has no separate Free capability build, and Electron packages `dist/web`.

For the requested strict split, distinguish platform capabilities from licence entitlements:

- Browser: Free capabilities only, no activation and no browser seat.
- Desktop commercial: Free initially; trial, paid or developer entitlement unlocks the approved Pro tools.
- Preview/source builds: explicitly define their distribution policy so an unrestricted alternative is not unintentionally advertised as the paid product's substitute.

Use a separate browser build graph for Pro-only authoring tools, workers and compilers. Verify produced chunks and the PWA precache, not only labels or hidden buttons. Retain common geometry primitives that Free tools need. For example, the Free “Line + fill” tracing preset uses centreline processing internally; removing every centreline algorithm would break a Free feature.

This will not withdraw previously downloaded browser assets, older binaries or source copies. New PWA versions should activate at a safe idle/restart point, never by forcing a reload during a machine job.

### Baseline P1, fixed locally: normal Free UI paths applied Pro settings to new artwork

Four rendered-component probes exercised real components and the real state store, with both React and global edition explicitly set to Free:

| Action | Result |
| --- | --- |
| Share an existing V-carve operation onto new artwork | Applied; zero Pro requests |
| Share an existing adaptive operation onto new artwork | Applied; zero Pro requests |
| Paste V-carve settings into a Free operation | Applied; zero Pro requests |
| Paste adaptive settings into a Free operation | Applied; zero Pro requests |

Paths:

- [SelectedOperationInspector.tsx:53](../../src/ui/layers/SelectedOperationInspector.tsx) → [operation-actions.ts:56](../../src/ui/state/operation-actions.ts), including operation rebinding/clone/add.
- [LayerSettingsClipboardButtons.tsx:5](../../src/ui/layers/LayerSettingsClipboardButtons.tsx) → [layer-actions.ts:138](../../src/ui/state/layer-actions.ts).

These do not require developer tools or hand-editing a file. Centralise checks when creating or applying Pro operations, then cover paste, sharing, cloning, recipes, templates, libraries, imports and restored projects. Baseline evidence: `implementation-probes/edition-paths.test.tsx` in the external evidence directory, four passed.

### Baseline policy gap, resolved locally: existing Pro projects in browser Free

ADR-540 decision 3 deliberately allows existing Pro operations to remain editable, compilable and runnable in Free. Saved relief editing and saved camera calibration also remain available. That is a policy mismatch with a literal browser offering no Pro functionality, not proof that those current exemptions were accidental.

The owner was asked to choose between:

1. **Recommended for the new strict split:** preserve the original project, offer a non-executable browser preview where feasible, and require desktop continuation for Pro work. Do not silently discard operations or generate an incomplete job.
2. Retain the current exemption: existing Pro work stays usable; only creating new Pro work is restricted. This is a weaker interpretation of “browser Free”.

The strict browser policy is now implemented under ADR-540 Amendment 1: preserve the complete incoming Pro project separately and require desktop continuation. Ordinary generated vectors remain Free artwork. Existing desktop Pro projects retain their editing/output exemption. Machine controls remain available, and Frame remains the sole ordinary Start policy gate. No payment check was added at Start, no licence change interrupts jobs, and project admission names the desktop requirement explicitly.

### P1 launch prerequisite: commercial Windows signing and release inputs are missing

The `desktop-commercial` GitHub environment exists and allows `main`. Its only listed secrets are `COMMERCIAL_CLOUDFLARE_ACCOUNT_ID` and `COMMERCIAL_R2_API_TOKEN`; repository secrets are the Pages credentials. No environment/repository release variables were returned.

Missing in the current release workflow:

| Input | Needed action |
| --- | --- |
| `COMMERCIAL_ESIGNER_USERNAME` | Configure the approved SSL.com eSigner account. |
| `COMMERCIAL_ESIGNER_PASSWORD` | Store privately in the release environment. |
| `COMMERCIAL_ESIGNER_TOTP_SECRET` | Complete the secure signing enrolment/handoff. |
| `DESKTOP_STABLE_MANIFEST_PRIVATE_KEY` | Securely configure the existing matching release key. |
| `DESKTOP_STABLE_MANIFEST_KEY_ID` | Set the matching pinned ID, currently `stable-2026-09`. |
| `DESKTOP_WINDOWS_PUBLISHER_NAME` | Use the certificate's exact verified publisher identity. |
| `KERFDESK_COMMERCIAL_TERMS_SHA256` | Finalise installer terms, publish their exact bytes at the prescribed terms URL, and configure their hash. |

The current workflow is built for SSL.com eSigner. A different approved signing service is possible but requires a workflow change. Windows Authenticode and Ed25519 release/entitlement signatures serve different purposes; one cannot substitute for the other.

Nonempty existing release/entitlement private-key files and HMAC/admin-secret files were observed by metadata only in the protected operator directory. Their contents were not opened and matching/validity was not reverified. Do not regenerate these merely because GitHub configuration is incomplete. Existing licences and trust anchors depend on them.

The R2 token exists in GitHub, but its validity and successful rotation were not established. The last token-rotation chat stopped at prepared forms. Retain the old token until the replacement independently verifies as requested. Public download 404s do not prove an R2 account or billing failure.

### P1 launch qualification: no verified signed commercial customer journey

Frozen main passed [CI](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/36647327310), [browser smoke](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/36647327322) and [Pages deployment](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/36648334520). Its [desktop package check](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/36647327272) ran Linux only; Windows and macOS were skipped.

The last manual [Windows/macOS package run](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/36531269097) passed at `4d6034cf7cf2618344e62a2ca0f252bcc7f61718`, before #1021/#1030. It used unsigned Preview packages. The native smoke substitutes file pickers, so it does not establish genuine Open/Save dialog behaviour. No commercial release-train run or two-signed-version update qualification was established. The latest GitHub Preview remains the July `v0.2.0-preview.13` release.

Qualify the actual candidate on disposable Windows installations, not the owner's live machine:

- Fresh install, actual Open/Save, Explorer file associations, close with unsaved work, restart, uninstall and retained projects/settings.
- Existing all-users installation upgrading in place, including appropriate elevation.
- Free startup; trial; offline restart; paid/developer activation; three seats; device transfer; expired trial; expired update coverage; clock errors; unreadable credential recovery.
- Packaged app purchase and recovery against an explicitly isolated sandbox build with sandbox endpoint, keys and database.
- Two signed releases: eligible natural-quit update, uncovered update skipped, beta opt-in, stable promotion, interrupted/offline recovery, publisher and tamper rejection.
- Commercial package fuses, ASAR integrity and debugging/development-renderer refusal. Electron's [ASAR documentation](https://www.electronjs.org/docs/latest/tutorial/asar-integrity) explains why both integrity validation and loading only from ASAR matter.

Windows installation identity determines trial usage, so a fresh app profile alone does not isolate a trial. Production preparation retains its pinned licence origin. A separate sandbox configuration and unsigned installer are now prepared with their own endpoint, trust pins and profile; packaged purchase/trial qualification remains outstanding. No hardware operation is necessary for this software qualification; use simulators for job lifecycle tests. Windows remains the agreed initial commercial platform.

### Baseline P2, fixed locally: commercial release automation lacked the dependency advisory gate

[release-train.yml](../../.github/workflows/release-train.yml) selects CI/browser/package success and publishes without consulting dependency advisory evidence. The legacy stable lane includes a runtime advisory check, and PROJECT requires runtime-reachable vulnerabilities to block release.

Fresh scans on this audit's lockfile returned:

- Production graph: **zero reported advisories**.
- Full graph: **8 high and 4 moderate advisory records**, representing **six distinct advisory URLs** across affected versions of `fast-uri` and `brace-expansion`.
- The repository's own classifier places all 12 records in **release-build-only**, with zero runtime-reachable findings, including its special handling of Electron as runtime despite being a devDependency.

These are supply-chain maintenance findings, not demonstrated shipped-runtime exploits. They supersede the older issue's smaller count. Triage/repair them before release and add the intended advisory check to the commercial lane. Evidence: `runtime-dependency-audit.json`, `all-dependency-audit.json`, `dependency-classification.json` and `dependency-classification.md` in the evidence directory.

### P2: operational and documentation follow-through

- The backend supports listing/releasing remote devices, but the customer app has no corresponding lost-computer management UI. Support must perform that operation until it is implemented.
- Saved request logging is disabled in `wrangler.jsonc`. Define limited retention and privacy wording, then monitor health, rejected payments and pending checkout outcomes.
- Export exists, but a complete tested restore path was not established. Rehearse recovery with the same signing/hash/derivation material, plus key rotation and licence recovery.
- Refund and chargeback revocation is manual. An offline perpetual activation retains signed rights until it reconnects; a currently admitted session retains Pro until close. Do not advertise instant offline revocation.
- Local handoff/launch documents now reflect the merged licensing foundation, separate sandbox, workspace-first Free startup and implemented browser policy change.
- Integrate the active #1033 legal/docs work rather than copying or overwriting it. Its publication fields remain owner inputs. The owner's recorded decision to skip lawyer review is not reopened by this audit.
- The commercial catalogue has a 64-entry limit. Design archival/index support before reaching it; do not evict the last eligible version for a perpetual customer. This is not a first-release blocker.

## Existing feature and business decisions to retain

| Free | Pro in the Windows desktop app |
| --- | --- |
| Drawing, text and general import | V-carve |
| Laser cutting and engraving | 3D relief, height-map and STL relief import |
| 2D CNC cuts and machine control | Adaptive clearing |
| Basic trace: Line Art, Smooth, Sharp, Line + fill, Edge Detection | Photo shading, Centerline, Colour layers and multi-file tracing |
| Camera viewing | New camera alignment/calibration and checking |
| Ordinary preview, estimates and machine workflow | Box generator, Design Studio and G-code Inspector |

The saved-Pro exemption remains in desktop Free. Browser Free now preserves unsupported Pro projects for desktop continuation, as described above. There is no daily basic-trace quota in this edition implementation. Do not revive the older quota/Supabase design merely because it appears in an earlier chat.

Already agreed: US$49.50 once, three active computers, perpetual use of eligible versions, one year of updates, optional US$20 for another year, no automatic subscription, 30-day full Pro trial. Johann and Father each receive an individual complimentary developer licence with three computers and unlimited updates. South Africa is the seller country; Paddle is the chosen provider. Browser activation and browser seats are not part of the model.

The current desktop service uses Cloudflare and Paddle directly. Supabase and Resend are not required to finish this implementation.

## Exactly what is needed from the owner

1. **Browser policy is resolved for this implementation:** strict Free preserves Pro projects for desktop. The already approved feature list and pricing do not need repeating.
2. **Individual seller details, updated after the owner's clarification:** the owner does not have a registered business/company. The legal draft identifies Johannes Stephanus Stolk as the individual maker and licensor, trading as KerfDesk. The other audit chat now records the supplied address and telephone, and the owner's instruction to retain “Ons Houtkombuis” simply as a name. Do not ask for those details again or invent a company registration. The remaining identity-field question is whether the owner is VAT registered; if not, the draft can say “Not registered for VAT”. The owner has set 10 October 2026 as the target app release, which is separate from the actual legal-page publication date. Paddle permits individual/sole-trader accounts without its company business-verification stage; website/domain review and personal identity verification still apply ([Paddle account verification](https://www.paddle.com/help/start/account-verification/what-is-account-verification)).
3. **Windows signing is deferred:** on 30 September the owner chose unsigned testing first because of the certificate cost. No certificate, signing subscription or identity handoff is needed for this sandbox stage. The existing signed release workflow still needs an approved publisher and protected signing setup if that distribution route is chosen later. No private value should be pasted into chat.
4. **Provider completion:** Paddle live seller/KYC/payout approval, approved checkout domain, live purchase/renewal catalogue and private API/webhook secrets. Sandbox success does not establish those. Finish and verify the R2 token handoff; no new token should be created simply because its existing value is unreadable to this audit.
5. **Operational ownership:** who holds and backs up the existing keys/database, the support response commitment, and a disposable Windows test installation (plus three independent installations/VM identities for real seat qualification) when the signed candidate is ready.

The local checkout repair, Pro creation-path coverage, explicit build capabilities, isolated sandbox packaging, release checks and documentation reconciliation are complete. They needed no further business decision or credential. Production activation, publishing and taking payments remain separate launch actions, with the owner/provider inputs and qualification listed above.

## Exact provider configuration checklist

Verify privately rather than asking for raw secret values:

| Location | Required inputs |
| --- | --- |
| Production Worker secrets | `SIGNING_PRIVATE_JWK`, `HASH_SECRET`, `DERIVATION_SECRET`, `ADMIN_TOKEN`, live `PADDLE_API_KEY`, live `PADDLE_WEBHOOK_SECRET`; `ADMIN_TOKEN_NEXT` only for rotation |
| Worker non-secret configuration | Matching `SIGNING_KEY_ID`; deliberately controlled `LICENSING_ENABLED`/`PAYMENTS_ENABLED`; `PAYMENT_PROVIDER=paddle`; `PADDLE_ENVIRONMENT=live`; `PADDLE_PURCHASE_PRICE_ID`, `PADDLE_RENEWAL_PRICE_ID`, `PADDLE_CLIENT_TOKEN`, `PADDLE_CHECKOUT_URL=https://kerfdesk.com/buy.html` |
| Cloudflare continuity | Correct account/domain; retain `LicenseAuthority`, `licensing-authority-v1` and existing SQLite migration identity; check rate-limit namespaces `1001`, `1002`, `1003` before deployment |
| Distribution | Working `kerfdesk-downloads` bucket and `dl.kerfdesk.com`, CORS/cache contract, verified R2 token, exact signed catalogues/artifacts/terms |
| Release environment | Signing/key/terms entries listed above; create `release-hold`; leave `KERFDESK_RELEASE_TRAIN` off until the pilot passes |

Do not rotate the hashing/derivation secrets casually or rely on dashboard-only plain variables surviving deployment. Do not enable the legacy stable lane alongside the commercial lane.

## Integration sequence and acceptance

1. **Complete locally:** isolated integration branch and browser decision. Incorporate the separately owned legal/docs work when ready, preserving unrelated changes.
2. **Complete locally:** checkout and pending-intent repair, including actual-workerd regressions. Repeat the hosted sandbox lifecycle against the exact candidate service before release.
3. **Complete locally:** browser Free build, shared Pro creation checks, preserved import/recovery, compiler/trace regressions and production-browser smoke. A real hosted PWA version transition remains part of deployment qualification.
4. **Complete locally:** isolated unsigned sandbox installer, package verification, packaged startup/import/save and fresh-profile licence/update checks. Packaged-app purchase/trial and actual native installation remain unqualified; live payment switches remain off.
5. **Deferred while unsigned testing proceeds:** select the customer distribution route. If retaining the existing signed release lane, configure its signing/distribution/live provider inputs securely and run the signed Windows pilot and two-version update checks. The unsigned sandbox has no automatic update channel.
6. Publish verified downloads and final public pages, activate the approved licence service, privately issue developer licences, then enable sales only as a distinct authorised launch. Verify actual hosted, installed and signed identities.

## Tests and reviewed conversations

Baseline audit checks, superseded where the implementation verification above records a repair:

| Check | Result |
| --- | --- |
| Electron tests excluding licence groups | 71 files; 456 passed, 2 skipped |
| Licence client groups | 7 files; 76 passed |
| Edition UI and Electron licence adapter | 7 files; 47 passed |
| Service tests | 57 passed |
| Independent Free UI probes | 4 passed, demonstrating the four access gaps |
| Actual frozen Worker checkout probe | Two reproducible 409 responses, zero outbound calls |
| Dependency scans | Runtime zero; full scan 12 release-build advisory records, six distinct URLs |

The licence adapter test overlaps the two licence/edition groups; counts are not presented as a unique combined total. Electron tests emitted two asynchronous temporary-directory cleanup errors from serial-grant persistence despite passing; these logs are retained and do not establish a user-data persistence defect. Two skipped tests and native packaging limits remain explicit. No full `release:check` rerun or new signed build was claimed.

Read the relevant turns from **Audit Electron app readiness**, **Research premium feature tiers**, **Enable Email Routing and R2**, **Replace Cloudflare R2 token**, and **Audit PRs from the last 2 days**. Also inspected the September 29 Electron handoff, sandbox receipts, licensing formation audit, current PR descriptions and current source. Older chat claims were used as leads and reconciled with live source/provider/release evidence. No messages were sent to those chats.
