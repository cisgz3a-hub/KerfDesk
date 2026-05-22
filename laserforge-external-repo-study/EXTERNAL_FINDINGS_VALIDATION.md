# External Findings Validation Audit

Date: 2026-05-21
Repo: `C:/Users/Asus/LaserForge`
Scope: validation of the external comparator findings in `FINDINGS_REGISTER.md`

## 1. Verdict

The 65 `LF-EXT-*` entries are not validated LaserForge bugs. They are external comparator lessons gathered from static review of Rayforge, MeerK40t, LaserGRBL, LaserWeb4, VisiCut, LibLaserCut, K40 Whisperer, Universal G-Code Sender, bCNC, Candle, and OpenBuilds CONTROL.

They must be treated as audit lenses and fix-plan inputs only. No external finding may become a LaserForge fix unless a LaserForge sector audit proves:

- exact LaserForge file path
- exact function/component/module
- trigger path
- failure mode
- machine-control, user, security, or release consequence
- why the issue is not a false positive
- concrete fix
- required test

The external repo code is not assumed good. The study did not run build/test suites for the comparator repos. It was a static source and documentation study with pinned commits and recorded limitations.

## 2. Evidence Limits

| Evidence limit | Impact |
|---|---|
| Comparator build/test suites were not run. | Do not claim a comparator implementation is safe, tested, or production-grade. |
| Hardware behavior was not tested. | Do not copy machine-control behavior without LaserForge fake-controller tests and real hardware validation. |
| Several comparator repos are old or monolithic. | Use them for hard-earned protocol lessons, not architecture imitation. |
| Some comparator repos contain explicit anti-patterns. | Treat those findings as "do not copy" evidence. |
| GRBL documentation remains the normative source for GRBL semantics. | Comparator code can reinforce GRBL rules but cannot override firmware docs. |

## 3. Repo Trust Posture

| Repo | Validation posture | Good for | Not good for |
|---|---|---|---|
| Rayforge | Strong modern comparator, but build/tests not run locally. | Pipeline separation, materials, coordinate concepts, diagnostics, test posture. | Blind copying of Python/GTK architecture or assuming runtime behavior. |
| MeerK40t | Strong breadth comparator, static only. | Device-family abstraction, spooler lifecycle, GRBL metadata, planning tests. | Copying plugin/service complexity into LaserForge without a proven need. |
| LaserGRBL | Strong practical GRBL sender comparator, weak visible test posture. | Buffered streaming, resume ideas, M3/M4/M5 operator behavior, preview-from-command ideas. | Monolithic sender shape or thin test posture. |
| LaserWeb4 | Useful cautionary comparator. | Raster settings, preview-from-emitted-output concepts, UI/server split lessons. | Fake streaming, warning-only safety gates, old dependency/release posture. |
| VisiCut | Strong architecture and job/driver split comparator, static only. | Project-to-job separation, driver capability checks, persistence ideas. | Assuming LibLaserCut runtime behavior without local verification. |
| LibLaserCut | Strong driver-abstraction and golden-output comparator, static only. | Capability checks, origin/start-point handling, golden driver tests. | Copying Java driver assumptions directly into GRBL/Electron code. |
| K40 Whisperer | Useful legacy/protocol and beginner-workflow comparator. | Explicit laser on/off state, K40-specific protocol caution, simple operator flow. | Monolithic GUI/control structure, weak automated testing, disabled image pixel guard. |
| Universal G-Code Sender | Strong sender/test comparator, static only. | Byte-accounted streaming, pause/resume/cancel tests, parser fixtures, file-backed streams. | Assuming laser-specific safety is fully covered by a CNC sender model. |
| bCNC | Useful practical sender comparator with legacy caveats. | RX byte budgeting, WCS/status assumptions, fake-GRBL and serial transcript ideas. | Tight UI/sender/CAM coupling and old CI posture. |
| Candle | Useful native GRBL comparator, static only. | Active-command budget, parser-derived visualizer, WCS/status docs. | Large central UI/controller coupling and unproven test posture. |
| OpenBuilds CONTROL | Useful behavior and anti-pattern comparator. | Firmware/profile data, RX byte accounting, support diagnostics. | Broad local-server exposure, permissive CORS, Node-enabled renderer, placeholder tests, fake large-job streaming. |

