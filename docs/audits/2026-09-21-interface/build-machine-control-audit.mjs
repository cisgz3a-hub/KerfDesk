import fs from 'node:fs';
import console from 'node:console';
import process from 'node:process';

const base = 'docs/audits/2026-09-21-interface';
const inventory = JSON.parse(fs.readFileSync(`${base}/buttons.json`, 'utf8')).controls.filter((c) =>
  ['laser', 'machine', 'calibration'].includes(c.area),
);
const reports = fs
  .readdirSync(base)
  .filter((name) => /^control-audit-machine-.*vitest\.json$/.test(name));
if (fs.existsSync(`${base}/control-audit-tutorial-pane-vitest.json`))
  reports.push('control-audit-tutorial-pane-vitest.json');
// Later targeted runs supersede an earlier result for the same case. Skipped
// cases in a targeted run do not erase their last executed result.
const latestExecuted = new Map();
for (const { report, data } of reports
  .map((report) => ({ report, data: JSON.parse(fs.readFileSync(`${base}/${report}`, 'utf8')) }))
  .sort((a, b) => a.data.startTime - b.data.startTime)) {
  for (const suite of data.testResults) {
    for (const test of suite.assertionResults) {
      if (!['passed', 'failed'].includes(test.status)) continue;
      const file = suite.name.replaceAll('\\', '/').split('/src/').at(-1);
      latestExecuted.set(`${file}:${test.fullName}`, { ...test, file, report });
    }
  }
}
const executed = [...latestExecuted.values()];
const rows = inventory.map((c) => ({
  id: c.id,
  label: c.label || c.tag,
  expectedOutcome:
    c.kind === 'disclosure'
      ? 'Expand or collapse the named section without changing the job.'
      : `Invoke the ${c.tag} action wired by ${c.component}.`,
  availability: {
    disabledWhen: c.disabled,
    enclosingConditions: c.visibilityConditions,
    scope: 'Current UI component; controller-specific runtime checks remain in the action/store.',
  },
  handlerTrace: c.handlers,
  evidence: [],
  disposition: 'unverified',
  notes: 'Source handler traced; exact rendered-control outcome still needs an executed assertion.',
}));
const missing = [];
function R(
  file,
  lines,
  testFile,
  title,
  outcome,
  boundary = 'Rendered control and callback arguments verified at the named component boundary; downstream effects are not established by this case. No physical controller or material run.',
  disposition = 'verified-boundary',
) {
  const controls = inventory.filter(
    (c) => c.file === `src/ui/${file}.tsx` && (lines === '*' || lines.includes(c.line)),
  );
  if (!controls.length) throw new Error(`Unknown baseline control ${file}:${lines}`);
  const tests = executed.filter(
    (t) =>
      t.file === `ui/${testFile}` &&
      t.status === 'passed' &&
      (title instanceof RegExp ? title.test(t.title) : t.title.includes(title)),
  );
  if (!tests.length) {
    missing.push({ file, lines, testFile, title: String(title) });
    return;
  }
  for (const control of controls) {
    const row = rows.find((r) => r.id === control.id);
    row.expectedOutcome = outcome;
    row.disposition = disposition;
    row.notes = boundary;
    row.evidence.push(
      ...tests.map((t) => ({
        file: `src/${t.file}`,
        test: t.fullName,
        result: 'passed',
        boundary,
        report: `${base}/${t.report}`,
      })),
    );
  }
}
const L = (f, lines, tf, title, outcome, boundary, disposition) =>
  R(`laser/${f}`, lines, `laser/${tf}`, title, outcome, boundary, disposition);
const D = (f, lines, tf, title, outcome, boundary, disposition) =>
  L(`device-setup/${f}`, lines, `device-setup/${tf}`, title, outcome, boundary, disposition);
const B = (f, lines, tf, title, outcome, boundary, disposition) =>
  L(`board-capture/${f}`, lines, `board-capture/${tf}`, title, outcome, boundary, disposition);
const M = (f, lines, tf, title, outcome, boundary, disposition) =>
  R(`machine/${f}`, lines, `machine/${tf}`, title, outcome, boundary, disposition);

