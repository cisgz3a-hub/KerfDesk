import fs from 'node:fs';
import console from 'node:console';

const base = 'docs/audits/2026-09-21-interface';
const source = JSON.parse(fs.readFileSync(`${base}/buttons.json`, 'utf8'));
const inventory = source.controls.filter((c) =>
  ['app', 'commands', 'common', 'workspace', 'tutorials'].includes(c.area),
);
const reports = fs
  .readdirSync(base)
  .filter((name) =>
    /^control-audit-(shell|menu|tutorial-pane|workspace).*vitest\.json$/.test(name),
  );
const executed = reports.flatMap((report) =>
  JSON.parse(fs.readFileSync(`${base}/${report}`, 'utf8')).testResults.flatMap((suite) =>
    suite.assertionResults.map((test) => ({
      ...test,
      file: `src/${suite.name.replaceAll('\\', '/').split('/src/').at(-1)}`,
      report,
    })),
  ),
);
const rows = inventory.map((c) => ({
  id: c.id,
  label: c.label || c.tag,
  expectedOutcome: '',
  availability: { disabledWhen: c.disabled, enclosingConditions: c.visibilityConditions },
  handlerTrace: c.handlers,
  evidence: [],
  disposition: 'unverified',
  notes: '',
}));
const B =
  'Verified UI-to-callback or browser-adapter boundary; the external/native effect was not exercised.';
const S = 'Rendered control and real application state were exercised with disposable test state.';
function R(
  file,
  lines,
  testFile,
  match,
  outcome,
  boundary = S,
  disposition = 'verified-behaviour',
) {
  const controls = inventory.filter(
    (c) => c.file === `src/ui/${file}.tsx` && (lines === '*' || lines.includes(c.line)),
  );
  if (controls.length === 0) throw new Error(`Missing baseline control ${file}:${lines}`);
  const tests = executed.filter(
    (t) =>
      t.file === `src/ui/${testFile}.tsx` &&
      t.status === 'passed' &&
      (match instanceof RegExp ? match.test(t.title) : t.title.includes(match)),
  );
  if (tests.length === 0) throw new Error(`No executed passing case ${testFile}: ${match}`);
  for (const c of controls) {
    const row = rows.find((r) => r.id === c.id);
    row.expectedOutcome = outcome;
    row.disposition = disposition;
    row.notes = boundary;
    row.evidence.push(
      ...tests.map((t) => ({
        file: t.file,
        test: t.fullName,
        result: 'passed',
        boundary,
        report: `${base}/${t.report}`,
      })),
    );
  }
}
const G = (file, lines, match, outcome, boundary, disposition) =>
  R(file, lines, 'app/interface-control-outcomes.test', match, outcome, boundary, disposition);
const W = (file, lines, match, outcome, boundary, disposition) =>
  R(
    `workspace/${file}`,
    lines,
    'workspace/WorkspaceButtons.audit.test',
    match,
    outcome,
    boundary,
    disposition,
  );
const E = (file, lines, match, outcome, boundary, disposition) =>
  R(file, lines, `${file}.test`, match, outcome, boundary, disposition);
const T = (file, lines, match, outcome) =>
  R(`tutorials/${file}`, lines, 'tutorials/TutorialControls.audit.test', match, outcome);