## 4. Validation Categories

Use these classifications before any future implementation:

| Classification | Meaning | Allowed use |
|---|---|---|
| `BASELINE AUDIT LENS` | Reinforced by multiple comparators and/or GRBL firmware docs. | Use as a question in sector audits. Still not a LaserForge finding by itself. |
| `ADAPT AFTER LOCAL EVIDENCE` | Useful pattern, but it must be proven applicable to LaserForge first. | Create a LaserForge finding only if local evidence proves a gap. |
| `REJECT AS ANTI-PATTERN` | External implementation is risky, stale, weakly tested, or contrary to LaserForge safety goals. | Use as a "do not copy" guardrail. |
| `SPLIT DECISION` | Some part is useful, another part is unsafe or unsuitable. | Adapt only the useful concept; reject the rest. |
| `UNVERIFIED RUNTIME CLAIM` | Static evidence exists, but build/test/hardware behavior is unproven. | Do not use as proof of external code quality. |

## 5. Pattern-Level Validation

| Pattern | External IDs | Validation |
|---|---|---|
| GRBL byte/character-counted streaming with ack/error/accounting | `LF-EXT-RAY-002`, `LF-EXT-LGRBL-001`, `LF-EXT-UGS-001`, `LF-EXT-BCNC-001`, `LF-EXT-CANDLE-001`, `LF-EXT-OBC-002` | `BASELINE AUDIT LENS`. This is strongly corroborated, but LaserForge must prove its own sender releases capacity only from controller evidence and does not fake-stream by materializing full jobs. |
| Fake streaming/full materialization warning | `LF-EXT-LW4-002`, `LF-EXT-OBC-004` | `REJECT AS ANTI-PATTERN`. These are useful because they show what not to do. They do not prove LaserForge has the bug unless a local sector audit finds materialization on the send path. |
| Pause/resume/stop/error recovery as firmware-state transitions | `LF-EXT-MK-002`, `LF-EXT-LGRBL-002`, `LF-EXT-UGS-002`, `LF-EXT-UGS-005`, `LF-EXT-BCNC-002`, `LF-EXT-CANDLE-002`, `LF-EXT-OBC-003` | `ADAPT AFTER LOCAL EVIDENCE`. Strong comparator area, but resume/stop semantics are safety-sensitive. LaserForge must prove exact transitions, final laser-off behavior, queue cleanup, and status recovery locally. |
| M3/M4/M5/S-value and laser-off handling | `LF-EXT-LGRBL-004`, `LF-EXT-VISI-004`, `LF-EXT-LLC-002`, `LF-EXT-LLC-004`, `LF-EXT-K40-003`, `LF-EXT-OBC-003` | `BASELINE AUDIT LENS`. GRBL docs must be the source of truth. External code can suggest tests for M3, M4, M5, S0, G0 blanking, and dynamic-power preflight. |
| WCS/origin/profile/status metadata | `LF-EXT-RAY-003`, `LF-EXT-VISI-003`, `LF-EXT-LLC-003`, `LF-EXT-UGS-006`, `LF-EXT-BCNC-003`, `LF-EXT-CANDLE-003`, `LF-EXT-CANDLE-005`, `LF-EXT-OBC-005` | `BASELINE AUDIT LENS`. Coordinate state must be explicit and machine-profile-backed. Still requires LaserForge-specific proof around reset-to-baseline, signed bounds, WCS, and Z-axis caveats. |
| Preview/output parity | `LF-EXT-LGRBL-003`, `LF-EXT-LW4-005`, `LF-EXT-UGS-004`, `LF-EXT-CANDLE-004`, `LF-EXT-OBC-006` | `BASELINE AUDIT LENS`. Preview should be derived from emitted/parsed output or a shared plan source, not guessed from UI state. Local tests must prove no divergence for LaserForge. |
| Driver/capability abstraction | `LF-EXT-MK-001`, `LF-EXT-VISI-002`, `LF-EXT-LLC-001`, `LF-EXT-K40-001`, `LF-EXT-BCNC-004` | `ADAPT AFTER LOCAL EVIDENCE`. Useful if LaserForge broadens beyond GRBL/Falcon. Do not add abstraction just because other apps have many device families. |
| Raster/vector/golden output testing | `LF-EXT-MK-003`, `LF-EXT-LW4-003`, `LF-EXT-VISI-005`, `LF-EXT-LLC-005`, `LF-EXT-UGS-003`, `LF-EXT-UGS-004` | `ADAPT AFTER LOCAL EVIDENCE`. Good testing direction. Requires LaserForge fixtures and expected outputs, not external behavior claims. |
| Persistence/project format preservation | `LF-EXT-VISI-006` | `ADAPT AFTER LOCAL EVIDENCE`. Use as a persistence audit question only. |
| Material presets and beginner workflow | `LF-EXT-RAY-004`, `LF-EXT-K40-006`, `LF-EXT-BCNC-005` | `SPLIT DECISION`. Material/test-grid and simple operator flow are useful. Do not copy weak safety posture or monolithic code shapes. |
| Electron/local-server/network trust boundary | `LF-EXT-LW4-001`, `LF-EXT-LLC-006`, `LF-EXT-CANDLE-006`, `LF-EXT-OBC-001` | `BASELINE AUDIT LENS` for security questions, but `REJECT AS ANTI-PATTERN` for broad local-server exposure and command-capable untrusted surfaces. |
| Release/test/signing posture | `LF-EXT-LGRBL-005`, `LF-EXT-LW4-006`, `LF-EXT-OBC-007` | Mostly `REJECT AS ANTI-PATTERN`. Use these to avoid fake tests, stale dependencies, broad package globs, and unsafe signing workflows. |
| Monolithic architecture warnings | `LF-EXT-LGRBL-005`, `LF-EXT-K40-006`, `LF-EXT-BCNC-007`, `LF-EXT-CANDLE-007`, `LF-EXT-OBC-008` | `REJECT AS ANTI-PATTERN`. Learn behavior, not structure. |