for (const [name, word, line] of [
  ['IntervalTestDialog', 'interval', 90],
  ['MaterialTestDialog', 'material', 97],
  ['ScanOffsetCalibrationDialog', 'scan offset', 92],
]) {
  R(
    `calibration/${name}`,
    [line],
    'laser/MachineDialogControls.audit.test.tsx',
    `${word} Cancel calls`,
    'Cancel this dialog without generating a calibration job.',
  );
  R(
    `calibration/${name}`,
    [line + 1],
    `calibration/${name}.test.tsx`,
    'controls and generates parsed options',
    'Validate the draft and return parsed calibration options through Generate.',
  );
}
R(
  'calibration/ScanOffsetCalibrationDialog',
  [93],
  'calibration/ScanOffsetCalibrationDialog.test.tsx',
  'generates a profile-corrected verification coupon',
  'Generate the selected baseline or profile-corrected verification coupon.',
);
L(
  'AccessoryResetControls',
  '*',
  'JobControls.idle-accessories.test.tsx',
  'sends one acknowledged',
  'Confirm tool clearance, then request one M5/M9 accessory-off block.',
  'Rendered click to mocked console sender, exact block asserted; declined confirmation also tested.',
);
L(
  'AutofocusEditor',
  '*',
  'AutofocusEditor.test.tsx',
  'offers only presets',
  'Apply the selected single-line autofocus preset to the draft.',
);
L(
  'CheckpointResumeBanner',
  [44],
  'CheckpointResumeBanner.test.tsx',
  'audit recovery disclosure',
  'Open and close interrupted-job details without changing the saved recovery capsule.',
  'Real native summary clicks and store identity preservation asserted; no recovery started.',
);
L(
  'CheckpointResumeBanner',
  [140],
  'CheckpointResumeBanner.test.tsx',
  'opens and closes review',
  'Open recovery review without mutating the saved capsule, project or machine state.',
);
L(
  'CheckpointResumeBanner',
  [150],
  'CheckpointResumeBanner.test.tsx',
  'discards only the selected',
  'Delete only the confirmed recovery capsule.',
);
L(
  'CncPassRecoveryChecklist',
  [63, 84],
  'CncPassRecoveryWizard.test.tsx',
  'starts the flow',
  'Record explicit physical confirmations and selected re-zeroed position for the reviewed recovery request.',
  'Checkbox/radio UI assertions and mocked recovery flow; physical confirmations themselves are operator attestations.',
);
L(
  'CncPassRecoveryChecklist',
  [46],
  'CncPassRecoveryWizard.test.tsx',
  'offers retained position',
  'Offer retained position only when session continuity evidence exists.',
  'Evidence/availability is tested; physical retained position not qualified.',
  'verified-boundary',
);
L(
  'CncPassRecoveryWizard',
  [120],
  'CncPassRecoveryWizard.test.tsx',
  'opens the advanced',
  'Open the advanced supervised runway recovery wizard.',
);
L(
  'CncPassRecoveryWizard',
  [128],
  'CncPassRecoveryWizard.test.tsx',
  'starts the flow',
  'Start the reviewed pass recovery once and close on success.',
);
L(
  'CncRecoveryPreviewWizard',
  [148, 157],
  'CncRecoveryPreviewWizard.test.tsx',
  'keeps execution gated',
  'Advance through review and dispatch supervised recovery only after all qualifications are explicit.',
  'Executed wizard navigation and final mocked recovery call; no hardware qualification.',
);
L(
  'CncRecoveryPreviewWizard',
  [125],
  'CncRecoveryPreviewWizard.test.tsx',
  'blocks duplicate Start',
  'Keep Close, Back and duplicate Start inert while recovery startup is in flight.',
  'Boundary verified during startup; independent ready-state Close tracked separately.',
  'verified-boundary',
);
L(
  'CncRecoveryQualificationStep',
  '*',
  'CncRecoveryPreviewWizard.test.tsx',
  'keeps execution gated',
  'Update each explicit recovery qualification before execution becomes available.',
);
L(
  'CompletedJobNotice',
  '*',
  'CompletedJobNotice.simulator.test.tsx',
  'offers Done after',
  'Clear only the settled completed-run preview while keeping the project, archive and repeat receipt.',
  'Real store with simulated transport; verifies zero new writes on Done.',
);
L(
  'ConnectionBar',
  [61, 70],
  'ConnectionBar-forget-device.test.tsx',
  'separate explicit actions',
  'Disconnect retains permission; Forget uses the distinct permission-forgetting callback.',
);
L(
  'ConnectionBar',
  [93],
  'MachineRunControls.audit.test.tsx',
  'Connect dispatches',
  'Open connection through the callback while disconnected; ignore clicks while connecting.',
);
L(
  'ConnectionBar',
  [127, 138],
  'ConnectionBar-forget-device.test.tsx',
  'inline retry action',
  'Retry qualification or reconnect using distinct callbacks.',
);
L(
  'ConsolePanel',
  [79],
  'ConsolePanel.test.tsx',
  'offers a manual transcript',
  'Copy visible transcript; offer selectable manual transcript if clipboard is unavailable.',
  'Browser clipboard mocked; manual fallback contents asserted.',
);
L(
  'ConsolePanel',
  [92],
  'ConsolePanel.test.tsx',
  'clearing the console retires',
  'Clear transcript and retire current or pending manual-copy output.',
);
L(
  'ConsolePanel',
  [115, 124],
  'ConsolePanel.test.tsx',
  'hides status polls',
  'Toggle status and stream transcript visibility.',
);
L(
  'ControlledLaserOffTravelRow',
  '*',
  'MachineProfileControls.audit.test.tsx',
  'controlled laser-off travel',
  'Enable a bounded laser-off travel feed or clear its optional override.',
);
L(
  'DetectedSettingsBanner',
  [114],
  'DetectedSettingsBanner.test.ts',
  'applies the guarded powered Z',
  'Explicitly apply detected powered-Z capability without asserting physical travel confirmation.',
);
L(
  'DeviceProfileFields',
  '*',
  'MachineProfileControls.audit.test.tsx',
  'homing and laser mode',
  'Record homing support while preserving its configured direction.',
);
L(
  'DeviceProfilePowerFields',
  [64],
  'MachineProfileControls.audit.test.tsx',
  'homing and laser mode',
  'Record expected laser mode in the profile; no firmware write.',
);
L(
  'DeviceProfilePowerFields',
  [113],
  'MachineProfileControls.audit.test.tsx',
  'air restart checkbox',
  'Record the air restart limitation only when an air output is configured.',
);
L(
  'DeviceProfilePowerFields',
  [138],
  'DeviceSettings.test.tsx',
  'requires explicit profile enablement',
  'Explicitly enable capped low-power Fire on a capable machine profile.',
);
L(
  'DeviceProfileRows',
  [27, 99],
  'DeviceSettings.test.tsx',
  'applies the Neotronics',
  'Apply the confirmed Neotronics profile and allow explicit Z-travel confirmation.',
);
L(
  'DeviceProfileRows',
  [63],
  'DeviceSettings.test.tsx',
  'lets the operator declare',
  'Toggle powered-Z capability and invalidate prior Z-travel confirmation.',
);
L(
  'DeviceProfileRows',
  [119],
  'MachineProfileControls.audit.test.tsx',
  'probe presence',
  'Record probe availability in the profile without issuing motion.',
);
L(
  'DeviceSettings',
  '*',
  'DeviceSettings.test.tsx',
  'opens the Device Profile',
  'Show the legacy Device Profile fields initially expanded.',
  'Default disclosure state verified; native collapse not exercised.',
  'verified-boundary',
);
L(
  'ExecutionArchivePanel',
  [116],
  'ExecutionArchivePanel.test.tsx',
  'exports the exact stored artifact',
  'Export the exact archived artifact in a versioned typed-array-safe envelope.',
  'Platform file-save mock and serialized payload asserted; actual OS picker not used.',
);
L(
  'FocusJogControls',
  [41, 47, 88],
  'JogPad.test.tsx',
  'sends relative Z jogs',
  'Dispatch signed relative Z focus jogs only for confirmed powered-Z profiles.',
);
L(
  'IslandFillRecoveryAction',
  '*',
  'IslandFillRecoveryAction.test.tsx',
  'offers one-click Scanline',
  'Change relevant Island Fill layers to Scanline without starting output.',
);
L(
  'JobActionControls',
  [105],
  'WorkspaceJobActions.test.tsx',
  'routes Frame and setup-and-Frame',
  'Dispatch the Frame handler once from the rendered button.',
  'Frame handler is vi.fn; this case verifies button wiring only, not artifact identity, completion, or the Frame/Start policy.',
);
L(
  'JobActionControls',
  [117],
  'WorkspaceJobActions.test.tsx',
  'routes Frame and setup-and-Frame',
  'Dispatch the setup-and-Frame/Start preparation handler once from the rendered button.',
  'Start preparation handler is vi.fn; this case verifies button wiring only, not artifact identity or the Frame/Start policy.',
);
L(
  'JobPlacementControls',
  [115],
  'JobControls.test.tsx',
  'renders explicit Start From',
  'Offer nine anchor choices for job placement.',
  'Labels and availability are asserted; exact anchor mutation needs direct click.',
  'verified-boundary',
);
L(
  'JobSetupControls',
  [24, 66, 32, 87],
  'MachineRunControls.audit.test.tsx',
  'Home and configured',
  'Invoke Home or configured autofocus action; keep both inert during an active job.',
);
L(
  'JobSetupControls',
  [54],
  'JobControls.setup-navigation.test.tsx',
  'opens homing configuration',
  'Open the homing page even while disconnected.',
  'Regression for the repaired missing callback default; UI setup store and highlighted field asserted.',
  'defect-fixed',
);
L(
  'JobSetupControls',
  [87],
  'JobControls.setup-navigation.test.tsx',
  'opens the autofocus page',
  'Open autofocus setup when unconfigured, or request the configured focus action when available.',
  'Regression asserts real setup-store navigation for the missing callback. Configured autofocus is a mocked action request; focus motion is not verified.',
  'defect-fixed',
);
L(
  'JogArrowGrid',
  [43, 49, 80],
  'JogPad.motion-controls.test.tsx',
  'audit all eight direction',
  'Request the signed XY step vector for each of the eight directions; disabled controls ignore clicks.',
  'All eight arrows invoke a mocked jog action with exact vector/feed arguments; no machine motion is executed.',
);
L(
  'JogArrowGrid',
  [43, 49, 80],
  'JogPad.motion-controls.test.tsx',
  'holds toward the machine boundary',
  'Request supported held jogs and cancellation on pointer release.',
  'Mocked jog and cancel actions; held vector and release dispatch asserted, not physical motion.',
);
L(
  'JogArrowGrid',
  [43, 49, 80],
  'JogPad.motion-controls.test.tsx',
  'does not start a hold or release step',
  'Request each signed XY step or supported held jog and cancel on release; suppress steps and holds when disabled during a press.',
  'All eight step arguments, held jog/release, and disabled-mid-press dispatch suppression have named component cases. Jog/cancel actions are mocks; no physical motion.',
);
L(
  'JogPadAirAssist',
  [91],
  'JogPad.test.tsx',
  'calls the manual air',
  'Toggle manual air through the store action.',
);
L(
  'JogPadAirAssist',
  [157],
  'JogPad.test.tsx',
  'offers Machine Setup instead',
  'Open Machine Setup when no air output command is configured.',
);
L(
  'JogPadAirAssist',
  [191],
  'JogPad.test.tsx',
  'applies the missing Job Air',
  'Apply missing Job Air defaults and enable manual air after explicit Proceed.',
);
L(
  'LabsSettingsDialog',
  '*',
  'MachineDialogControls.audit.test.tsx',
  'Labs toggles',
  'Persist each Labs opt-in, Reset all to false, and close with Done.',
);
L(
  'LaserRecoveryReviewDialog',
  [157],
  'LaserRecoveryReviewDialog.test.tsx',
  'reviews an exact artifact',
  'Close the recovery review without starting or changing the capsule.',
);
L(
  'LaserRecoveryReviewDialog',
  [165],
  'LaserRecoveryReviewDialog.test.tsx',
  'allows one start attempt',
  'Run exactly one reviewed recovery attempt, retain failure for retry, and close on success.',
);
L(
  'LaserWindow',
  [249],
  'LaserWindow-sleep-recovery.test.tsx',
  'shows an in-app wake',
  'Wake the connected sleeping controller through the store recovery action.',
);
L(
  'LaserWindow',
  [324],
  'LaserWindow-alarm-recovery.test.tsx',
  'does not send Home',
  'Route unsupported Home to setup instead of dispatching $H.',
);
L(
  'LiveMotionActionButton',
  [10],
  'LiveMotionBar.test.tsx',
  'shows token-bound',
  'Render disabled pending Pause/Resume and suppress duplicate dispatch.',
);
L(
  'LiveMotionActionButton',
  [26],
  'MachineRunControls.audit.test.tsx',
  'Pause, Resume and Abort',
  'Dispatch the state-appropriate Pause or Resume action.',
);
L(
  'LiveMotionBar',
  [69, 105, 114],
  'MachineRunControls.audit.test.tsx',
  'Pause, Resume and Abort',
  'Request Pause, Resume or software Abort through the corresponding store action.',
);
L(
  'LiveMotionBar',
  [123],
  'LiveMotionBar.test.tsx',
  'owns gated tool-change Continue',
  'Continue tool-change only with Idle and current Work-Z evidence.',
);
L(
  'MachineSettingsPanel',
  [100],
  'MachineSettingsPanel.test.tsx',
  'calls readMachineSettings',
  'Request read-only controller settings.',
);
L(
  'MachineSettingsPanel',
  [109],
  'MachineSettingsPanel.test.tsx',
  'exports',
  'Export controller settings backup using the platform file boundary.',
);
L(
  'MachineSetupImportExport',
  [85],
  'MachineSetupImportExport.test.tsx',
  'exports the active',
  'Export deterministic active machine-profile JSON.',
);
L(
  'MachineSetupImportExport',
  [86, 134],
  'MachineSetupImportExport.test.tsx',
  'shows a success toast after applying',
  'Open and review a KerfDesk profile import, then apply the selected profile.',
);
L(
  'MachineSetupProfiles',
  [123, 139],
  'MachineSetupProfiles.test.tsx',
  'applies the selected catalog',
  'Apply the exact selected catalog profile without overlaying detected controller values.',
);
L(
  'MachineSetupSafetyZones',
  '*',
  'MachineProfileControls.audit.test.tsx',
  'setup safety zones',
  'Add, enable/disable, and remove the chosen persisted safety zone.',
);
L(
  'MeasuredScanOffsetApply',
  [109],
  'MeasuredScanOffsetApply.test.tsx',
  'blocks duplicate speeds',
  'Add another editable measurement row; invalid measurements keep Apply disabled.',
);
L(
  'MeasuredScanOffsetApply',
  [123],
  'MeasuredScanOffsetApply.test.tsx',
  'saves measured scan offsets',
  'Validate and save measured offsets and pending verification provenance.',
);
L(
  'MeasuredScanOffsetApply',
  [150],
  'MeasuredScanOffsetApply.test.tsx',
  'records verified provenance',
  'Record operator-verified scan-offset provenance.',
  'Local attestation only, no physical sample measurement.',
);
L(
  'MeasuredScanOffsetApply',
  [168],
  'MeasuredScanOffsetApply.test.tsx',
  'warns about legacy statusless',
  'Mark legacy scan-offset provenance pending without disabling its table.',
);
L(
  'MomentaryFireControl',
  '*',
  'MomentaryFireControl.test.tsx',
  'starts on press',
  'Request capped momentary Fire on press and laser-off on blur/release.',
  'Mocked Fire store action; repeated fail-off, keyboard, blur and unmount paths covered by companion executed cases.',
);
L(
  'NoHomingPositionChoices',
  '*',
  'NoHomingPositionGuide.test.tsx',
  'guides Release',
  'Confirm release and progress through the supervised hand-position workflow.',
);
L(
  'NoHomingPositionGuide',
  [226, 249],
  'NoHomingPositionGuide.test.tsx',
  'guides Release',
  'Wake and explicitly unlock before establishing the new hand-positioned origin.',
);
L(
  'OptimizationSettingsDialog',
  '*',
  'MachineDialogControls.audit.test.tsx',
  'Cut Planner edits',
  'Edit the planning draft; Apply commits it and Cancel discards without extra application.',
);
L(
  'OriginRow',
  [59, 156],
  'OriginRow.test.tsx',
  'upgrades Absolute Coordinates',
  'Request Set origin here and update local placement mode/anchor to User Origin.',
  'setOriginHere is replaced with an async no-op; only the real placement-mode/anchor mutation is established, not controller origin.',
);
L(
  'OriginRow',
  [88, 176],
  'MachineRunControls.audit.test.tsx',
  'Release motors requires',
  'Require confirmation before releasing motors; busy state remains inert.',
);
L(
  'OriginRow',
  [166, 335, 351],
  'MachineRunControls.audit.test.tsx',
  'Reset origin and Clear',
  'Reset transient origin or, after explicit confirmation, clear persistent origin through separate actions.',
);
L(
  'OriginRow',
  [175, 286],
  'OriginRow.test.tsx',
  'returns to the known work zero',
  'Request jogToMachinePosition with the known work-zero coordinates and selected feed.',
  'Exact mocked jogToMachinePosition arguments asserted; laser-off output and physical motion are not established by this case.',
);
L(
  'OriginRow',
  [342],
  'OriginRow.test.tsx',
  'confirms before setting',
  'Confirm and request persistent G54 origin.',
);
L(
  'OverrideControls',
  '*',
  'OverrideControls.test.tsx',
  'audit every',
  'Request the exact realtime byte for all 13 feed, spindle/power and rapid override buttons.',
  'Exact arguments to mocked sendRealtimeOverride asserted for every button in laser and CNC mode; no transport write or physical override response is established.',
);
L(
  'PlannerAdvanced',
  '*',
  'MachineProfileControls.audit.test.tsx',
  'advanced estimator disclosure',
  'Open and close estimator settings without mutating values.',
);
L(
  'PrintAndCutDialog',
  '*',
  'MachineDialogControls.audit.test.tsx',
  'Print and Cut captures',
  'Capture each corresponding target, apply a valid pair, disable registration or cancel independently.',
);
L(
  'ProbeControls',
  '*',
  'ProbeControls.corner-geometry.test.tsx',
  'shows the measured geometry',
  'Send typed XYZ probe request with measured corner geometry.',
  'Store action spy; physical touch-plate operation not attempted.',
);
L(
  'ProbePlateRemovalNotice',
  '*',
  'ProbePlateRemovalNotice.test.tsx',
  'keeps a visible reminder',
  'Dismiss the persistent plate-removal reminder only on explicit acknowledgement.',
);
L(
  'RotarySetupDialog',
  [48, 51, 111, 146, 153, 166],
  'MachineDialogControls.audit.test.tsx',
  'rotary type and reverse',
  'Edit rotary type, enablement and direction; Apply returns the draft and Cancel does not apply it.',
);
L(
  'RotarySetupDialog',
  [147],
  'RotarySetupDialog.test.tsx',
  'requires rotary enablement',
  'Generate a calibration pattern only for enabled valid rotary configuration.',
);
L(
  'RunAgainControl',
  '*',
  'RunAgainControl.test.tsx',
  'offers exact completed-job replay',
  'Delegate the immutable completed-job receipt once; reject stale artwork or placement offers.',
);
L(
  'SafetyNoticeBanner',
  [74],
  'SafetyNoticeBanner.test.tsx',
  'acknowledges the safety warning',
  'Acknowledge safety notice without deleting recovery checkpoint.',
);
L(
  'SafetyNoticeBanner',
  [53],
  'SafetyNoticeBanner.test.tsx',
  'offers reconnect',
  'Reconnect disconnected transport via the dedicated callback.',
);
L(
  'SafetyNoticeBanner',
  [64],
  'SafetyNoticeBanner.test.tsx',
  'labels Ctrl-X explicitly',
  'Offer controller reset only for a connected sleeping controller.',
);
L(
  'SafetyZonesPanel',
  '*',
  'MachineProfileControls.audit.test.tsx',
  'legacy safety zones',
  'Add, disable and remove exactly the chosen zone from the active device profile.',
);
L(
  'ScanOffsetEditor',
  '*',
  'DeviceSettings.test.tsx',
  'lets the operator edit calibrated',
  'Add, edit and remove scan-offset points in the active device profile.',
);
L(
  'WorkZRecoveryControl',
  [75],
  'WorkZRecoveryControl.test.tsx',
  'puts the renamed action',
  'Confirm reuse and request controller Work-Z recovery with the active bit and stock-top attestation.',
  'Rendered confirmation and exact mocked recoverWorkZFromController arguments; no physical Z-zero verification.',
  'verified-boundary',
);
L(
  'WorkZRecoveryControl',
  [64],
  'WorkZRecoveryControl.test.tsx',
  'audit setup-reuse disclosure',
  'Open and close advanced setup reuse without requesting Work-Z recovery.',
  'Real native summary clicks; recovery callback remains unused.',
);