E(
  'app/AutosaveRecoveryBanner',
  [11],
  'restores only on request',
  'Restore the offered project and request a dirty backup write before clearing the recovery source.',
  'Real project restoration; persistence service is mocked and write-before-clear ordering asserted. Durable storage itself is not established.',
  'verified-boundary',
);
E(
  'app/AutosaveRecoveryBanner',
  [14],
  'hides the choice',
  'Hide the recovery offer without requesting deletion or rewriting of the backup.',
  'Real banner state; mocked persistence service receives no write/clear calls.',
  'verified-boundary',
);
E(
  'app/DesktopCloseNotice',
  [16],
  'Keep app open',
  'Cancel the pending close request and retain the app.',
  B,
  'verified-boundary',
);
G(
  'app/DesktopCloseNotice',
  [18],
  'Retry Abort',
  'Retry the failed stop request and resolve ready only after the mocked stop completes.',
  B,
  'verified-boundary',
);
E(
  'app/DesktopCloseNotice',
  [21],
  'explicit acknowledgement',
  'Acknowledge the unconfirmed-stop warning and resolve the close handshake, retaining the warning until acknowledgement.',
  B,
  'verified-boundary',
);
G(
  'app/ExternalGcodePreviewBanner',
  '*',
  'Show project toolpath',
  'Remove only the imported G-code display and retain project, preview mode and undo.',
);
G(
  'app/GcodeSaveDialog',
  [58],
  'G-code Cancel',
  'Close without choosing or writing an export destination.',
);
E(
  'app/GcodeSaveDialog',
  [59],
  'does not select a destination',
  'Prepare complete executable bytes before enabling destination selection and write them through the selected adapter.',
  B,
  'verified-boundary',
);
E(
  'app/ProjectBedReconciliationBanner',
  [23],
  'Use project machine retains',
  'Retain the opened device and machine profile; clear disclosure without changing artwork.',
);
E(
  'app/ProjectBedReconciliationBanner',
  [26],
  'Keep current machine retains',
  'Restore the previous device, bed and machine profile; clear disclosure without changing opened artwork.',
);
E(
  'app/WorkspaceSidePanels',
  [190],
  /uses one tabbed|restores a collapsed panel/,
  'Select or restore the requested compact panel; keyboard navigation changes the panel without editing artwork.',
);
E(
  'app/WorkspaceSidePanels',
  [216],
  /reclaims compact width|independently collapsible/,
  'Collapse/restore the requested panel and reclaim its occupied space.',
);

R(
  'commands/AppMenuBar',
  [80, 131],
  'commands/AppMenuBar.control-audit.test',
  'clicks through the menu',
  'Open the chosen family and dispatch each of the 91 registered commands to its independently specified callback, guard, arguments, lesson or URL; close after dispatch.',
  'All 91 registered command clicks are covered. Callback dispatch does not itself qualify the downstream algorithm or device effect.',
  'verified-boundary',
);
R(
  'commands/AppMenuBar',
  [156],
  'tutorials/TutorialHost.test',
  'disabled command lesson',
  'Open the named lesson for an unavailable command without executing the command; preserve a stable menu focus return target.',
);
G(
  'commands/ArrayDialog',
  [53, 59, 83, 97],
  'Grid and Circular',
  'Switch grid/circular mode and submit the independently entered count, dimensions, angle and rotate-copies flag.',
  'Rendered dialog to parsed-options callback; geometry generation is separate.',
  'verified-boundary',
);
E(
  'commands/ArrayDialog',
  [54],
  'point rotation count',
  'Select point rotation and submit count plus signed total angle.',
  B,
  'verified-boundary',
);
E(
  'commands/ArrayDialog',
  [82],
  'cancels without',
  'Cancel without submitting an array.',
  B,
  'verified-boundary',
);
G(
  'commands/ArrayDialogFields',
  '*',
  'Grid and Circular',
  'Carry the rotate-copies checkbox into circular array options.',
  B,
  'verified-boundary',
);
G(
  'commands/CloseOpenFillContoursDialog',
  [68],
  'contour repair Cancel',
  'Cancel without applying repairs or changing artwork.',
  B,
  'verified-boundary',
);
E(
  'commands/CloseOpenFillContoursDialog',
  [69],
  'applies only after confirmation',
  'Preview tolerance repair counts and apply only after explicit confirmation.',
  B,
  'verified-boundary',
);
G(
  'commands/CloseOpenFillContoursDialog',
  [69],
  'contour repair Cancel',
  'Apply is inert for an ineligible selection; eligible submission is separately exercised.',
  B,
  'verified-boundary',
);
R(
  'commands/CommandTutorialButton',
  '*',
  'tutorials/TutorialHost.test',
  'disabled command lesson',
  'Open the command lesson without running the unavailable command and restore menu focus.',
);
R(
  'commands/NumericEditsBar',
  [151],
  'workspace/WorkspaceButtons.audit.test',
  'aspect lock',
  'Toggle the aspect lock; width changes proportionally rescale height when locked.',
);
G(
  'commands/ProjectNotesDialog',
  [30],
  'Project Notes Cancel',
  'Discard the note draft without applying it.',
  B,
  'verified-boundary',
);
E(
  'commands/ProjectNotesDialog',
  [33],
  'submits the new text',
  'Submit the edited notes text.',
  B,
  'verified-boundary',
);
G(
  'commands/QuickNestDialog',
  '*',
  'Quick Nest Outline',
  'Select Outline/Fast and optional 90-degree rotation; submit chosen settings or cancel without applying.',
  'Rendered parsed-options callback. Nesting geometry itself is not established by this dialog test.',
  'verified-boundary',
);
R(
  'commands/QuickNestDialog',
  [62, 85],
  'commands/QuickNestDialog.test',
  'explicit method choice',
  'Choose Fast then submit explicit method, spacing and rotation options.',
  B,
  'verified-boundary',
);
R(
  'commands/TransformAnchorPicker',
  '*',
  'commands/NumericEditsBar.test',
  /keyboard and navigates all nine|stores the selected anchor/,
  'Open the nine-position anchor picker; commit the selected anchor and return focus.',
);
E(
  'commands/UndoHistoryDialog',
  [25, 28],
  'runs undo and redo',
  'Dispatch Undo or Redo exactly once.',
  B,
  'verified-boundary',
);
G(
  'commands/UndoHistoryDialog',
  [25, 28, 31],
  'Undo History Close',
  'Keep empty Undo/Redo inert and dispatch Close exactly once.',
  B,
  'verified-boundary',
);
E(
  'commands/WorkspaceContextBar',
  [51, 89],
  'runs enabled quick-bar',
  'Dispatch the selected quick action and close the floating menu.',
  B,
  'verified-boundary',
);
E(
  'commands/WorkspaceContextBar',
  [54, 75],
  'runs a More action',
  'Open More, invoke the selected submenu action once and close both levels.',
  B,
  'verified-boundary',
);

