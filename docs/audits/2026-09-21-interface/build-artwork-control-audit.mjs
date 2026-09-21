import { readFileSync, writeFileSync } from 'node:fs';
import console from 'node:console';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Explicit baseline-to-assertion mapping. This is not a source-inventory generator.
const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '../../..');
const baseline = JSON.parse(readFileSync(resolve(directory, 'buttons.json'), 'utf8'));
const areas = ['layers', 'material-library', 'library', 'box', 'kit'];
const controls = baseline.controls.filter((item) => areas.includes(item.area));
const reportNames = [
  'artwork-existing-tests.json',
  'artwork-new-controls-initial.json',
  'artwork-new-controls-second.json',
  'artwork-final-gap-tests.json',
  'artwork-review-boundary-tests.json',
];
const tests = new Map();
for (const report of reportNames) {
  const data = JSON.parse(readFileSync(resolve(directory, report), 'utf8'));
  for (const suite of data.testResults)
    for (const test of suite.assertionResults) {
      const file = relative(root, suite.name).replaceAll('\\', '/');
      tests.set(`${file}:${test.fullName}`, {
        file,
        test: test.fullName,
        status: test.status,
        report,
      });
    }
}
function evidence(
  file,
  query,
  boundary = 'DOM click through real React handlers and actual in-memory project/UI state; no controller or physical output.',
) {
  const matches = [...tests.values()].filter(
    (item) => item.file.endsWith(file) && item.test.includes(query),
  );
  if (matches.length === 0 || matches.some((item) => item.status !== 'passed'))
    throw new Error(`Missing passing evidence: ${file}: ${query}`);
  return matches.map((item) => ({
    file: item.file,
    test: item.test,
    result: 'passed',
    boundary,
    report: `docs/audits/2026-09-21-interface/${item.report}`,
  }));
}
const rows = new Map();
function add(file, lines, expectedOutcome, availability, proof, options = {}) {
  for (const line of Array.isArray(lines) ? lines : [lines]) {
    const candidates = controls.filter((item) => item.file.endsWith(file) && item.line === line);
    if (candidates.length !== 1) throw new Error(`Not one baseline control: ${file}:${line}`);
    const control = candidates[0];
    if (rows.has(control.id)) throw new Error(`Duplicate mapping ${control.id}`);
    rows.set(control.id, {
      id: control.id,
      label: control.label || options.label || control.tag,
      expectedOutcome,
      availability,
      evidence: proof,
      disposition: options.disposition ?? 'verified-behaviour',
      notes: options.notes ?? '',
    });
  }
}
const callback =
  'Actual DOM activation and production handler; callback arguments asserted using a test spy. Parent project insertion/native execution is outside this case.';
const picker =
  'Native file picker is a stub supplying fixture content; actual parser and store mutation are exercised. No operating-system picker or disk read is claimed.';
const lessonBoundary =
  'Actual enclosing component trigger opens the named tutorial store entry and preserves project/history. Reader delivery is separately tested by the shared tutorial audit.';
const legacy = {
  disposition: 'intentionally-unavailable',
  notes:
    'Legacy standalone component has no production mount in current source. Its action is tested in isolation; current UI uses first-class artwork operations.',
};
const op = (query) => evidence('OperationControls.audit.test.tsx', query);
const flags = (query) => evidence('CutFlags.audit.test.tsx', query);
const utilities = (query, boundary) => evidence('ArtworkUtilities.audit.test.tsx', query, boundary);
const material = (query, boundary) => evidence('MaterialControls.audit.test.tsx', query, boundary);
const lessons = (query) => evidence('ContextualLessons.audit.test.tsx', query, lessonBoundary);
const saved = (query, boundary) => evidence('SavedLibrariesDialog.test.tsx', query, boundary);
const library = (query, boundary) => evidence('DesignLibraryDialog.test.tsx', query, boundary);
const browse = (query, boundary) =>
  evidence('DesignLibraryControls.audit.test.tsx', query, boundary);
const boxWorker = (query, boundary) =>
  evidence('BoxGeneratorDialog.worker.test.tsx', query, boundary);

add(
  'box/BoxFitTestDialog.tsx',
  115,
  'Cancel the fit-coupon dialog without generating parts.',
  'Open fit-test dialog.',
  evidence('BoxControls.audit.test.tsx', 'cancels the fit-test', callback),
  { disposition: 'verified-boundary' },
);
add(
  'box/BoxFitTestDialog.tsx',
  116,
  'Generate validated fit-coupon parts and persist the draft.',
  'Disabled until core validation returns generated geometry; invalid native/direct submit produces no callback.',
  evidence(
    'BoxFitTestDialog.test.tsx',
    'preserves blank CNC text',
    `${callback} Native submit validity, saved draft boundary, and generated geometry are asserted; no cut or assembly test.`,
  ),
  { disposition: 'verified-boundary' },
);
add(
  'box/BoxGenerationStatus.tsx',
  [21, 23],
  'Cancel active preview generation or retry cancelled/failed work with a new request.',
  'Cancel during pending; Retry only after cancelled or failed.',
  boxWorker(
    'cancels active preview work',
    'Manual worker fixture receives production requests; actual client/hook cancellation and retry state are asserted. No native Worker scheduling is claimed.',
  ),
  { disposition: 'verified-boundary' },
);
add(
  'box/BoxGeneratorDialog.tsx',
  87,
  'Retire pending preview work and close without inserting.',
  'Open box dialog.',
  boxWorker('dialog Cancel closes', callback),
  { disposition: 'verified-boundary' },
);
add(
  'box/BoxGeneratorDialog.tsx',
  88,
  'Deliver the current validated six-panel geometry to insertion callback.',
  'Disabled until the current draft has matching generated geometry.',
  boxWorker(
    'enables Generate only after',
    'Manual worker fixture executes production box geometry; generated callback matches direct geometry. Workspace insertion/material fit is not claimed.',
  ),
  { disposition: 'verified-boundary' },
);
add(
  'box/BoxGeneratorPreview.tsx',
  [18, 21],
  'Switch Flat/Assembled preview and update the exclusive pressed state.',
  'Both views available in the open box dialog, including pending/no snapshot.',
  evidence('BoxControls.audit.test.tsx', 'changes from Flat'),
  {
    notes:
      'Additional existing worker case verifies an assembled canvas for generated geometry; no visual or physical fit claim.',
  },
);