B(
  'BoardAnchorOverlay',
  '*',
  'BoardAnchorOverlay.test.tsx',
  'renders clickable rectangle',
  'Select the exact typed board-verification target.',
);
B(
  'BoardAnchorOverlay',
  '*',
  'BoardAnchorOverlay.test.tsx',
  'renders circle center',
  'Select typed circle center/rim target; disabled targets do not dispatch.',
);
B(
  'BoardArrayForm',
  '*',
  'BoardControls.audit.test.tsx',
  'array toggles',
  'Dispatch fill or explicit grid layout with gap values; unavailable Array is inert.',
);
B(
  'BoardPlacementControls',
  '*',
  'BoardControls.audit.test.tsx',
  'rectangle placement',
  'Align to each distinct anchor, fit or array via placement actions; recapture and removal remain distinct.',
  'Rendered UI to mocked placement hook; no controller motion or geometry-output claim.',
  'verified-boundary',
);
B(
  'CircleBoardPlacementControls',
  '*',
  'BoardControls.audit.test.tsx',
  'circle placement',
  'Center artwork, recapture or remove a circle; active verification locks recapture and removal.',
  'Rendered UI to mocked placement hook; removal in live scene is separately covered by BoardCapturePanel tests.',
  'verified-boundary',
);
B(
  'BoardShapeToggle',
  '*',
  'BoardControls.audit.test.tsx',
  'shape choices',
  'Select Rectangle or Circle by typed shape, preserving operation lock.',
);
B(
  'BoardCaptureSteps',
  [45, 57, 65],
  'BoardControls.audit.test.tsx',
  'rectangle capture Undo',
  'Capture, undo or reset through distinct callbacks; session operation disables changes.',
);
B(
  'BoardCaptureSteps',
  [133],
  'BoardCapturePanel.test.tsx',
  'captures four corners',
  'Create measured rectangle geometry and set origin exactly once.',
  'Real scene mutation with mocked setOriginHere; physical board dimensions unqualified.',
);
B(
  'BoardFineJogControls',
  '*',
  'BoardControls.audit.test.tsx',
  'each fine step',
  'Set each 0.1/1/10 mm fine-jog preference without dispatching motion.',
);
B(
  'BoardVerificationControls',
  '*',
  'BoardControls.audit.test.tsx',
  'verification target',
  'Dispatch target, cancel, accept, adjustment and final correction actions at their corresponding review stages.',
  'Callback boundary tested for every action; stateful motion settling is in separately executed use-board-verification tests.',
);
B(
  'CircleCaptureSteps',
  [25, 33, 60, 68, 76, 116, 124, 132],
  'BoardControls.audit.test.tsx',
  'circle ',
  'Dispatch the method-specific capture, undo/reset and method-selection callbacks.',
);
B(
  'CircleCaptureSteps',
  [201],
  'BoardCapturePanel.test.tsx',
  'captures a circle from',
  'Create centered circular board from captured center and typed diameter.',
);
B(
  'CircleCenterConfirmation',
  [179, 197],
  'BoardCapturePanel.verification.test.tsx',
  'finds a circle center',
  'Fit a circle, move beam-off to computed center, then commit after explicit confirmation.',
  'Mocked motion/origin actions and actual scene geometry; physical alignment unqualified.',
);
B(
  'CircleCenterConfirmation',
  [225],
  'BoardCapturePanel.motion-safety.test.tsx',
  'offers a causal center-move cancel',
  'Cancel a supported center move and retain ownership until cancellation settles.',
);
B(
  'ManualSizeForm',
  '*',
  'BoardCapturePanel.test.tsx',
  'draws the board from',
  'Create a rectangle from first captured corner and validated entered dimensions.',
);