G(
  'common/CollapsibleRail',
  '*',
  'rail collapse and expand',
  'Collapse/expand the requested rail and open its configured contextual lesson.',
);
E(
  'common/ConfirmSaveDialog',
  [30],
  'clicking Save resolves',
  'Resolve the pending choice as save and close the dialog.',
);
E(
  'common/ConfirmSaveDialog',
  [33],
  "clicking Don't Save resolves",
  'Resolve the pending choice as discard and close the dialog.',
);
E(
  'common/ConfirmSaveDialog',
  [34],
  'clicking Cancel resolves',
  'Resolve the pending choice as cancel and close the dialog.',
);
E(
  'common/DesktopPreviewUpdateButton',
  '*',
  'fixed official page',
  'Link the announced newer Preview to the fixed official download page.',
  'Anchor URL and presentation checked; download/install was not attempted.',
  'verified-boundary',
);
E(
  'common/DownloadDesktopLink',
  '*',
  'public release repository',
  'Open the configured public release page in a new tab.',
  'Anchor target inspected; actual remote download was not attempted.',
  'verified-boundary',
);
E(
  'common/ErrorBoundary',
  [106],
  'working ABORT',
  'Invoke the supplied software Abort action when motion is live.',
  'Crash UI invokes a mocked Abort; controller response and physical stopping are not established.',
  'verified-boundary',
);
G(
  'common/ErrorBoundary',
  [116],
  'Copy diagnostic',
  'Copy the local diagnostic payload and show Copied.',
  'Clipboard API mocked; payload independently asserted.',
  'verified-boundary',
);
G(
  'common/ErrorBoundary',
  [123],
  'Try again remounts',
  'Remount recovered child content after a rendering error.',
);
E(
  'common/InstallButton',
  '*',
  'prompts the browser',
  'Invoke the deferred browser install prompt once, then hide this prompt button.',
  'Browser beforeinstallprompt and prompt adapter mocked; installation not attempted.',
  'verified-boundary',
);
E(
  'common/PwaUpdateButton',
  '*',
  'staged callback on click',
  'Invoke the staged update callback; the updater owns subsequent safe application.',
  'Staged callback mocked; service-worker takeover/relaunch not exercised.',
  'verified-boundary',
);
E(
  'common/SaveFilenamePanel',
  [48],
  'keeps the filename editable',
  'Resolve the queued save-name request with the edited filename and close.',
);
E(
  'common/SaveFilenamePanel',
  [51],
  'queues overlapping',
  'Cancel only the active queued filename request with null.',
);
G(
  'common/ShortcutsDialog',
  '*',
  'Keyboard Shortcuts Close',
  'Close the shortcuts dialog and release modal ownership.',
);
R(
  'common/StatusBar',
  [64],
  'common/DesktopPreviewUpdateButton.test',
  'fixed official page',
  'Mount the shared Preview update link in the status rail.',
  'Shared component URL evidence and inspected mounting; no native update run.',
  'verified-boundary',
);
E(
  'common/StatusBar',
  [65],
  'hosts the Update button',
  'Expose the staged update action in the fixed status rail.',
  'Status mounting verified; shared PwaUpdateButton callback evidence applies.',
  'verified-boundary',
);
R(
  'common/Toasts',
  '*',
  'common/Toasts.placement.test',
  'dismisses without submitting',
  'Dismiss the selected notification without submitting its enclosing form.',
);
R(
  'common/Toolbar',
  [30],
  'tutorials/TutorialHost.test',
  'ordinary menu command',
  'Open the shared Learn library.',
  'Shared tutorial host tested and Toolbar TutorialButton binding inspected; this exact Learn opener was not clicked in this case.',
  'verified-boundary',
);
E('common/Toolbar', [32], 'opens the Keyboard Shortcuts', 'Open the keyboard shortcuts dialog.');
R(
  'common/Toolbar',
  [42],
  'common/InstallButton.test',
  'prompts the browser',
  'Mount the deferred install action only when the browser offers it.',
  'Shared component click and Toolbar mounting tested; browser installation not attempted.',
  'verified-boundary',
);
R(
  'common/ToolbarCommands',
  [19, 151],
  'common/Toolbar.test',
  'runs toolbar clicks',
  'Dispatch visible toolbar actions through their registered command object.',
  B,
  'verified-boundary',
);
R(
  'common/ToolbarCommands',
  [59, 125],
  'common/Toolbar.overflow.test',
  /keeps extra commands reachable|supports keyboard opening/,
  'Open More, skip disabled entries, dispatch the chosen command and restore focus on dismissal.',
  B,
  'verified-boundary',
);
E(
  'common/WorkspaceLayoutSelect',
  '*',
  'saves and restores the chosen',
  'Open layout choices and persist the explicitly chosen layout without changing preferences during navigation.',
);