add(
  'kit/Button.tsx',
  35,
  'Dispatch enabled action; suppress disabled action; default to non-submit.',
  'Reusable native button, availability controlled by caller.',
  evidence('KitControls.audit.test.tsx', 'dispatches enabled', callback),
  { disposition: 'verified-boundary' },
);
add(
  'kit/IconButton.tsx',
  32,
  'Dispatch labelled icon action; suppress it when disabled; never implicitly submit.',
  'Reusable native icon button, availability controlled by caller.',
  evidence('KitControls.audit.test.tsx', 'dispatches enabled', callback),
  { disposition: 'verified-boundary' },
);
add(
  'kit/Dialog.tsx',
  52,
  'Open contextual tutorial without closing, submitting, or resetting the draft.',
  'Dialog supplies tutorialId.',
  evidence(
    'kit/Dialog.test.tsx',
    'opens the contextual lesson',
    'Actual tutorial store target and retained form draft asserted; submit/close spies remain untouched. Project/history invariance is not asserted in this case.',
  ),
);
add(
  'kit/RailSection.tsx',
  22,
  'Toggle the section disclosure open and closed.',
  'Section mounted; native details/summary.',
  evidence('KitControls.audit.test.tsx', 'opens and closes a disclosure'),
);
add(
  'kit/RailSection.tsx',
  29,
  'Open the lesson supplied by the section.',
  'tutorialId supplied; route inside disclosed section.',
  evidence(
    'KitControls.audit.test.tsx',
    'opens and closes a disclosure',
    'Actual details disclosure and named tutorial store target asserted. Reader content is tested by the shared tutorial audit.',
  ),
);