L(
  'console/ConsoleCommandDeck',
  [94],
  'ConsolePanel.test.tsx',
  'sends quick commands',
  'Send each supported quick command through the shared store action.',
);
L(
  'console/ConsoleCommandDeck',
  [138],
  'console/ConsoleCommandDeck.test.tsx',
  'clears and records only',
  'Send the entered command and clear/history-record only successful sends.',
);
L(
  'console/user-macros/UserMacroPanel',
  [85, 88, 96, 134],
  'console/ConsoleCommandDeck.test.tsx',
  'creates, edits, and deletes',
  'Create, edit, persist, or delete the selected user macro.',
);
L(
  'console/user-macros/UserMacroPanel',
  [182],
  'console/ConsoleCommandDeck.test.tsx',
  'runs a numeric macro',
  'Expand the numeric macro and send it through shared safe console history.',
);
D(
  'DeviceSetupCncPreset',
  [55],
  'DeviceSetupCncPreset.test.tsx',
  'keeps Onefinity geometry',
  'Load preset geometry into the draft without asserting firmware/output support.',
);
D(
  'DeviceSetupCncProfiles',
  [73],
  'MachineSetupDialogHost.test.tsx',
  'snapshots the draft',
  'Persist the current CNC draft as a named setup profile, leaving live project unchanged.',
);
D(
  'DeviceSetupCncProfiles',
  [47],
  'CncStartupSetupFeedback.test.tsx',
  'saved profile changes',
  'Apply saved profile to draft and commit on final Save with effective-bit feedback.',
);
D(
  'DeviceSetupCncTilingFields',
  [62],
  'DeviceSetupRegistrationFields.test.tsx',
  'configures independent values',
  'Toggle registration-hole authoring while preserving the disabled plan.',
);
D(
  'DeviceSetupConnectStep',
  [154],
  'DeviceSetupWizard.test.tsx',
  'keeps detected identity',
  'Explicitly adopt detected firmware into the setup draft.',
);
D(
  'DeviceSetupConnectStep',
  [177],
  'DeviceSetupWizard.test.tsx',
  'connects only',
  'Connect with the selected draft controller and baud rate.',
  'Mocked platform/controller connect; no serial port opened.',
);
D(
  'DeviceSetupConnectStep',
  [191],
  'DeviceSetupControls.audit.test.tsx',
  'audit read-only checks',
  'Send the selected controller identity queries and read settings without firmware or motion writes.',
  'Mocked sendConsoleCommand and readMachineSettings; exact GRBL $I and settings-read calls asserted, no serial opened.',
  'verified-boundary',
);
D(
  'DeviceSetupDetectedApply',
  '*',
  'DeviceSetupWizard.detected-values.test.tsx',
  'confirms applied values',
  'Copy detected controller values into the draft only and show confirmation.',
);
D(
  'DeviceSetupFirmwareStep',
  '*',
  'DeviceSetupWizard.test.tsx',
  'queues only confirmed',
  'Require backup and per-setting confirmation, then queue common GRBL changes for final Save.',
  'Mocked write action verifies exact final write; no actual firmware settings modified.',
);
D(
  'DeviceSetupMachineCapability',
  '*',
  'DeviceSetupWizard.test.tsx',
  'saves a hybrid machine',
  'Choose laser/CNC/hybrid capability and commit explicit active output contract.',
);
D(
  'DeviceSetupProfilePicker',
  '*',
  'DeviceSetupWizard.catalog.test.tsx',
  'keeps a selected catalog',
  'Use the exact chosen catalog profile in draft without detected-value overlay.',
);
D(
  'DeviceSetupRegistrationFields',
  '*',
  'DeviceSetupRegistrationFields.test.tsx',
  'configures independent values',
  'Create a registration plan from current CNC draft and retain distinct authoring values.',
);
D(
  'DeviceSetupRasterDiagnostics',
  '*',
  'MachineSetupRasterCalibration.test.tsx',
  'collapsed and reopened',
  'Collapse and reopen diagnostics while retaining unapplied measurements and convention.',
);
D(
  'DeviceSetupWizard',
  [180],
  'DeviceSetupWizard.navigation.test.tsx',
  'opens any setup section',
  'Navigate directly to any setup step without losing unsaved draft values.',
);
D(
  'DeviceSetupWizard',
  [209],
  'DeviceSetupWizard.test.tsx',
  'discards them on cancel',
  'Cancel setup and discard all draft changes.',
);
D(
  'DeviceSetupWizard',
  [216],
  'DeviceSetupWizard.test.tsx',
  'keeps detected identity',
  'Return to previous setup step while preserving the adopted draft controller.',
);
D(
  'DeviceSetupWizard',
  [224, 236],
  'DeviceSetupWizard.test.tsx',
  'atomically saves a laser',
  'Advance through setup and atomically save reviewed profile/workspace with one undo entry.',
);