T(
  'TutorialButton',
  '*',
  'card and contextual button',
  'Every one of the 93 shipped contextual lesson IDs opens its named content and leaves project/history unchanged.',
);
R(
  'tutorials/TutorialExample',
  [62],
  'tutorials/TutorialPhoto.test',
  'switch views afterwards',
  'Switch picture/diagram and allow a failed picture to retry.',
);
T(
  'TutorialExample',
  [100, 110],
  'example stage selection',
  'Select the requested animation stage; play/pause and stop at Result.',
);
T('TutorialHost', [33], 'learning brand', 'Return from a lesson to the library.');
T(
  'TutorialHost',
  [42],
  'card and contextual button',
  'Close the lesson dialog and release modal ownership.',
);
R(
  'tutorials/TutorialLibrary',
  [56, 92],
  'tutorials/TutorialHost.test',
  'combines search',
  'Filter by category; Show all clears search, category and machine filters.',
);
T(
  'TutorialLibrary',
  [118],
  'learning brand',
  'Open the first-project lesson from the library shortcut.',
);
T(
  'TutorialLibrary',
  [143],
  'card and contextual button',
  'Every one of the 93 shipped library cards opens the named lesson.',
);
R(
  'tutorials/TutorialReader',
  [114, 178, 188, 197, 207],
  'tutorials/TutorialHost.test',
  'navigates, restarts and records',
  'Return to library, step Back/Next, finish with persisted completion, and restart at step zero.',
);
T(
  'TutorialReader',
  [154, 226],
  'step-list and related-lesson',
  'Select the clicked step or related lesson rather than retaining the previous content.',
);