add(
  'layers/AddLayerControls.tsx',
  33,
  'Create a manual layer with chosen colour and make it active.',
  'No current production mount; standalone legacy form.',
  op('creates and assigns through'),
  legacy,
);
add(
  'layers/AssignSelectionButton.tsx',
  10,
  'Assign selected artwork to the target operation.',
  'No current production mount; disabled with no selection.',
  op('creates and assigns through'),
  legacy,
);
add(
  'layers/LayerSubLayers.tsx',
  [60, 88, 102, 110],
  'Add, enable/disable, edit, or delete the targeted legacy sub-layer while preserving primary settings.',
  'No current production mount; legacy sub-layer list.',
  op('adds disables edits and deletes'),
  legacy,
);
add(
  'layers/ArtworkRunOrderRow.tsx',
  48,
  'Focus and select the clicked run unit.',
  'Visible run row.',
  evidence('ArtworkRunOrderPanel.test.tsx', 'focuses a run unit and moves'),
);
add(
  'layers/ArtworkRunOrderRow.tsx',
  59,
  'Label the numeric run input and stop row-selection propagation.',
  'Run row label; not a separate action button.',
  [
    {
      file: 'src/ui/layers/ArtworkRunOrderRow.tsx',
      test: 'Source inspection: label around RunPositionInput only calls stopPropagation',
      result: 'inspected',
      boundary:
        'Inventory false positive; numeric-input editing is outside the baseline button record.',
    },
  ],
  { disposition: 'not-action-control' },
);
add(
  'layers/ArtworkRunOrderRow.tsx',
  [69, 119],
  'Select the run artwork through the focusable native button.',
  'Visible run row; selected state reflected with aria-pressed.',
  utilities('jumps to a numbered run'),
);
add(
  'layers/ArtworkRunOrderRow.tsx',
  97,
  'Select the row artwork and switch to its Settings panel.',
  'Visible run row.',
  utilities('jumps to a numbered run'),
);
add(
  'layers/ArtworkRunOrderToolbar.tsx',
  [41, 49, 57],
  'Undo the latest number assignment, commit Done once, or Cancel to the original order.',
  'Canvas numbering active; Undo disabled until an assignment exists.',
  evidence('ArtworkRunOrderPanel.test.tsx', 'undoes within numbering'),
);
add(
  'layers/ArtworkRunOrderToolbar.tsx',
  84,
  'Open the operations/run-order lesson.',
  'At least one run unit and numbering idle.',
  lessons('opens the run order lesson'),
);
add(
  'layers/ArtworkRunOrderToolbar.tsx',
  95,
  'Start one undoable canvas numbering interaction at position one.',
  'Run-order panel with run units, numbering idle.',
  evidence('ArtworkRunOrderPanel.test.tsx', 'virtualizes a 50-job list'),
);
add(
  'layers/ArtworkRunOrderToolbar.tsx',
  119,
  'Reveal and select the requested run number, clearing search.',
  'Numbering idle; a valid existing run is required to act.',
  utilities('jumps to a numbered run'),
);
add(
  'layers/CncFeedPresetRows.tsx',
  52,
  'Create a saved CNC feeds preset with the entered name.',
  'CNC feed helpers; disabled for blank/whitespace name.',
  evidence('CncFeedPresetRows.test.tsx', 'shows an honest empty state'),
);
add(
  'layers/CncLayerFields.tsx',
  59,
  'Open the lesson corresponding to the current CNC cut type.',
  'CNC operation inspector.',
  lessons('cut type lesson'),
);
add(
  'layers/CncLayerFields.tsx',
  141,
  'Switch V-carve from flowing depth to an explicit flat floor.',
  'V-carve operation only.',
  evidence('CncLayerFields.clarity.test.tsx', 'defaults new V-carves'),
);
add(
  'layers/CncLayerFields.tsx',
  189,
  'Set exact cut depth to measured Startup stock thickness.',
  'Profile/inlay depth field; explicit operator action.',
  evidence('CncLayerFields.test.tsx', 'stock-thickness button sets exact'),
);
add(
  'layers/CncLayerToolFields.tsx',
  146,
  'Enable helix entry, clearing ramp entry while preserving the Startup roughing tool.',
  'Pocket operation.',
  evidence('CncLayerFields.test.tsx', 'enables pocket helical entry'),
);
add(
  'layers/CncProfileLeadFields.tsx',
  69,
  'Remove custom lead radius/length so the resolved cutter radius applies.',
  'Inside/outside profile with leads enabled and explicit radius present.',
  flags('removes custom profile lead radius'),
);
add(
  'layers/CncRetractPassesField.tsx',
  24,
  'Store retract-between-passes off/on for applicable cuts.',
  'Cuts whose pass motion uses this setting; hidden for pocket.',
  flags('removes custom profile lead radius'),
);
add(
  'layers/CncTabFields.tsx',
  20,
  'Toggle holding tabs and disarm only the matching editor when disabled.',
  'Profile/inlay tab settings.',
  evidence('CncLayerFields.tabs.test.tsx', 'disables the matching editor'),
);
add(
  'layers/CncTabFields.tsx',
  30,
  'Open the CNC holding-tabs lesson.',
  'Tab fields visible.',
  lessons('opens the holding tabs lesson'),
);
add(
  'layers/CncTabPositionControls.tsx',
  [44, 62],
  'Seed editable tab anchors and enter canvas tab mode, or reset anchors to automatic and leave edit mode.',
  'Tabs enabled; Edit requires one editable matching profile object; reset route when manual positions exist.',
  evidence('CncLayerFields.test.tsx', 'seeds editable tab handles'),
);
add(
  'layers/CutSettingsCommonFields.tsx',
  [60, 69, 133, 166],
  'Stage visible/output and line bridge enable/skip-hole flags, committing only on OK.',
  'Advanced dialog; membership only when editable, bridge fields only Line.',
  flags('commits every line advanced checkbox'),
);
add(
  'layers/CutSettingsDefaultActions.tsx',
  [12, 19, 26],
  'Save the colour default, reset the stored operation to it, or save a global default without applying unrelated draft edits.',
  'Advanced settings with all three default handlers; absent for selected-object override editing.',
  flags('makes color and global defaults'),
);
add(
  'layers/CutSettingsDialog.tsx',
  77,
  'Cancel the dialog without committing staged edits.',
  'Open advanced cut settings.',
  evidence('CutsLayersPanel.cut-settings.test.tsx', 'cancels staged settings'),
);
add(
  'layers/CutSettingsDialog.tsx',
  78,
  'Commit staged settings to the owning operation and close.',
  'Valid advanced cut-settings form.',
  evidence('CutsLayersPanel.cut-settings.test.tsx', 'stages advanced settings'),
);
add(
  'layers/CutSettingsDialog.tsx',
  173,
  'Open the lesson for the draft operation mode while preserving unsaved fields.',
  'Open advanced dialog.',
  evidence(
    'CutSettingsDialog.tutorial.test.tsx',
    'opens help for the draft',
    'Actual lesson target, retained draft mode/power and Escape focus return asserted. Apply/Cancel are callback spies verified untouched; project/history invariance is not asserted in this case.',
  ),
);
add(
  'layers/CutSettingsFillFields.tsx',
  [60, 70, 110],
  'Stage fill bidirectional, cross-hatch and explicit uncalibrated-bidirectional override flags, committing on OK.',
  'Fill details only.',
  flags('commits every fill advanced checkbox'),
);
add(
  'layers/CutSettingsImageFields.tsx',
  205,
  'Stage each generated image checkbox: negative, bidirectional, expert override and pass-through; commit on OK.',
  'Image details only; generic renderer instantiated for each named flag.',
  flags('commits every image advanced checkbox'),
);
for (const line of [61, 85])
  add(
    'layers/CutsLayersPanel.tsx',
    line,
    'Group and label the current panel content or tab list.',
    'Layout/accessibility container; not independently activated.',
    [
      {
        file: 'src/ui/layers/CutsLayersPanel.tsx',
        test: 'Source inspection: role=tabpanel or role=tablist div has no action handler',
        result: 'inspected',
        boundary: 'Source-inventory false positive.',
      },
    ],
    { disposition: 'not-action-control' },
  );