L(
  'job-review/JobReviewCncOwnerActions',
  [23],
  'job-review/JobReviewDialog.test.tsx',
  'editable Artwork settings',
  'Leave CNC review and open the Artwork settings owner.',
);
L(
  'job-review/JobReviewCncOwnerActions',
  [24],
  'job-review/JobReviewDialog.test.tsx',
  'Startup Setup owner',
  'Leave CNC review and open Startup Setup owner.',
);
L(
  'job-review/JobReviewDialog',
  [90, 93],
  'job-review/JobReviewDialog.test.tsx',
  'routes Cancel, Start',
  'Resolve review Cancel or Confirm through the real review store signals.',
);
L(
  'job-review/JobReviewDialog',
  [146],
  'job-review/JobReviewDialog.test.tsx',
  'explicit busy-preparation retry',
  'Explicitly retry preparation without confirming or automatically replaying work.',
);
L(
  'job-review/JobReviewLayerCells',
  '*',
  'job-review/JobReviewLayersTable.test.tsx',
  'toggles air',
  'Toggle the relevant operation air flag through shared project settings.',
);
L(
  'job-review/JobReviewSettingsApproval',
  '*',
  'job-review/JobReviewSettingsApproval.test.tsx',
  'approves live-synced',
  'Approve the currently live-synced settings and re-arm after another edit.',
);
L(
  'job-review/JobReviewWarnings',
  '*',
  'job-review/JobReviewDialog.test.tsx',
  'opens the warning panel',
  'Show warnings in an open disclosure without disabling Start.',
  'Warning visibility and Start policy boundary tested; native toggle not exercised.',
  'verified-boundary',
);
L(
  'super-console/SuperConsoleDialog',
  [110],
  'super-console/SuperConsoleDialog.test.tsx',
  'hides a group',
  'Toggle transcript group filter and remove matching rows from view.',
);
L(
  'super-console/SuperConsoleDialog',
  [171],
  'super-console/SuperConsoleDialog.test.tsx',
  'timestamped TSV',
  'Copy timestamped visible TSV with manual fallback for unavailable clipboard.',
);
L(
  'super-console/SuperConsoleDialog',
  [179],
  'super-console/SuperConsoleDialog.test.tsx',
  'closes via',
  'Close Super Console through its Close button.',
);
L(
  'super-console/SuperConsoleLauncher',
  '*',
  'super-console/SuperConsoleDialog.test.tsx',
  'opens the dialog',
  'Open full Super Console from its launcher.',
);
L(
  'super-console/SuperConsoleSnapshotCompare',
  [139],
  'super-console/SuperConsoleSnapshotCompare.test.tsx',
  'exports the current',
  'Export current controller readback with operator-supplied machine label.',
);
L(
  'super-console/SuperConsoleSnapshotCompare',
  [195],
  'super-console/SuperConsoleSnapshotCompare.test.tsx',
  'loads two files',
  'Load A and B snapshots and show exact differences without claiming one is better.',
);
M(
  'AddCncBitForm',
  '*',
  'AddCncBitForm.test.tsx',
  'stores geometry and flute',
  'Validate and persist entered custom cutter geometry and flute count.',
);
M(
  'CncBitCatalogPanel',
  [166],
  'CncBitCatalogPanel.test.tsx',
  'adds a modeled bit once',
  'Add a supported modeled catalog bit exactly once with family/flute metadata.',
);
M(
  'CncBitCatalogPanel',
  [203],
  'CncToolPicture.test.tsx',
  'audit catalog manufacturer source',
  'Open and close each manufacturer-source disclosure without changing tools.',
);
M(
  'CncDetectedSettingsRow',
  '*',
  'CncDetectedSettingsRow.test.tsx',
  'applies detected spindle max',
  'Apply selected CNC controller scale/travel to the correct profile fields without rewriting stock.',
);
M(
  'CncLibraryPanels',
  '*',
  'CncLibraryPanels.test.tsx',
  'deletes the custom bit',
  'Delete the custom bit and clear only its operation assignments.',
);
M(
  'CncToolPicture',
  '*',
  'CncToolPicture.test.tsx',
  'audit picture summary',
  'Open or hide the selected tool picture while preserving project and tool state.',
);
M(
  'MachineModeToggle',
  [32, 56],
  'MachineModeToggle.hybrid.test.tsx',
  'enables both modes',
  'Switch the local project to CNC mode and restore its stored CNC contract on a hybrid profile.',
);
M(
  'MachineModeToggle',
  [24, 56],
  'MachineModeToggle.hybrid.test.tsx',
  'keeps Laser available',
  'Switch the local project to Laser mode while retaining a capability warning for a CNC-only-labelled profile.',
);
M(
  'SpindleScaleChoice',
  '*',
  'CncDetectedSettingsRow.test.tsx',
  'applies detected spindle max',
  'Explicitly choose whether detected S maximum is interpreted as spindle RPM.',
);
M(
  'SurfacingPanel',
  [77],
  'SurfacingPanel.test.tsx',
  'writes a preflighted provenance',
  'Generate and save preflighted surfacing output with provenance, safe-Z and capped feed.',
  'Real generated output bytes are checked through a mocked save adapter; OS file persistence, controller acceptance and material output are not exercised.',
);