R(
  'workspace/Cnc3DFullPage',
  '*',
  'workspace/Cnc3DPane.controls.test',
  'Open full page and Close',
  'Close full-page 3D while retaining the docked scene and releasing modal ownership.',
  'Real pane and modal state with mocked WebGL scene hook.',
  'verified-boundary',
);
R(
  'workspace/Cnc3DPane',
  [47],
  'workspace/Cnc3DPane.controls.test',
  'resize handle',
  'Resize with arrow keys and pointer drag, respecting width bounds and persisting it.',
);
R(
  'workspace/Cnc3DPane',
  [110],
  'workspace/Cnc3DPane.controls.test',
  'Open full page and Close',
  'Open the full-page 3D view while retaining the docked pane.',
  'Real modal with mocked WebGL scene hook.',
  'verified-boundary',
);
R(
  'workspace/Cnc3DPaneToggle',
  '*',
  'workspace/Cnc3DPane.controls.test',
  'Collapse and Expand',
  'Persist the explicit collapse/expand choice without changing artwork.',
);
E(
  'workspace/CncStockCanvasHud',
  [44],
  'expands into read-only',
  'Expand or collapse stock reference facts without editing the project.',
);
E(
  'workspace/CncStockCanvasHud',
  [87],
  'exact Startup Setup',
  'Open the stock editor in Startup Setup without changing the project.',
);
R(
  'workspace/RegistrationJigArtworkSizeFields',
  '*',
  'workspace/RegistrationJigArtworkSizeControls.test',
  'aspect ratio is unlocked',
  'Unlock aspect ratio, edit each dimension independently, and apply exact size to every artwork copy.',
);
W(
  'RegistrationJigOperationSettings',
  '*',
  'air assist updates',
  'Update the outline operation air flag or open the actual outline Cut Settings dialog.',
);
R(
  'workspace/RegistrationJigOutlineControls',
  [92],
  'workspace/RegistrationJigPanel.test',
  /creates five jigs|Replace outline applies/,
  'Create the requested grid of outlines or replace existing outline dimensions while preserving artwork.',
);
W(
  'RegistrationJigOutlineControls',
  [104],
  'Remove outline',
  'Remove the outlines while preserving artwork.',
);
R(
  'workspace/RegistrationJigOutlineFields',
  [111],
  'workspace/RegistrationJigPanel.test',
  'locks the box',
  'Toggle outline locking; captured-board geometry remains locked.',
);
W(
  'RegistrationJigOutlineFields',
  [135],
  'Remove outline',
  'Remove the selected registration outline set while preserving artwork.',
);
E(
  'workspace/RegistrationJigPanel',
  [63],
  /header is dragged|arrow keys/,
  'Move the floating panel through pointer drag or focused arrow keys.',
);
W(
  'RegistrationJigPanel',
  [74, 75],
  'Remove outline',
  'Open the registration lesson; Close hides only the panel.',
);
E(
  'workspace/RegistrationJigPanel',
  [86, 332, 340],
  'creates five jigs',
  'Fit and copy selected artwork to each jig; switch the entire set between outline-only and artwork-only output.',
);
E(
  'workspace/RegistrationJigPanel',
  [356],
  'How to use collapsed',
  'Expand/collapse the written how-to instructions.',
);
E(
  'workspace/ToolStrip',
  [47],
  'teaches the selected',
  'Open the lesson corresponding to the selected tool without changing tool or artwork.',
);
W(
  'ToolStrip',
  [62],
  'selects exactly its tool mode',
  'All ten tool buttons activate exactly their named mode and expose pressed state without changing artwork.',
);
E('workspace/ToolStrip', [80], 'opens the design library', 'Open the design library.');
W('ToolStrip', [90], 'Open Design Studio', 'Open a resumable Design Studio session.');
W(
  'ToolStrip',
  [144],
  'Smooth updates',
  'Align selected incoming/outgoing handles with opposite directions and preserve undo.',
);
W(
  'ToolStrip',
  [149],
  'Corner updates',
  'Align selected handles to their adjoining chords and preserve undo.',
);
W(
  'ToolStrip',
  [150, 156],
  'Curve and Line',
  'Convert the outgoing segment to cubic/line; already-matching types are disabled after reselecting the node.',
);
W(
  'ToolStrip',
  [162, 168],
  'Start reorders',
  'Reorder a closed path to the selected start node or break it open there, with undo and correct availability.',
);
E(
  'workspace/ToolStrip',
  [174],
  /Join available|unsupported interior anchors/,
  'Close the selected open curve endpoints with undo and return focus to Edit nodes; unsupported interior selections retain geometry and receive a warning.',
);
W(
  'ToolStrip',
  [194],
  /Smooth updates|Curve and Line|Start reorders/,
  'Shared node-action button dispatches real undoable geometry operations.',
);
E(
  'workspace/overlays',
  [46],
  'toggles workspace snapping',
  'Toggle snapping in workspace preferences.',
);
W(
  'overlays',
  [57, 66, 81, 99],
  'Zoom in/out',
  'Zoom in/out or reset to bed view without editing the project; percentage supports keyboard activation.',
);
W('overlays', [90], 'Fit to selection', 'Zoom and pan to the actual selected artwork.');
E(
  'workspace/overlays',
  [116],
  'persists the hidden state',
  'Toggle frame/job-start markers and persist the explicit choice.',
);
W(
  'preview-overlays',
  [111, 158, 161],
  'preview travel toggle',
  'Toggle travel display, open the Preview tutorial, or request the 3D preview without modifying route data.',
  'Real preview state and tutorial store; 3D opener is a callback boundary.',
  'verified-boundary',
);
W(
  'preview-overlays',
  [212, 239, 289, 302],
  'Play, Pause, Restart',
  'Play/pause, restart and jump to previous/next passes using the actual route scrubber state.',
);