add(
  'layers/CutsLayersPanel.tsx',
  124,
  'Select Run order or Materials and expose the corresponding panel.',
  'Materials only Laser; Settings and Run order in both modes.',
  [
    ...evidence('CutsLayersPanel.tabs.test.tsx', 'keeps material management'),
    ...evidence('CutsLayersPanel.tabs.test.tsx', 'opens the numeric run-order'),
    ...utilities('jumps to a numbered run'),
  ],
  {
    notes:
      'The shared tab definition is exercised through Materials and Run order. Return to Settings is asserted through Edit settings; the Settings-tab dynamic instance is source-inspected, not separately clicked in these cases.',
  },
);
add(
  'layers/DeleteLayerButton.tsx',
  7,
  'Delete the operation and only artwork orphaned by that removal; support Undo.',
  'Operation management disclosure.',
  op('deletes only the chosen'),
);
add(
  'layers/DogboneRow.tsx',
  41,
  'Open the dogbone lesson.',
  'CNC and eligible closed unlocked vector selection.',
  lessons('opens the offset and dogbone'),
);
add(
  'layers/DogboneRow.tsx',
  53,
  'Relieve eligible selected corners in place with the chosen cutter diameter and preserve Undo.',
  'CNC and eligible closed unlocked vector selection.',
  utilities('relieves CNC square corners in place'),
);
add(
  'layers/FeedsCalculatorRow.tsx',
  73,
  'Apply the calculated machine-aware feed/plunge/depth recipe with provenance.',
  'CNC feed calculator with a valid applicable recipe; disabled when not applicable.',
  evidence('FeedsCalculatorRow.test.tsx', 'applies the central 4040-aware', callback),
  {
    disposition: 'verified-boundary',
    notes:
      'Recipe callback fields are asserted; emitted CNC toolpaths and physical chip load are outside this case.',
  },
);
add(
  'layers/LayerImageFields.tsx',
  300,
  'Toggle negative engraving on the selected operation.',
  'Image process in the selection inspector.',
  flags('inline toggle').filter((item) => item.test.includes('Negative image')),
);
add(
  'layers/LayerImageFields.tsx',
  319,
  'Toggle bidirectional raster scanning on the selected operation.',
  'Image process in the selection inspector.',
  flags('inline toggle').filter((item) => item.test.includes('Bidirectional image scan')),
);
add(
  'layers/LayerImageFields.tsx',
  338,
  'Toggle pass-through raster processing on the selected operation.',
  'Image process in the selection inspector.',
  flags('inline toggle').filter((item) => item.test.includes('Pass-through image')),
);
add(
  'layers/LayerOrderControls.tsx',
  [26, 36],
  'Move the targeted operation one place up/down; guard the first/last endpoint.',
  'Operation management disclosure; disabled at the corresponding end.',
  op('moves both directions'),
);
add(
  'layers/LayerRow.tsx',
  [43, 66, 79, 89],
  'Toggle card visibility, expand/collapse management, or independently change Show/Output.',
  'Operation card; management contains the secondary checkbox controls.',
  op('changes card visibility'),
);
add(
  'layers/LayerRow.tsx',
  100,
  'Select all artwork intentionally sharing the operation.',
  'Operation management disclosure.',
  evidence('CutsLayersPanel.test.tsx', 'selects all artwork intentionally'),
);
add(
  'layers/LayerRow.tsx',
  102,
  'Delete this operation and artwork with no other operation.',
  'Operation management disclosure.',
  op('deletes only the chosen'),
);
add(
  'layers/LayerRow.tsx',
  117,
  'Make the operation the active drawing operation and expose the active cue.',
  'Visible operation card.',
  evidence('LayerRow.accessibility.test.tsx', 'uses a native keyboard-operable'),
);
add(
  'layers/LayerRowFields.tsx',
  145,
  'Toggle selected operation bidirectional fill.',
  'Fill process in selected operation fields or reused operation settings.',
  flags('inline toggle').filter((item) => item.test.includes('Bidirectional fill')),
);
add(
  'layers/LayerSettingsClipboardButtons.tsx',
  [10, 18],
  'Copy current operation settings and paste them to the target while retaining target identity.',
  'Management disclosure; Paste disabled until the settings clipboard exists.',
  op('moves both directions'),
);
add(
  'layers/MaterialLibraryPanel.tsx',
  53,
  'Create a blank library named for the active device.',
  'No active library.',
  evidence('MaterialLibraryPanel.test.tsx', 'creates a blank device-scoped'),
);
add(
  'layers/MaterialLibraryPanel.tsx',
  61,
  'Create the active machine catalogue starter library.',
  'No active library and a starter catalogue exists for the profile.',
  evidence('MaterialLibraryPanel.test.tsx', 'creates a starter material'),
);
add(
  'layers/MaterialLibraryPanel.tsx',
  157,
  'Copy the current linked preset revision onto its operation and update revision truth.',
  'Linked binding exists; disabled when its source preset/library is missing.',
  evidence('MaterialLibraryPanel.management.test.tsx', 'surfaces stale linked revision'),
);
add(
  'layers/MaterialLibraryPanel.tsx',
  235,
  'Open the materials lesson.',
  'Material Library panel in Laser mode.',
  lessons('opens the material library lesson'),
);
add(
  'layers/MaterialLibraryPanel.tsx',
  237,
  'Open Saved Libraries from the material panel header.',
  'Material Library panel in Laser mode.',
  material('opens saved libraries'),
  {
    notes:
      'Shared SavedLibrariesButton is mounted directly in the case; this exact parent call site is source-inspected. The real dialog/state path is exercised.',
  },
);
add(
  'layers/MaterialLibraryRecipeControls.tsx',
  25,
  'Apply the selected preset snapshot to the target layer without creating a live link.',
  'A target layer and preset exist; unsupported recipe remains available with warning.',
  evidence('MaterialLibraryPanel.test.tsx', 'assigns a selected preset'),
);
add(
  'layers/MaterialLibraryRecipeControls.tsx',
  35,
  'Apply and link the selected preset with library/preset/revision identity.',
  'A target layer and preset exist.',
  material('links the selected preset'),
);
add(
  'layers/MaterialLibraryRecipeControls.tsx',
  45,
  'Delete only the selected preset after confirmation; cancellation retains it.',
  'Preset exists; no layer needed.',
  [
    ...evidence('MaterialLibraryPanel.management.test.tsx', 'deletes a selected'),
    ...evidence('MaterialLibraryPanel.management.test.tsx', 'keeps a selected'),
  ],
  { notes: 'window.confirm is stubbed for both outcomes; actual library mutation is asserted.' },
);
add(
  'layers/OffsetPathsRow.tsx',
  33,
  'Open the offset-path lesson.',
  'Eligible closed unlocked vector selection.',
  lessons('opens the offset and dogbone'),
);
add(
  'layers/OffsetPathsRow.tsx',
  45,
  'Create an outward offset copy while preserving its source.',
  'Eligible closed unlocked vector selection; positive distance.',
  utilities('creates the Outward'),
);
add(
  'layers/OffsetPathsRow.tsx',
  52,
  'Create an inward offset copy while preserving its source.',
  'Eligible closed unlocked vector selection; positive distance.',
  utilities('creates the Inward'),
);
add(
  'layers/SelectLayerObjectsButton.tsx',
  7,
  'Select every artwork sharing the operation.',
  'Operation management disclosure.',
  evidence('CutsLayersPanel.test.tsx', 'selects all artwork intentionally'),
);
add(
  'layers/SelectedImageAdjustments.tsx',
  [15, 52],
  'Open Image Studio with the selected raster as the session owner.',
  'A single selected raster.',
  utilities(
    'opens Image Studio',
    'Actual button, editor lifecycle and owned session; raster pixel decoder stub supplies a small buffer. Browser image decoding and editor rendering are separately tested.',
  ),
  { disposition: 'verified-boundary' },
);
add(
  'layers/SelectedLaserOperationFields.tsx',
  16,
  'Open the lesson for the selected laser process.',
  'Laser operation inspector; mixed mode routes to operations.',
  lessons('process lesson'),
);
add(
  'layers/SelectedLaserOperationFields.tsx',
  67,
  'Toggle stored job air intent for this operation.',
  'Laser operation inspector.',
  evidence('CutsLayersPanel.cut-settings.test.tsx', 'updates job air assist'),
  { notes: 'Only operation state; no live air output or controller command is claimed.' },
);
add(
  'layers/SelectedLaserOperationFields.tsx',
  76,
  'Open the staged advanced cut-settings dialog.',
  'Laser operation inspector; disabled while settings launcher is blocked by an interaction.',
  evidence('CutsLayersPanel.cut-settings.test.tsx', 'stages advanced settings'),
);
add(
  'layers/SelectedOperationInspector.tsx',
  51,
  'Assign the chosen common operation to every selected artwork.',
  'Multi-selection has no common operation.',
  evidence('CutsLayersPanel.test.tsx', 'offers and applies one unified'),
);
add(
  'layers/SelectedOperationInspector.tsx',
  180,
  'Give selected members a unique operation while preserving unselected members.',
  'Operation also affects unselected artwork.',
  evidence('CutsLayersPanel.test.tsx', 'makes one member'),
);
add(
  'layers/SelectedOperationInspector.tsx',
  188,
  'Add a first-class extra operation to selected artwork.',
  'Selected artwork with an operation.',
  evidence('CutsLayersPanel.test.tsx', 'adds a second first-class'),
);
add(
  'layers/SelectedOperationInspector.tsx',
  [207, 217],
  'Toggle Show and Output on the inspector operation without changing another operation.',
  'Operation inspector.',
  op('changes selected inspector'),
);
add(
  'layers/SelectedReliefProperties.tsx',
  38,
  'Open the relief lesson.',
  'CNC and exactly one relief selected.',
  lessons('opens the selected relief'),
);
add(
  'layers/SelectedReliefProperties.tsx',
  67,
  'Open the actual 3D relief viewer; report worker/rendering unavailability clearly.',
  'CNC and exactly one relief selected.',
  utilities(
    'opens the actual relief viewer',
    'Actual viewer dialog and unavailable-worker fallback in jsdom; 3D rendering needs browser Worker/WebGL and is not qualified by this case.',
  ),
  { disposition: 'verified-boundary' },
);
add(
  'layers/SelectedSourceReimportControl.tsx',
  20,
  'Replace only the selected source-aware SVG/DXF object, retaining identity.',
  'Platform exists and one imported SVG/DXF without library provenance is supplied.',
  utilities('reimports selected SVG', picker),
  {
    disposition: 'verified-boundary',
    notes:
      'SVG successful button path exercised. DXF path and asynchronous ownership races require the separate app import suite; this row does not claim every format was clicked.',
  },
);
add(
  'layers/SetupOwnedValueRow.tsx',
  19,
  'Disclose who owns a read-only Startup value.',
  'Setup reference row.',
  evidence('SetupOwnedValueRow.test.tsx', 'explains a read-only value'),
);
add(
  'layers/SetupOwnedValueRow.tsx',
  38,
  'Close the explanation without editing setup/project state.',
  'Explanation open.',
  op('closes the setup explanation'),
);
add(
  'layers/SetupOwnedValueRow.tsx',
  45,
  'Close explanation and request the exact Startup Setup field.',
  'Explanation open.',
  evidence('SetupOwnedValueRow.test.tsx', 'explains a read-only value'),
  { notes: 'Setup dialog store request asserted. Native hardware settings are not written.' },
);