L(
  'CollapsibleRailSection',
  '*',
  'MachineUtilityControls.audit.test.tsx',
  'rail disclosure',
  'Expand and collapse the labelled machine section while preserving the project.',
);
L(
  'DeviceSettings',
  '*',
  'MachineUtilityControls.audit.test.tsx',
  'device profile disclosure',
  'Toggle the Device Profile disclosure without changing the profile.',
);
L(
  'ExecutionArchivePanel',
  [48],
  'MachineUtilityControls.audit.test.tsx',
  'execution archive disclosure',
  'Open and close archive visibility without clearing saved runs.',
);
L(
  'MachineSettingsPanel',
  [61],
  'MachineUtilityControls.audit.test.tsx',
  'controller backup disclosure',
  'Open and close controller read/backup settings.',
);
L(
  'ProbePanel',
  [18],
  'MachineUtilityControls.audit.test.tsx',
  'probe disclosure',
  'Open and close CNC touch-plate controls without executing a probe.',
);
L(
  'StartFromLineControl',
  [20],
  'MachineUtilityControls.audit.test.tsx',
  'CNC recovery guidance disclosure',
  'Open and close CNC recovery guidance; automatic line-number restart remains unavailable.',
);
L(
  'StartFromLineControl',
  [37],
  'MachineUtilityControls.audit.test.tsx',
  'laser recovery disclosure',
  'Open and close laser recovery details without changing the project or requesting recovery.',
);
L(
  'StartFromLineControl',
  [58],
  'MachineUtilityControls.audit.test.tsx',
  'laser Resume from line',
  'Request the exact selected manual-recovery line; active-job state is inert, and CNC has no resume button.',
  'Rendered control to mocked recovery-flow function. No new ordinary Start gate or actual streamed restart.',
);
L(
  'DetectedSettingsBanner',
  [50, 59],
  'MachineUtilityControls.audit.test.tsx',
  'detected settings Apply',
  'Apply safe numeric detected settings to the local profile or dismiss only their offer.',
);
L(
  'FocusJogControls',
  [54],
  'MachineUtilityControls.audit.test.tsx',
  'Zero Z dispatches',
  'Request work-Z zero through the dedicated CNC callback, never the jog callback.',
);
L(
  'JobPlacementControls',
  [115],
  'MachineUtilityControls.audit.test.tsx',
  'all nine job-origin',
  'Persist the exact clicked anchor; disable changes while streaming.',
);
L(
  'MeasuredScanOffsetApply',
  [116, 176],
  'MachineUtilityControls.audit.test.tsx',
  'Reset measurements',
  'Restore measurement draft from saved profile or explicitly mark legacy provenance verified.',
);
D(
  'DeviceSetupControls',
  '*',
  'DeviceSetupControls.audit.test.tsx',
  'Machine Setup launcher',
  'Open globally owned Machine Setup at the capability step.',
);
D(
  'DeviceSetupCncProfiles',
  [55],
  'DeviceSetupControls.audit.test.tsx',
  'saved profile Delete',
  'Immediately delete only the selected saved setup library entry; preserve the project.',
);
D(
  'DeviceSetupCncTilingFields',
  [27],
  'DeviceSetupControls.audit.test.tsx',
  'tiling enable',
  'Enable the default indexed tiling draft or clear the optional draft value.',
);
D(
  'DeviceSetupRotaryFields',
  '*',
  'DeviceSetupControls.audit.test.tsx',
  'rotary attachment',
  'Return distinct enablement and reverse-direction rotary draft edits.',
);
D(
  'DeviceSetupConfirmStep',
  '*',
  'DeviceSetupControls.audit.test.tsx',
  'homing checkbox',
  'Update homing support in draft only; unsupported file-only controller stays disabled.',
);
D(
  'DeviceSetupIdentifyStep',
  '*',
  'DeviceSetupControls.audit.test.tsx',
  'Identify disclosures',
  'Toggle advanced/import disclosures and record worker streaming only in setup draft.',
);
D(
  'DeviceSetupOptionsStep',
  [157],
  'DeviceSetupControls.audit.test.tsx',
  'each Options disclosure',
  'Open and close each optional setup group without editing its draft.',
);
D(
  'DeviceSetupReviewStep',
  '*',
  'DeviceSetupControls.audit.test.tsx',
  'review Edit buttons',
  'Navigate each review Edit action to its exact owning setup step.',
);
D(
  'DeviceSetupCncReview',
  '*',
  'DeviceSetupControls.audit.test.tsx',
  'review Edit buttons',
  'Navigate CNC current-job Edit to the CNC setup step.',
);
D(
  'DeviceSetupCncJobStep',
  '*',
  'DeviceSetupControls.audit.test.tsx',
  'CNC material Apply',
  'Apply the selected material or explicit manual mode to the operation draft.',
);
D(
  'DeviceSetupConnectStep',
  [147, 250],
  'DeviceSetupControls.audit.test.tsx',
  'Reconnect uses',
  'Disconnect and reconnect with selected controller; toggle command-contract details independently.',
  'Mocked store connection methods and disclosure assertions; real serial picker/driver excluded.',
);
D(
  'DeviceSetupCncPreset',
  [35],
  'DeviceSetupControls.audit.test.tsx',
  'CNC preset disclosure',
  'Open and close preset details without applying a preset or changing the setup draft.',
  'Real native summary clicks; draft dispatch remains unused.',
);
D(
  'DeviceSetupCncPreset',
  [102],
  'DeviceSetupControls.audit.test.tsx',
  'CNC preset disclosure',
  'Toggle preset details and expose secure external research-source destinations.',
  'Local rendered href/target/rel checked; external site availability not exercised.',
  'verified-boundary',
);

