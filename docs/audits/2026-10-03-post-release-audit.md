# KerfDesk post-release audit - 3 October 2026

This is a fresh audit of the released 1.0.8 source,
`c998b4d82971fdacfbb1e2d36cc93c2d30080245`, with new scenarios for numeric
editing, machine and job persistence, Frame/Start/mark ownership, licence
retention and expiry, phone/MCP approval, public downloads and updates.
The isolated branch is `codex/post-release-audit-20261003`. The dirty primary
checkout, customer profiles, existing worktrees and running apps were preserved.

Three product defects and one simulator limitation were reproduced and repaired,
with 114 distinct new committed scenarios: 46 native licence-source cases, 25
renderer/adapter licence cases, 18 job/simulator cases, 17 phone-service cases
and eight browser workflows. Existing cohorts and reruns are not added to that count.
Passing software checks do not qualify physical machines, optical power, actual
customer activation or every hosted MCP client. No hardware, real customer
credential, payment, production pairing or OAuth grant was used.

## Reproduced findings

| Priority | Released behaviour | Repair and regression evidence |
| --- | --- | --- |
| P2 | An OAuth page showing approved computer A could issue a token for separately approved computer B after changing the paired session. Re-pairing could reuse an old approval form. Modified form scopes could add edit/refresh permissions absent from the displayed consent. | A server-owned ten-minute record binds the official provider handle to the shown PC, client, lease, hashed session and scope ceiling. Root independently rebuilt the exact released Worker and reproduced all three failures, including code redemption and routing to B. The fixed service passes 59 cases, including 17 new boundary/failure/revocation scenarios. Both computers already had explicit phone approval; no unapproved-PC, licence or machine-control bypass was demonstrated. |
| P2 | A concurrent Start attempt during an owned positioning mark checked its temporary head position against the completed Frame and discarded that Frame, even though the mark returned correctly. Ctrl+Enter made this reachable while no job streamer was active. | Both ordinary Start and immutable-permit Start refuse the occupied controller before Frame readiness/arming. Tests exercise ordinary calls, the installed shortcut and the direct permit path, assert no extra machine bytes, retain the mark owner/Frame and then run the actual subsequent job. No mark program or ordinary Frame policy changes. |
| P2 | A previously recorded expired trial became Pro again after a fresh process and a small wall-clock correction inside the five-minute tolerance. Short-session progress, the final second and time observed during a failed request or order/reset action could be lost. | Verified trial time uses the persisted high-water mark; each session anchors elapsed time at that mark and every returned verified trial status saves observed forward whole seconds at the shared serial boundary. Nineteen source regressions fail on released code and pass after repair. A remaining-time bound aligns renderer Pro choices with native time and subtracts transport delay. Recorded expiry also makes later signed Free updates eligible. Paid/developer offline rights and authenticated fresh-grant recovery pass the existing cohort. ADR-523 Amendment 6 records the change. |
| Fixture | The simulator ACKed valid compound-modal movement such as `G21 G90 G54 G94 G1 ...` without moving the simulated head. A real positioning mark then correctly refused the unchanged position, preventing honest end-to-end qualification. | The fixture recognises an explicit motion word after modal prefixes, with the correct G53 machine-coordinate exception. Independent absolute/relative/WCO/G92/G53 cases fail before repair and seven cases pass afterwards. The broader simulator cohort passes 79 cases. This repairs the test model, not generated job bytes or physical firmware. |

The trial finding was also observed in two fresh hidden Windows Electron
processes using exact shipped 1.0.8 modules and real safeStorage. The encrypted
record and its original signed credential/deadline remained byte-identical;
synthetic issuer/device seams isolated the exercise from customer activation.
These are witnesses of the released defect, not evidence that 1.0.8 is fixed.

## Fresh scenario checklist