## 6. Per-Finding Validation

| ID | Validation | Reason |
|---|---|---|
| `LF-EXT-RAY-001` | `ADAPT AFTER LOCAL EVIDENCE` | DAG artifacts are a useful architecture pattern, but LaserForge must prove an actual pipeline confusion before changing code. |
| `LF-EXT-RAY-002` | `BASELINE AUDIT LENS` | Character-counting GRBL transport is corroborated by other senders and firmware interface expectations. |
| `LF-EXT-RAY-003` | `BASELINE AUDIT LENS` | Explicit coordinate spaces are a hard audit question for any machine-control app. |
| `LF-EXT-RAY-004` | `ADAPT AFTER LOCAL EVIDENCE` | Materials/presets/test grids are product quality patterns, not safety findings by themselves. |
| `LF-EXT-MK-001` | `ADAPT AFTER LOCAL EVIDENCE` | Device-family isolation is valuable only when LaserForge has multiple controller families needing it. |
| `LF-EXT-MK-002` | `BASELINE AUDIT LENS` | Job/spool lifecycle must be explicit in LaserForge, but MeerK40t runtime behavior was not executed here. |
| `LF-EXT-MK-003` | `ADAPT AFTER LOCAL EVIDENCE` | Planning tests are a strong idea; LaserForge needs its own CAM fixtures. |
| `LF-EXT-MK-004` | `BASELINE AUDIT LENS` | GRBL settings, alarms, status, and errors should feed profile/preflight audits. |
| `LF-EXT-LGRBL-001` | `BASELINE AUDIT LENS` | Buffered streaming is a strong GRBL sender invariant. |
| `LF-EXT-LGRBL-002` | `ADAPT AFTER LOCAL EVIDENCE` | Resume reconstruction is useful but safety-sensitive; do not copy without local transcript tests. |
| `LF-EXT-LGRBL-003` | `BASELINE AUDIT LENS` | Preview derived from parsed command state is a strong parity audit question. |
| `LF-EXT-LGRBL-004` | `BASELINE AUDIT LENS` | M3/M4/M5 and laser-mode warnings align with GRBL laser-mode semantics. |
| `LF-EXT-LGRBL-005` | `REJECT AS ANTI-PATTERN` | Thin visible test coverage and monolithic sender shape should not be copied. |
| `LF-EXT-LW4-001` | `SPLIT DECISION` | UI/server separation is a useful security question; broad command surfaces need trusted-boundary validation. |
| `LF-EXT-LW4-002` | `REJECT AS ANTI-PATTERN` | Worker progress plus final join is fake streaming. |
| `LF-EXT-LW4-003` | `ADAPT AFTER LOCAL EVIDENCE` | Raster settings breadth is useful, but not proof LaserForge needs every option. |
| `LF-EXT-LW4-004` | `REJECT AS ANTI-PATTERN` | Warning-only bounds/start behavior is unacceptable for LaserForge safety gates. |
| `LF-EXT-LW4-005` | `BASELINE AUDIT LENS` | Preview from parsed emitted G-code is a strong parity principle. |
| `LF-EXT-LW4-006` | `REJECT AS ANTI-PATTERN` | Old dependencies and weak CI/release posture are cautionary only. |
| `LF-EXT-VISI-001` | `ADAPT AFTER LOCAL EVIDENCE` | Job-prep/driver split is useful, but LaserForge current boundaries must be audited first. |
| `LF-EXT-VISI-002` | `BASELINE AUDIT LENS` | Send-boundary sanity checks are required for device-control safety. |
| `LF-EXT-VISI-003` | `ADAPT AFTER LOCAL EVIDENCE` | Idempotent start-point handling is a strong coordinate audit question. |
| `LF-EXT-VISI-004` | `ADAPT AFTER LOCAL EVIDENCE` | White-pixel/raster compatibility depends on LaserForge chosen GRBL and raster semantics. |
| `LF-EXT-VISI-005` | `BASELINE AUDIT LENS` | Golden output and repeated-generation tests are appropriate for output correctness. |
| `LF-EXT-VISI-006` | `ADAPT AFTER LOCAL EVIDENCE` | Project-file preservation is useful for persistence audits, not a direct fix. |
| `LF-EXT-LLC-001` | `BASELINE AUDIT LENS` | Capability checks belong at hardware/output boundaries. |
| `LF-EXT-LLC-002` | `BASELINE AUDIT LENS` | Firmware safety defaults must be explicit, though GRBL docs remain authoritative. |
| `LF-EXT-LLC-003` | `ADAPT AFTER LOCAL EVIDENCE` | Origin/start-point idempotence should be tested locally. |
| `LF-EXT-LLC-004` | `ADAPT AFTER LOCAL EVIDENCE` | Raster white-gap behavior is machine/firmware dependent. |
| `LF-EXT-LLC-005` | `BASELINE AUDIT LENS` | Golden driver tests are a strong output-quality gate. |
| `LF-EXT-LLC-006` | `BASELINE AUDIT LENS` | Host/upload/API-key settings are trust-boundary data and must be audited locally. |
| `LF-EXT-K40-001` | `ADAPT AFTER LOCAL EVIDENCE` | Separate K40 protocol support matters only if LaserForge targets K40/Lihuiyu devices. |
| `LF-EXT-K40-002` | `ADAPT AFTER LOCAL EVIDENCE` | Stop/home/unlock/pause behavior is useful but protocol-specific. |
| `LF-EXT-K40-003` | `BASELINE AUDIT LENS` | Explicit laser ON/OFF modal state is a strong safety invariant. |
| `LF-EXT-K40-004` | `ADAPT AFTER LOCAL EVIDENCE` | Color/layer operation mapping is useful only if LaserForge uses or imports that convention. |
| `LF-EXT-K40-005` | `ADAPT AFTER LOCAL EVIDENCE` | USB permission setup is operationally relevant, but platform-specific. |
| `LF-EXT-K40-006` | `SPLIT DECISION` | Simple workflow is useful; monolithic architecture and weak tests are rejected. |
| `LF-EXT-UGS-001` | `BASELINE AUDIT LENS` | Active-command byte accounting is a strong sender invariant. |
| `LF-EXT-UGS-002` | `BASELINE AUDIT LENS` | Pause/resume/cancel tests are a high-value test design pattern. |
| `LF-EXT-UGS-003` | `BASELINE AUDIT LENS` | File-backed streams reinforce bounded large-job handling. |
| `LF-EXT-UGS-004` | `BASELINE AUDIT LENS` | Parser/stream fixture tests are appropriate for preview/output parity. |
| `LF-EXT-UGS-005` | `ADAPT AFTER LOCAL EVIDENCE` | Run-from/resume modal reconstruction is risky and must be proven locally. |
| `LF-EXT-UGS-006` | `BASELINE AUDIT LENS` | Homing, WCS reset, alarm unlock, check mode, parser state, and jog behavior must be capability-gated. |
| `LF-EXT-BCNC-001` | `BASELINE AUDIT LENS` | RX byte budgeting is a strong GRBL streaming invariant. |
| `LF-EXT-BCNC-002` | `ADAPT AFTER LOCAL EVIDENCE` | Stop/purge recovery ideas require LaserForge-specific state-machine proof. |
| `LF-EXT-BCNC-003` | `BASELINE AUDIT LENS` | WCS/reporting assumptions must be explicit in setup and preflight. |
| `LF-EXT-BCNC-004` | `ADAPT AFTER LOCAL EVIDENCE` | Controller modules are useful if LaserForge broadens firmware support. |
| `LF-EXT-BCNC-005` | `ADAPT AFTER LOCAL EVIDENCE` | Operator-visible laser mode/power/feed/pass controls require LaserForge UX and safety policy. |
| `LF-EXT-BCNC-006` | `SPLIT DECISION` | Fake-controller and transcript diagnostics are useful; weak GUI smoke posture is rejected. |
| `LF-EXT-BCNC-007` | `REJECT AS ANTI-PATTERN` | Tight UI/sender/CAM coupling and legacy CI should not be copied. |
| `LF-EXT-CANDLE-001` | `BASELINE AUDIT LENS` | 127/128-byte style active command budgeting is a GRBL sender audit question. |
| `LF-EXT-CANDLE-002` | `ADAPT AFTER LOCAL EVIDENCE` | Error-response hold/abort semantics must match LaserForge device state machine. |
| `LF-EXT-CANDLE-003` | `BASELINE AUDIT LENS` | G92/G10, `$G`, `$#`, WCO, and offsets must be tracked and refreshed safely. |
| `LF-EXT-CANDLE-004` | `BASELINE AUDIT LENS` | Parser-produced line segments are a strong preview/progress parity model. |
| `LF-EXT-CANDLE-005` | `ADAPT AFTER LOCAL EVIDENCE` | Product setup docs for GRBL settings are useful but not a code defect. |
| `LF-EXT-CANDLE-006` | `BASELINE AUDIT LENS` | Command-capable script/serial/network surfaces are security boundaries. |
| `LF-EXT-CANDLE-007` | `REJECT AS ANTI-PATTERN` | Large central UI/sender structure and unproven tests should not be copied. |
| `LF-EXT-OBC-001` | `REJECT AS ANTI-PATTERN` | Broad local-server exposure, permissive CORS, and Node-enabled renderer are not acceptable patterns. |
| `LF-EXT-OBC-002` | `BASELINE AUDIT LENS` | RX-byte accounting and realtime bypass reinforce GRBL sender requirements. |
| `LF-EXT-OBC-003` | `ADAPT AFTER LOCAL EVIDENCE` | Firmware-specific pause/resume/stop/test-fire behavior is useful but must be re-proven in LaserForge. |
| `LF-EXT-OBC-004` | `REJECT AS ANTI-PATTERN` | Splitting a full G-code string into a queue is not bounded streaming. |
| `LF-EXT-OBC-005` | `ADAPT AFTER LOCAL EVIDENCE` | Firmware/profile/status metadata should inform LaserForge setup and diagnostics. |
| `LF-EXT-OBC-006` | `ADAPT AFTER LOCAL EVIDENCE` | Diagnostics should tie to controller/send state, but privacy and scope need local design. |
| `LF-EXT-OBC-007` | `REJECT AS ANTI-PATTERN` | Placeholder tests and unsafe signing/release patterns must not be copied. |
| `LF-EXT-OBC-008` | `REJECT AS ANTI-PATTERN` | Monolithic Node/Electron control structure is unsuitable for LaserForge. |