for (const c of inventory.filter(
  (c) => c.tag === 'TutorialButton' && c.tutorialId && !c.tutorialId.startsWith('props.'),
)) {
  R(
    c.file.replace(/^src\/ui\//, '').replace(/\.tsx$/, ''),
    [c.line],
    'tutorials/TutorialControls.audit.test.tsx',
    `'${c.tutorialId}' card and contextual button`,
    `Open the ${c.tutorialId} tutorial without editing the project.`,
    'Shared real TutorialButton and TutorialHost binding exercised for this exact lesson; enclosing machine call site is source-traced, not individually clicked.',
    'verified-boundary',
  );
}
for (const id of ['machine-setup', 'cnc-probe', 'optimization', 'scan-offset', 'rotary', 'camera'])
  R(
    'laser/device-setup/DeviceSetupOptionsStep',
    [162],
    'tutorials/TutorialControls.audit.test.tsx',
    `'${id}' card and contextual button`,
    'Open the exact tutorial configured for each optional setup section.',
    'All six concrete lesson bindings source-traced; shared TutorialButton and TutorialHost executed for each lesson.',
    'verified-boundary',
  );

L(
  'CncPassRecoveryWizard',
  [112],
  'CncPassRecoveryWizard.test.tsx',
  'audit Close',
  'Close a ready recovery review without dispatching motion.',
);
L(
  'CncPassRecoveryChecklist',
  [46],
  'CncPassRecoveryWizard.test.tsx',
  'audit retained position',
  'Carry explicit retained-position selection into the reviewed recovery request.',
  'Rendered radio and mocked recovery request; real retained-position reliability is not physically qualified.',
);
L(
  'CncRecoveryPreviewWizard',
  [125, 138],
  'CncRecoveryPreviewWizard.test.tsx',
  'audit Back',
  'Return to the previous review step or close ready recovery without starting.',
);
L(
  'ConsolePanel',
  [115, 124],
  'ConsolePanel.test.tsx',
  'audit status and stream',
  'Toggle each category independently in the visible transcript without deleting original records.',
);
L(
  'JobPlacementControls',
  [76, 90],
  'MachineUtilityControls.audit.test.tsx',
  'audit selected-only',
  'Persist selected-artwork output scope and selection-origin independently.',
);
L(
  'JogPadAirAssist',
  [149],
  'MachineBoundaryControls.audit.test.tsx',
  'Cancel manual-air setup for none',
  'Dismiss missing-air-output guidance without configuring or energizing air.',
);
L(
  'JogPadAirAssist',
  [183],
  'MachineBoundaryControls.audit.test.tsx',
  'Cancel manual-air setup for M8',
  'Dismiss Job Air defaults proposal without changing layers or energizing air.',
);
L(
  'LaserWindow',
  [316, 338],
  'MachineBoundaryControls.audit.test.tsx',
  'alarm Home and explicit',
  'Dispatch alarm recovery Home or Unlock through separate store actions.',
);
L(
  'MachineSetupController',
  [130, 139],
  'MachineBoundaryControls.audit.test.tsx',
  'legacy guarded-write',
  'Confirm a single setting and send exactly its reviewed value through the legacy write action.',
  'Legacy exported panel is currently unmounted in the production setup flow (source reference search); component click to mocked write action verified.',
  'verified-boundary',
);
L(
  'MachineSetupImportExport',
  [87, 152],
  'MachineBoundaryControls.audit.test.tsx',
  'LightBurn import',
  'Parse LightBurn profile into review and apply only on explicit Apply.',
  'Mock file picker returns an in-memory .lbdev; real parser and profile store exercised.',
);
L(
  'board-capture/BoardCapturePanel',
  [220],
  'MachineBoundaryControls.audit.test.tsx',
  'board panel Close',
  'Close the idle board-capture panel without changing artwork.',
);
L(
  'console/user-macros/UserMacroPanel',
  [15, 141],
  'MachineBoundaryControls.audit.test.tsx',
  'macro Cancel',
  'Toggle macro disclosure and discard editor draft without persisting or sending a macro.',
);
D(
  'DeviceSetupCncToolPlan',
  [59],
  'DeviceSetupCncToolPlan.pictures.test.tsx',
  'audit operation disclosure',
  'Toggle operation setup details without changing assignments.',
);
L(
  'job-review/JobReviewControllerSection',
  '*',
  'job-review/JobReviewDialog.test.tsx',
  'audit Controller Machine',
  'Toggle controller evidence details without confirming review.',
);
L(
  'job-review/JobReviewMachineSection',
  '*',
  'job-review/JobReviewDialog.test.tsx',
  'audit Controller Machine',
  'Toggle machine facts without confirming review.',
);
L(
  'job-review/JobReviewWarnings',
  '*',
  'job-review/JobReviewDialog.test.tsx',
  'audit Controller Machine',
  'Open and close advisory warnings without confirming review or creating a Start policy gate.',
);
L(
  'super-console/SuperConsoleDiagnostics',
  '*',
  'MachineBoundaryControls.audit.test.tsx',
  'diagnostic category',
  'Toggle each diagnostic category without changing readback values.',
);
L(
  'super-console/SuperConsoleDialog',
  [131],
  'super-console/SuperConsoleDialog.test.tsx',
  'audit Follow latest',
  'Toggle Follow latest preference without hiding or deleting transcript records.',
  'Checkbox state binding and record preservation verified; actual scroll behavior in a layout engine is not exercised by jsdom.',
  'verified-boundary',
);
L(
  'super-console/SuperConsoleSnapshotCompare',
  [46, 202, 233],
  'super-console/SuperConsoleSnapshotCompare.test.tsx',
  'audit comparison disclosure',
  'Toggle comparison details/equivalent rows, or clear only the chosen loaded snapshot.',
);
M(
  'SurfacingPanel',
  [92],
  'SurfacingCancel.audit.test.tsx',
  'audit Cancel surfacing',
  'Abort the active uncommitted preparation and retire progress without committing a file.',
  'Real cancellation hook and AbortSignal, mocked save orchestration; OS file writer separately covered by existing save suites.',
);

// Callback-only requests remain verified-boundary. Promote only controls whose
// named cases assert their real local UI, reducer, repository or project effect.
// This never promotes a motion/firmware request merely because its spy fired.
function localBehaviour(file, lines, boundary) {
  const controls = inventory.filter(
    (c) => c.file === `src/ui/${file}.tsx` && (lines === '*' || lines.includes(c.line)),
  );
  if (!controls.length) throw new Error(`Unknown local behaviour ${file}:${lines}`);
  for (const c of controls) {
    const row = rows.find((r) => r.id === c.id);
    if (!row.evidence.length) continue;
    row.disposition = 'verified-behaviour';
    row.notes = boundary;
    for (const evidence of row.evidence) evidence.boundary = boundary;
  }
}
const localStoreBoundary =
  'Rendered clicks assert real local project/UI-store mutations or saved local data. No controller, hardware, or material qualification.';
const localUiBoundary =
  'Rendered interaction asserts the real component UI state. The case does not establish any downstream machine or external service effect.';

for (const c of inventory.filter((control) => control.kind === 'disclosure')) {
  localBehaviour(c.file.replace(/^src\/ui\//, '').replace(/\.tsx$/, ''), [c.line], localUiBoundary);
  const row = rows.find((r) => r.id === c.id);
  row.expectedOutcome =
    'Expand and collapse this named section; preserve the surrounding project and setup state.';
}
for (const [file, lines] of [
  ['CheckpointResumeBanner', [140, 150]],
  ['ConsolePanel', [92, 115, 124]],
  ['DetectedSettingsBanner', '*'],
  ['DeviceProfilePowerFields', [138]],
  ['DeviceProfileRows', [27, 63, 99]],
  ['IslandFillRecoveryAction', '*'],
  ['JobPlacementControls', '*'],
  ['JogPadAirAssist', [149, 157, 183]],
  ['LabsSettingsDialog', [51, 67]],
  ['LaserWindow', [324]],
  ['MachineSetupImportExport', [86, 87, 134, 152]],
  ['MachineSetupProfiles', '*'],
  ['MachineSetupSafetyZones', '*'],
  ['MeasuredScanOffsetApply', '*'],
  ['ProbePlateRemovalNotice', '*'],
  ['SafetyNoticeBanner', [74]],
  ['SafetyZonesPanel', '*'],
  ['ScanOffsetEditor', '*'],
  ['board-capture/BoardFineJogControls', '*'],
  ['console/user-macros/UserMacroPanel', [85, 88, 96, 134, 141]],
  ['device-setup/DeviceSetupControls', '*'],
  ['device-setup/DeviceSetupCncProfiles', '*'],
  ['device-setup/DeviceSetupCncPreset', [55]],
  ['device-setup/DeviceSetupCncTilingFields', [62]],
  ['device-setup/DeviceSetupConnectStep', [154]],
  ['device-setup/DeviceSetupDetectedApply', '*'],
  ['device-setup/DeviceSetupMachineCapability', '*'],
  ['device-setup/DeviceSetupProfilePicker', '*'],
  ['device-setup/DeviceSetupRegistrationFields', '*'],
  ['device-setup/DeviceSetupWizard', [180, 216, 224, 236]],
  ['job-review/JobReviewCncOwnerActions', '*'],
  ['job-review/JobReviewDialog', '*'],
  ['job-review/JobReviewLayerCells', '*'],
  ['super-console/SuperConsoleDialog', [110, 179]],
  ['super-console/SuperConsoleLauncher', '*'],
  ['super-console/SuperConsoleSnapshotCompare', [195, 202, 233]],
])
  localBehaviour(`laser/${file}`, lines, localStoreBoundary);
for (const [file, lines] of [
  ['AddCncBitForm', '*'],
  ['CncBitCatalogPanel', [166]],
  ['CncDetectedSettingsRow', '*'],
  ['CncLibraryPanels', '*'],
  ['MachineModeToggle', '*'],
  ['SpindleScaleChoice', '*'],
])
  localBehaviour(`machine/${file}`, lines, localStoreBoundary);
localBehaviour(
  'laser/CompletedJobNotice',
  '*',
  'Real store and simulated transport complete and archive the run; Done preserves artwork/archive/receipt and produces zero new transport writes. No hardware.',
);
localBehaviour(
  'laser/MachineSetupImportExport',
  [86, 87, 134, 152],
  'Mocked file picker supplies fixture bytes; real import parsing, review, explicit Apply and project-profile mutation are asserted. OS file selection is not exercised.',
);
localBehaviour(
  'laser/super-console/SuperConsoleSnapshotCompare',
  [195, 202, 233],
  'Mocked file picker supplies fixture snapshots; real parsing, displayed comparison, filter and selected snapshot clearing are asserted. OS file selection is not exercised.',
);
rows.find((row) => row.id === 'src/ui/machine/MachineModeToggle.tsx:56:5').expectedOutcome =
  'Switch the requested Laser/CNC local project mode, preserving the applicable stored output contract and capability warning.';
localBehaviour(
  'laser/OptimizationSettingsDialog',
  [63],
  'Real local planning checkbox state changes; Apply and Cancel remain separate mocked callback boundaries.',
);
localBehaviour(
  'laser/RotarySetupDialog',
  [48, 51, 111, 166],
  'Real local rotary type/toggle state is asserted; applying it to the parent project and generating output remain mocked callback boundaries.',
);
localBehaviour(
  'laser/CncRecoveryPreviewWizard',
  [138, 148],
  'Real wizard page transitions are asserted. The final recovery dispatcher is mocked and does not qualify execution.',
);
localBehaviour(
  'laser/CncPassRecoveryWizard',
  [120],
  'Real advanced recovery dialog opens in response to the button; no recovery dispatcher or hardware is started.',
);

const machineResults = executed.filter((test) => test.report.startsWith('control-audit-machine-'));
const testSummary = {
  uniqueLatestExecutedCases: machineResults.length,
  passed: machineResults.filter((test) => test.status === 'passed').length,
  failed: machineResults.filter((test) => test.status === 'failed').length,
  referencedPassedCases: new Set(
    rows.flatMap((row) => row.evidence.map((e) => `${e.file}:${e.test}`)),
  ).size,
  resultPolicy:
    'Latest non-skipped result per file and full case name; earlier failed fixture iterations are retained in their raw reports, never counted as passes.',
};
if (new Set(rows.map((row) => row.id)).size !== inventory.length)
  throw new Error('Baseline IDs are missing or duplicated');

if (process.argv.includes('--gaps')) {
  console.log(
    JSON.stringify(
      {
        missingEvidenceSelectors: missing,
        unverified: rows
          .filter((r) => r.disposition === 'unverified')
          .map((r) => ({ id: r.id, label: r.label })),
      },
      null,
      2,
    ),
  );
} else {
  if (missing.length) throw new Error(`Unresolved evidence selectors: ${JSON.stringify(missing)}`);
  const counts = Object.fromEntries(
    [...new Set(rows.map((r) => r.disposition))].map((d) => [
      d,
      rows.filter((r) => r.disposition === d).length,
    ]),
  );
  fs.writeFileSync(
    `${base}/control-audit-machine.json`,
    JSON.stringify(
      {
        scope: 'All 287 baseline laser, machine and calibration inventory records',
        evidenceBoundary:
          'No hardware operated. Component/store tests, simulated transport and mocked platform adapters. Baseline IDs intentionally retained after source line drift.',
        counts,
        testSummary,
        controls: rows,
      },
      null,
      2,
    ) + '\n',
  );
  const esc = (value) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
  fs.writeFileSync(
    `${base}/control-audit-machine.md`,
    `# Machine and calibration control audit\n\nAll ${rows.length} baseline records are retained. Counts: ${JSON.stringify(counts)}.\n\nExecuted machine-scope evidence: ${testSummary.passed}/${testSummary.uniqueLatestExecutedCases} unique latest cases passed; ${testSummary.failed} failed. The matrix references ${testSummary.referencedPassedCases} distinct specific cases, including shared tutorial bindings. Earlier fixture failures remain in raw reports; the latest non-skipped result takes precedence.\n\nNo real controller or material run. Callback-only requests are verified-boundary, including motion, firmware, Frame/Start dispatch and calibration callbacks. Verified-behaviour means the named assertion establishes a real local UI/store effect or explicitly simulated runtime. Neither disposition qualifies hardware. The two defect-fixed controls are the previously repaired homing/autofocus setup navigation defaults; configured autofocus still ends at a mocked request.\n\nEach evidence reference names an executed case. Contextual tutorial sites retain the shared-component boundary. Native disclosures have direct interaction coverage. Platform file dialogs, clipboard permission, external source availability and physical motion remain environmental boundaries. A source handler or nearby passing suite alone is not a behavioural pass.\n\n| Baseline ID | Label | Intended outcome | Availability | Disposition | Executed assertion and boundary |\n|---|---|---|---|---|---|\n` +
      rows
        .map(
          (r) =>
            `| ${esc(r.id)} | ${esc(r.label)} | ${esc(r.expectedOutcome)} | ${esc(JSON.stringify(r.availability))} | ${r.disposition} | ${esc(r.evidence.map((e) => `${e.file}: ${e.test} [${e.result}]`).join('; '))} ${esc(r.notes)} |`,
        )
        .join('\n') +
      '\n',
  );
  console.log(JSON.stringify({ counts, testSummary }));
}