| Area | Scenarios and evidence | Result / limit |
| --- | --- | --- |
| Numeric editing | Seven installed-Chrome renderer scenarios: blank/abandon power and speed; native trailing decimal with a pause; Undo/Redo retiring drafts; replacing a project with reused IDs; fill spacing `0.125`; clamping then entering an off-grid value; width expressions and inch conversion. | Seven pass. Native number-input intermediate text and native field Undo were distinguished from committed values and document Undo. Incorrect first test assumptions were corrected without product edits, and their failed receipts were retained. |
| New canvas and machine retention | Save bed size/S maximum, alter old job power/speed/passes/Output, use New, import fresh artwork, then New and reload the renderer. | One actual Chrome workflow passes: committed machine settings survive; new artwork has fresh operation defaults and Output enabled. Renderer reload is not Windows shutdown or an installed customer profile upgrade. |
| Licence persistence | 46 new source cases for saved paid/trial rights, legacy schema, offline refresh, version coverage, expiry/corrected time/restart, device/signature/store failures and recorded-expiry Free updates. | A final combined native/renderer cohort passes 166 cases across 13 files, including all 46 new source cases. Portable tests use an explicitly fake OS cipher and real ephemeral Ed25519 signatures. |
| Renderer trial admission | 25 new cases cover native time budget validation, delayed protocol delivery, repeated cached statuses and actual EditionProvider Pro-tool entry with the workspace still mounted. | All 44 cases in the separately reviewed renderer cohort pass; they overlap the final 166-case cohort. Older statuses remain compatible. A delayed response can conservatively shorten remaining time, but cannot extend it. |
| Published licence modules | 27 separate hidden Electron processes exercise the original published 1.0.7 and 1.0.8 modules with real Windows safeStorage, including restart, due offline refresh, paid clock independence, trial expiry, unsupported schema and corrupted data. | All expected scenarios pass. Original release signatures and module equality are checked. Issuer/device/network are synthetic; these are not paid/trial installed-upgrade or live activation claims. The two supplemental expired-trial witnesses are separately recorded as findings. |
| Job lifecycle and ownership | Eighteen new cases cover actual simulator flows through completed old job, Done, New, real Frame, power/speed changes, one-second mark and new Start; cancellation/replacement/late-result ownership and simultaneous Start admission. | All 117 focused cases pass. The 79-case simulator cohort overlaps and is not added as a unique count. Software/simulator evidence only. Native Y/front-left conversion is asserted; no physical positioning or burn qualification. |
| Phone/MCP | Real pinned workerd, isolated SQLite Durable Objects/KV, official protocol clients, valid consent/narrowing/decline, expiry/revocation/replacement and KV faults. | 59/59 pass. Concurrent Allow is checked in one local backend; production cross-region consistency is not qualified. A cleanup failure after provider consumption grants no code and requires a fresh page; recovery passes. |
| Public download/update | Fresh no-cache latest and immutable 1.0.8 manifests and six improvements verified with the original public keys; installer HEAD and saved public-download hash; browser/phone asset hashes and unauthenticated MCP challenge. | Twelve observations recorded. Installer is 116,866,188 bytes, SHA256 `79b90f6464f0444fe936fffb991b2ae3c8476b5069ef8450999c7c59e5ea48ff`. The previously independent full public download was rehashed against the fresh manifest; this audit did not repeat the 117 MB download or installer execution. |
| Dependencies | Fresh `pnpm audit --json` registry advisory scan. | Zero reported advisories in all severities. This does not establish absence of application defects or future vulnerabilities. |

The new committed scenario files are:

- `e2e/post-release-numeric-scenarios.spec.ts`
- `e2e/post-release-machine-retention.spec.ts`
- `electron/licensing-upgrade-retention.audit.test.ts`
- `src/platform/electron/licensing.native-budget.test.ts`
- `src/ui/licensing/trial-expiry.native-budget.test.ts`
- `src/ui/licensing/EditionProvider.native-budget.test.tsx`
- `src/ui/laser/post-release-job-lifecycle.audit.test.ts`
- `src/ui/state/post-release-mark-ownership.audit.test.ts`
- `src/__fixtures__/controllers/grbl-sim-compound-motion.audit.test.ts`
- `services/remote-control/test/post-release-boundaries.test.mjs`

## Integrated verification

At this report cut, all 114 new scenarios pass in their recorded cohorts. The
combined licence cohort passes 166 cases, the job/ownership cohort 117 and the
remote service 59; these existing/overlapping cohorts are not a unique scenario
sum. Independent review found no further attributable blocker in the repaired
consent path or final serial trial-persistence/renderer contract.

The complete local `pnpm release:check` passed at `2026-10-02T22:45:21Z`:
26,941 unit tests passed across 3,476 files; 29 cases in 18 files were marked
skipped. All 500 release-integrity checks, 39 website checks and 59 phone-service
checks passed. TypeScript, root/Electron lint, privacy, formatting, ADR numbering,
Actions pinning, dependency licence/notice checks, production web/Electron builds
and file-size/export policies passed. The eight new Chrome workflows were run
separately; they are not part of the unit-test count.

Source and test hashes match the frozen reviewed candidate; only this report was
completed after the gate. PR #1065 contains the repairs. At this report cut its
hosted checks are still running, and the green CodeRabbit status represents a
skipped automatic review, not a completed review. Exact final-head CI and any
reviews must be inspected before merge. Fresh main CI, Pages publication and
served-build identity must then be verified separately before claiming a browser
deployment. Local receipt files retain those later outcomes without changing this
pre-merge report or minting another installer release.