## 7. Findings That Are Safe To Use Immediately

These are safe as audit questions only:

1. Does LaserForge enforce byte/character-counted GRBL streaming with correct ack/error capacity release?
2. Does every start/send path avoid full G-code materialization unless materialization is explicitly requested?
3. Does every pause/resume/stop/error transition end in a safe laser/motion state with evidence?
4. Are M3/M4/M5/S-value/$32/$30/$31 assumptions explicit and tested?
5. Are WCS, origin, bounds, signed coordinates, and Z-axis caveats explicit and tested?
6. Is preview derived from plan/output rather than guessed from UI state?
7. Are IPC, Falcon WiFi, local network, file import, and command-capable surfaces validated on the trusted side?
8. Are release/signing workflows protected by real tests, explicit file allowlists, and hardware QA gates?

None of these questions is a LaserForge bug until local evidence proves it.

## 8. Findings That Must Not Be Used As Proof

Do not use any external finding to claim:

- a comparator app is production-safe
- a comparator app tests pass
- a comparator app hardware behavior is safe
- LaserForge has the same defect
- copying a comparator implementation is safe
- old or monolithic code is acceptable because it exists in another laser/CNC app

Specific blocked inferences:

| Blocked inference | Reason |
|---|---|
| "LaserWeb4/OpenBuilds split jobs into queues, so that is streaming." | Both showed full materialization before queuing in inspected paths. |
| "OpenBuilds is Electron, so copy its local server/security shape." | It is a security anti-pattern comparator, not a model. |
| "LaserGRBL is popular, so its test posture is enough." | Visible tests were narrow and did not prove sender safety. |
| "K40 Whisperer is simple, so LaserForge can collapse modules." | Its simplicity is useful for UX only; architecture/test posture is rejected. |
| "UGS/Candle/bCNC resume logic can be copied." | Resume is machine-state sensitive and must be re-derived for LaserForge. |

## 9. Required Gate Before Any Fix From External Findings

Before implementing any item in `LASERFORGE_FIX_PLAN.md`, create or reference a LaserForge sector finding that includes:

- `Learned from:` one or more `LF-EXT-*` IDs
- `Evidence:` exact LaserForge file/function/module plus external source note
- `LaserForge target:` exact file/module to change
- `Action type:` `COPY CONCEPT`, `ADAPT`, `REJECT`, `BLOCK`, or `DOCUMENT`
- failure mode and machine-control/user/security consequence
- test that would fail before the fix and pass after

If those fields cannot be filled, the item must remain a research note, not an implementation task.

## 10. Next Audit Step

Continue sector-by-sector LaserForge audit or fix only already validated LaserForge findings. Do not run a full repo audit pass from these external lessons. Do not implement an external pattern until the matching LaserForge sector report proves a local defect or gap.