for (const id of [
  'src/ui/app/WorkspaceSidePanels.tsx:45:9',
  'src/ui/app/WorkspaceSidePanels.tsx:104:5',
  'src/ui/commands/ArrayDialog.tsx:52:7',
  'src/ui/workspace/WorkspaceCanvasLayers.tsx:41:7',
]) {
  const row = rows.find((r) => r.id === id);
  row.disposition = 'not-action-control';
  row.expectedOutcome =
    id.includes('canvas') || id.includes('Canvas')
      ? 'Canvas gesture surface, not a button; drawing gestures are outside this control inventory.'
      : 'Semantic panel/tab-list container, not an independently actionable control.';
  row.notes =
    'Inventory scanner includes semantic/gesture surfaces; source reviewed to avoid counting them as passed buttons.';
}
const missing = rows.filter((r) => r.disposition === 'unverified');
if (missing.length) throw new Error(`Unmapped: ${missing.map((r) => r.id).join(', ')}`);
const counts = Object.fromEntries(
  [...new Set(rows.map((r) => r.disposition))].map((s) => [
    s,
    rows.filter((r) => r.disposition === s).length,
  ]),
);
fs.writeFileSync(
  `${base}/control-audit-shell.json`,
  JSON.stringify(
    {
      baselineInventoryMetadata: source.metadata,
      scope: '138 app, command-shell, common, tutorial and workspace control definitions/calls',
      counts,
      controls: rows,
    },
    null,
    2,
  ) + '\n',
);
const esc = (s) => String(s).replaceAll('|', '\\|').replaceAll('\n', ' ');
fs.writeFileSync(
  `${base}/control-audit-shell.md`,
  '# Shell and workspace control outcomes\n\nEach row refers to a baseline source definition or call, not every dynamic instance. Exact executed cases and adapter boundaries are recorded in [JSON](control-audit-shell.json). No hardware or native installation was performed.\n\n| Control | Expected outcome | Disposition | Evidence |\n| --- | --- | --- | --- |\n' +
    rows
      .map(
        (r) =>
          `| ${esc(r.id)} · ${esc(r.label)} | ${esc(r.expectedOutcome)} | ${r.disposition} | ${r.evidence.map((e) => esc(`${e.file}: ${e.test}`)).join('<br>')} |`,
      )
      .join('\n') +
    '\n',
);
console.log(JSON.stringify({ controls: rows.length, counts }));