add(
  'library/DesignLibraryControls.tsx',
  [50, 57, 77],
  'Filter by the selected populated collection or restore All designs.',
  'Open Design Library; collection with entries.',
  browse('filters a collection'),
);
add(
  'library/DesignLibraryControls.tsx',
  115,
  'Clear the search query and restore matching results.',
  'Search query nonempty.',
  browse('filters a collection'),
);
add(
  'library/DesignLibraryControls.tsx',
  124,
  'Expand/collapse the filter controls.',
  'Open Design Library.',
  browse('filters a collection'),
);
add(
  'library/DesignLibraryControls.tsx',
  198,
  'Reset all collection/query/facet filters.',
  'Filter panel expanded.',
  browse('filters a collection'),
);
add(
  'library/DesignLibraryDetails.tsx',
  [43, 122],
  'Return focus to the selected design card without inserting artwork.',
  'A detail entry is selected; back route visible in narrow layout.',
  browse(
    'returns focus from details',
    'Actual DOM focus/navigation handler; jsdom scrollIntoView stub records request, so real scrolling/layout is not claimed.',
  ),
);
add(
  'library/DesignLibraryDetails.tsx',
  79,
  'Insert the exact selected design with provenance and close on success.',
  'Detail selected; disabled while any add is in flight.',
  library('selects a card without inserting'),
);
add(
  'library/DesignLibraryDetails.tsx',
  [158, 163],
  'Open the exact source or license URL in a new tab.',
  'Web platform and URL present; links intentionally omitted on Electron.',
  [
    ...browse(
      'exposes exact source and license',
      'Actual native anchor href/target/rel verified; external site navigation is intentionally not performed.',
    ),
    ...library(
      'keeps exact provenance URLs',
      'Electron platform flag fixture verifies text remains and links are absent.',
    ),
  ],
  { disposition: 'verified-boundary' },
);
add(
  'library/DesignLibraryDialog.tsx',
  62,
  'Close the Library and retire pending insertion ownership.',
  'Open Design Library.',
  library('after Close button closes'),
);
add(
  'library/DesignLibraryGrid.tsx',
  51,
  'Show exact design details without inserting.',
  'Visible design card.',
  library('selects a card without inserting'),
);
add(
  'library/DesignLibraryGrid.tsx',
  74,
  'Insert the exact visible card design via its separate quick action.',
  'Visible design card; disabled during insertion.',
  library('adds the exact visible design'),
);
add(
  'library/DesignLibraryGrid.tsx',
  101,
  'Clear an empty-result query/filter and restore results.',
  'No matching designs.',
  library('recovers through Clear filters'),
);