## Evidence retained locally

The evidence root is `D:/LaserForge/post-release-audit-evidence-20261003`.
It is separate from the shipped app and contains no customer activation keys.

| Receipt | Purpose |
| --- | --- |
| `root/public-state.json` | Fresh public source, signature, static-asset and installer hash observations |
| `root/dependency-audit.json` | Current dependency advisory result |
| `root/release-check.log`, `root/release-check-receipt.json` | Complete local release gate and terminal zero exit status |
| `root/browser-final-run.json`, `root/machine-final-run.json` | Seven numeric passes and the corrected final machine workflow; retained browser traces/screenshots |
| `root/independent-consent-baseline.json` and `.tap` | Root's independently rebuilt released Worker hash and three reproduced consent failures |
| `root/trial-regression-baseline.log`, `root/trial-update-baseline.log` | Seven new source regressions against released licensing code |
| `root/trial-request-path-baseline.log`, `root/trial-service-error-baseline.log` | Eight further request/expiry regressions against independently checked-out released source |
| `root/trial-other-actions-released-baseline.log` | Four order/reset expiry regressions against independently checked-out released source |
| `root/licensing-focused-fixed.log` | 104-case repaired licensing/update cohort |
| `root/licensing-final-focused.log`, `root/trial-service-error-fixed.log` | 110-case final native cohort and two further non-definitive service failures |
| `root/licensing-final-integrated-focused.log` | Final 166-case native/renderer cohort after all order/reset paths share the persistence boundary |
| `root/licence-renderer-budget-freeze-receipt.json` | Independent renderer review, 25 new cases, before/after witnesses and frozen file hashes |
| `remote/audit-receipt.json` | Frozen Worker/test hashes, 42 existing plus 17 new cases, fault behaviour and limitations |
| `licensing/native-upgrade-run-receipt.json` | 27 hidden Windows Electron process outcomes |
| `licensing/published-asar-comparison.json` | Original release identity and published licensing-module comparison |
| `licensing/native-trial-tolerance-run-receipt.json` | Two fresh-process witnesses of the released expired-trial defect |
| `jobs/` | Before/after lifecycle and simulator receipts, final owner manifest |

## Research and remaining qualification

The audit checked current [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security),
[safeStorage documentation](https://www.electronjs.org/docs/latest/api/safe-storage)
and [autoUpdater documentation](https://www.electronjs.org/docs/latest/api/auto-updater),
the pinned OAuth provider's implementation and [consent documentation](https://github.com/cloudflare/workers-oauth-provider/blob/main/docs/consent-page.md),
and [Cloudflare KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/).
The app uses its own authenticated manual NSIS update flow; Squirrel/MSIX advice
does not qualify that different installer path.

Windows encryption protects credentials from other Windows users; it does not
make them inaccessible to software under the same user. Local trial protection
does not guarantee resistance to modified binaries, restored local state or a
changed Windows installation identity. The device-bound server deadline and
signed grants remain authoritative. No licence check gates Frame/Start/output.

KV is eventually consistent and is not a globally atomic single-use store.
The new immutable presentation binding is additional validation; official
provider checks and current Durable Object approval remain required. Production
propagation, live customer pairing and hosted ChatGPT connector setup still need
their own qualification. Existing consent pages opened before deployment need a
fresh page; existing issued tokens and paired clients keep their normal checks.

Real paid/trial customer activation, a paid/trial installer upgrade, forced OS
shutdown, customer notification/UAC/SmartScreen, live private download-country
and retention data, and physical controller/material/power behaviour remain
unverified. Draft #1033's first-use terms gate remains unpublished and outside
this repair. No new safety certification or commerce-launch claim is made.

At the audit cut, public desktop latest is 1.0.8 and the browser serves
`c998b4d8`. The repairs in this audit are not in that installer. The existing
20-PR desktop-release rule resumes after the completed one-off 1.0.8 release;
an audit request is not another early-release override. New reviewed highlights
are prepared for the next desktop release without replacing public 1.0.8 notes.
Pages publication and the separate phone-control Worker deployment must be
verified independently after merge.

The phone-service repair is built and reviewed but not deployed at this cut.
The existing Cloudflare browser session confirmed `cisgz3a@gmail.com`, the
`kerfdesk-phone-control` service, active version `669a4cbb` and the expected
Assets, OAuth KV, rate-limiter and Durable Object bindings. The CLI instead
authenticated a different account; its credentials were preserved. Browser
control stopped during local evidence preparation, before any Worker code change
or Deploy action. Correct-account deployment and a fresh live-service check
remain explicit next actions; no production consent/pairing was exercised.