add(
  'material-library/SavedLibrariesButton.tsx',
  12,
  'Open the actual Saved Libraries modal.',
  'Reusable materials header entry point.',
  material('opens saved libraries'),
);
add(
  'material-library/SavedLibrariesDialog.tsx',
  56,
  'Create and activate a new blank device-named library.',
  'Open Saved Libraries modal.',
  material('opens saved libraries'),
);
add(
  'material-library/SavedLibrariesDialog.tsx',
  64,
  'Import selected native library content into the saved collection.',
  'Open Saved Libraries modal; picker cancellation leaves state intact.',
  saved('imports a library from a file', picker),
  { disposition: 'verified-boundary' },
);
add(
  'material-library/SavedLibrariesDialog.tsx',
  [73, 113],
  'Import CLB content and convert its units into a stored preset library.',
  'Open Saved Libraries modal.',
  material('imports CLB', picker),
  { disposition: 'verified-boundary' },
);
add(
  'material-library/SavedLibrariesDialog.tsx',
  101,
  'Close Saved Libraries modal.',
  'Open Saved Libraries modal.',
  material('opens saved libraries'),
);
add(
  'material-library/SavedLibraryRow.tsx',
  [71, 119],
  'Enter rename editing and save the new library name.',
  'Saved library row; Save appears only while renaming.',
  saved('renames a library inline'),
);
add(
  'material-library/SavedLibraryRow.tsx',
  79,
  'Cancel rename and retain the original library name.',
  'Rename row open.',
  material('opens saved libraries'),
);
add(
  'material-library/SavedLibraryRow.tsx',
  110,
  'Activate the selected saved library and close management.',
  'Inactive saved library; active library Open disabled.',
  [...saved('opens an inactive library'), ...material('opens saved libraries')],
);
add(
  'material-library/SavedLibraryRow.tsx',
  126,
  'Duplicate the selected library under a new identity without changing the active library.',
  'Saved library row.',
  saved('duplicates a library'),
);
add(
  'material-library/SavedLibraryRow.tsx',
  133,
  'Serialize the chosen library to the selected save target.',
  'Saved library row.',
  saved(
    'exports the active library',
    'Actual serializer and write payload are asserted through a stub SaveTarget. OS save dialog, filesystem durability, and inactive-library export are outside this case.',
  ),
  { disposition: 'verified-boundary' },
);
add(
  'material-library/SavedLibraryRow.tsx',
  140,
  'Delete the chosen library only after confirmation.',
  'Saved library row.',
  [...saved('deletes a library after'), ...saved('keeps a library when')],
  { notes: 'Confirmation is stubbed for both outcomes; collection mutation is real.' },
);
add(
  'material-library/wizard/MaterialPresetWizard.tsx',
  84,
  'Open the materials lesson without committing the wizard.',
  'Open create/edit wizard.',
  lessons('opens the material library lesson'),
);
add(
  'material-library/wizard/MaterialPresetWizard.tsx',
  98,
  'Return to the previous step while retaining parsed settings/details; leave the saved library untouched.',
  'Step two through four.',
  [
    ...material('preserves settings and detail edits'),
    ...evidence('MaterialPresetWizard.back-boundary.test.tsx', 'normalizes invalid numeric drafts'),
  ],
  {
    disposition: 'defect-fixed',
    notes:
      'Initial case failed (Power67 returned as30). Back now captures current settings/details before changing steps; regression retains valid power, air, tabs and final saved recipe. Invalid numeric text uses the existing Next normalization: out-of-range power clamps, blank speed restores its prior value; Cancel preserves the exact saved preset. Initial failure recorded in artwork-new-controls-initial.json.',
  },
);
add(
  'material-library/wizard/MaterialPresetWizard.tsx',
  100,
  'Cancel editing and keep the original saved recipe unchanged.',
  'Open wizard.',
  material('launches New and Edit'),
);
add(
  'material-library/wizard/MaterialPresetWizard.tsx',
  101,
  'Advance valid steps and save one recipe only on final Save.',
  'Next disabled until identity valid; native form validity applies.',
  [
    ...material('launches New and Edit'),
    ...evidence('MaterialPresetWizard.test.tsx', 'keeps the Next button disabled'),
  ],
);
add(
  'material-library/wizard/MaterialPresetWizardLauncher.tsx',
  [19, 29],
  'Open a new draft or populate an edit draft from the selected preset.',
  'New with active library; Edit disabled without selected preset.',
  material('launches New and Edit'),
);
add(
  'material-library/wizard/WizardCutSettingsStep.tsx',
  48,
  'Stage recipe air intent and retain it in the saved preset.',
  'Wizard settings step.',
  material('launches New and Edit'),
);
add(
  'material-library/wizard/WizardDetailsStep.tsx',
  [61, 91],
  'Stage bridge enable/skip-hole flags and save them with the preset.',
  'Wizard details for Line mode.',
  material('launches New and Edit'),
);
add(
  'material-library/wizard/WizardIdentityStep.tsx',
  [53, 64],
  'Select thickness or surface grouping, show the matching field, and save only that identity kind.',
  'Wizard identity step.',
  material('launches New and Edit'),
);

// Shared scenarios exercise several neighboring actions. Give each baseline record
// its own expected result rather than describing only the enclosing scenario.
function outcomes(file, byLine) {
  for (const [line, expectedOutcome] of Object.entries(byLine)) {
    const control = controls.find((item) => item.file.endsWith(file) && item.line === Number(line));
    if (!control || !rows.has(control.id))
      throw new Error(`Outcome target missing ${file}:${line}`);
    rows.get(control.id).expectedOutcome = expectedOutcome;
  }
}
outcomes('box/BoxGenerationStatus.tsx', {
  21: 'Cancel the active preview request and leave Generate disabled.',
  23: 'Retry a cancelled/failed preview with a new request ID.',
});
outcomes('box/BoxGeneratorPreview.tsx', {
  18: 'Select the Flat preview and clear Assembled pressed state.',
  21: 'Select the Assembled preview and clear Flat pressed state.',
});
outcomes('layers/LayerSubLayers.tsx', {
  60: 'Add an enabled sub-layer to the target operation.',
  88: 'Toggle the sub-layer output-enabled flag.',
  102: 'Open the targeted sub-layer settings; OK updates only its settings.',
  110: 'Delete only the targeted sub-layer.',
});
outcomes('layers/ArtworkRunOrderToolbar.tsx', {
  41: 'Undo the latest canvas number assignment within the active interaction.',
  49: 'Finish numbering and commit its order changes as one undoable step.',
  57: 'Cancel numbering and restore its original artwork order.',
});
outcomes('layers/CncTabPositionControls.tsx', {
  44: 'Seed saved tab anchors and enter canvas tab-position editing for the target operation.',
  62: 'Remove saved manual tab anchors and return to automatic placement and Select mode.',
});
outcomes('layers/CutSettingsCommonFields.tsx', {
  60: 'Stage workspace visibility and commit it only on OK.',
  69: 'Stage output inclusion and commit it only on OK.',
  133: 'Stage enabled line-cut bridges and commit only on OK.',
  166: 'Stage skipping bridges on inner contours and commit only on OK.',
});
outcomes('layers/CutSettingsDefaultActions.tsx', {
  12: 'Save current stored operation settings as this colour default without applying staged edits.',
  19: 'Reset the stored operation and open form to its saved colour default.',
  26: 'Save current stored operation settings as the default for all colours.',
});
outcomes('layers/CutSettingsFillFields.tsx', {
  60: 'Stage alternating bidirectional fill scanning and commit on OK.',
  70: 'Stage a perpendicular cross-hatch fill pass and commit on OK.',
  110: 'Stage the explicit uncalibrated bidirectional override and commit on OK.',
});
outcomes('layers/LayerOrderControls.tsx', {
  26: 'Move the targeted operation one place up; disable at the first position.',
  36: 'Move the targeted operation one place down; disable at the final position.',
});
outcomes('layers/LayerRow.tsx', {
  43: 'Toggle this operation workspace visibility from the card eye button.',
  66: 'Expand/collapse the operation management disclosure.',
  79: 'Set this operation workspace visibility from the Show checkbox.',
  89: 'Set this operation output inclusion independently from visibility.',
});
outcomes('layers/LayerSettingsClipboardButtons.tsx', {
  10: 'Copy this operation settings into the internal settings clipboard.',
  18: 'Paste settings onto this operation while retaining its identity; disable without a clipboard.',
});
outcomes('layers/SelectedOperationInspector.tsx', {
  207: 'Set the inspected operation workspace visibility independently from other operations.',
  217: 'Set the inspected operation output inclusion independently from other operations.',
});
outcomes('library/DesignLibraryControls.tsx', {
  50: 'Select All designs and remove the category restriction.',
  57: 'Select this populated collection and display its matching designs.',
  77: 'Activate the named collection filter through the shared native collection button.',
});
outcomes('library/DesignLibraryDetails.tsx', {
  158: 'Expose the selected asset source URL as a native new-tab link.',
  163: 'Expose the selected asset license URL as a native new-tab link.',
});
outcomes('material-library/SavedLibraryRow.tsx', {
  71: 'Save the typed nonempty library name and leave rename mode.',
  119: 'Enter inline rename mode seeded with the current library name.',
});
outcomes('material-library/wizard/MaterialPresetWizardLauncher.tsx', {
  19: 'Open a new empty preset draft.',
  29: 'Open the selected preset identity and recipe for editing; disable with no selection.',
});
outcomes('material-library/wizard/WizardDetailsStep.tsx', {
  61: 'Stage line bridges enabled and persist that intent on final Save.',
  91: 'Stage skipping bridge gaps on inner shapes and persist it on final Save.',
});
outcomes('material-library/wizard/WizardIdentityStep.tsx', {
  53: 'Select thickness grouping and reveal the retained thickness input.',
  64: 'Select surface grouping, reveal retained title, and save title without thickness.',
});

const missing = controls.filter((item) => !rows.has(item.id));
if (missing.length || rows.size !== controls.length)
  throw new Error(`Mapping incomplete: ${missing.map((item) => item.id).join(', ')}`);
for (const row of rows.values())
  if (row.evidence.length === 0) throw new Error(`Empty evidence ${row.id}`);
const ordered = controls.map((item) => rows.get(item.id));
const counts = Object.fromEntries(
  [...new Set(ordered.map((item) => item.disposition))]
    .sort()
    .map((disposition) => [
      disposition,
      ordered.filter((item) => item.disposition === disposition).length,
    ]),
);
const result = {
  metadata: {
    date: '2026-09-21',
    scope: areas,
    baseline: 'buttons.json',
    baselineHead: baseline.metadata.sourceHead,
    count: ordered.length,
    counts,
    limitations: [
      'Rows cover baseline source definitions and call sites; parameterized controls list exercised instances and do not claim every runtime state or instance was clicked.',
      'Per-control assertions are local software evidence. They do not establish controller, laser/spindle/air, material, or hardware behavior.',
      'Callback/picker/worker/decoder/WebGL boundaries are described individually; verified-boundary is not an end-to-end native claim.',
      'Legacy unmounted components and non-action inventory containers are counted explicitly, not silently reported as working UI controls.',
    ],
  },
  controls: ordered,
};
writeFileSync(
  resolve(directory, 'control-audit-artwork.json'),
  JSON.stringify(result, null, 2) + '\n',
);
const escape = (value) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
const summary = `# Artwork control audit — 21 September 2026\n\n${ordered.length} baseline records audited individually across layers, materials, Design Library, box generation, and shared kit controls.\n\n${Object.entries(
  counts,
)
  .map(([name, count]) => `- ${name}: ${count}`)
  .join(
    '\n',
  )}\n\nThe confirmed defect was Material Preset Wizard Back losing unsaved settings/details. Its regression failed before the fix and passes after Back captures the current recipe draft.\n\nEvery test reference below resolves to a passed assertion in the named JSON execution artifact. Source-only non-actions have a separate disposition. Native file dialogs, external navigation, worker scheduling, image decoding, WebGL, controller output and physical results are not inferred from stubs. Legacy controls with no current production mount are explicitly unavailable.\n\n| Baseline ID / label | Expected outcome | Availability | Evidence (specific case / boundary) | Disposition / notes |\n| --- | --- | --- | --- | --- |\n`;
writeFileSync(
  resolve(directory, 'control-audit-artwork.md'),
  summary +
    ordered
      .map(
        (row) =>
          `| ${escape(row.id)}<br>${escape(row.label)} | ${escape(row.expectedOutcome)} | ${escape(row.availability)} | ${row.evidence.map((item) => `${escape(item.file)} — ${escape(item.test)}: ${escape(item.result)}. ${escape(item.boundary)}${item.report ? ` [execution](${item.report.split('/').at(-1)})` : ''}`).join('<br>')} | ${escape(row.disposition)}. ${escape(row.notes)} |`,
      )
      .join('\n') +
    '\n',
);
console.log(JSON.stringify({ count: ordered.length, counts }));
