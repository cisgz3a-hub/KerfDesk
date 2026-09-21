import fs from 'node:fs';
import console from 'node:console';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

const dir = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(dir, '../../..');
const baseline = JSON.parse(fs.readFileSync(path.join(dir, 'buttons.json'), 'utf8'));
const areas = [
  'camera',
  'cnc-viewer3d',
  'design-studio',
  'gcode-inspector',
  'image-editor',
  'raster',
  'relief-viewer',
  'text',
  'trace',
];
const controls = baseline.controls.filter((row) => areas.includes(row.area));
const latest = new Map();
for (const report of fs.readdirSync(dir).filter((file) => file.endsWith('.json'))) {
  const result = JSON.parse(fs.readFileSync(path.join(dir, report), 'utf8'));
  for (const suite of result.testResults ?? [])
    for (const test of suite.assertionResults ?? []) {
      if (['pending', 'skipped', 'todo'].includes(test.status)) continue;
      const file = suite.name.replaceAll('\\', '/').replace(/^.*\/src\//, 'src/');
      const evidence = {
        file,
        test: test.fullName ?? test.title,
        result: test.status,
        report,
        time: suite.endTime ?? result.startTime,
      };
      const key = `${file}::${evidence.test}`;
      if (!latest.has(key) || latest.get(key).time <= evidence.time) latest.set(key, evidence);
    }
}
const evidenceIndex = [...latest.values()];
const defs = new Map();
const rows = new Map();
const B = 'verified-boundary';
const V = 'verified-behaviour';
const D = 'defect-fixed';
const dom =
  'Actual rendered React control, native click/change/pointer event and real local store or draft; jsdom canvas drawing is stubbed. No hardware.';
function def(key, file, contains, boundary = dom) {
  defs.set(key, { file: `src/ui/${file}`, contains, boundary });
}
function evidence(key) {
  const d = defs.get(key);
  if (!d) throw new Error(`Unknown evidence ${key}`);
  const cases = evidenceIndex.filter(
    (item) => item.file === d.file && item.test.includes(d.contains),
  );
  if (!cases.length || cases.some((item) => item.result !== 'passed'))
    throw new Error(`No current passing evidence: ${key}: ${JSON.stringify(cases)}`);
  return cases.map(({ file, test, result, report }) => ({
    file,
    test,
    result,
    report,
    boundary: d.boundary,
  }));
}
function map(
  file,
  lineOutcomes,
  keys,
  disposition = V,
  availability = 'Available while its containing view is open.',
  notes = '',
) {
  for (const [line, expectedOutcome] of Object.entries(lineOutcomes)) {
    const c = controls.find((item) => item.file === `src/ui/${file}` && item.line === Number(line));
    if (!c) throw new Error(`Missing baseline ${file}:${line}`);
    if (rows.has(c.id)) throw new Error(`Duplicate ${c.id}`);
    rows.set(c.id, {
      id: c.id,
      area: c.area,
      label: c.label || c.tag,
      expectedOutcome,
      availability,
      evidence: keys.flatMap(evidence),
      disposition,
      notes,
    });
  }
}

def('image.tools', 'image-editor/EditorControls.audit.test.tsx', 'arms every displayed tool');
def('image.colours', 'image-editor/EditorControls.audit.test.tsx', 'opens both colour pickers');
def('image.swatches', 'image-editor/EditorControls.audit.test.tsx', 'chooses each paint swatch');
def(
  'image.gradient',
  'image-editor/EditorControls.audit.test.tsx',
  'switches both gradient shapes',
);
def('image.crop', 'image-editor/EditorControls.audit.test.tsx', 'disables empty crop actions');
def('image.selection', 'image-editor/EditorControls.audit.test.tsx', 'sets all selection modes');
def('image.layerstack', 'image-editor/EditorLayers.audit.test.tsx', 'gates stack-edge actions');
def('image.layerselect', 'image-editor/EditorLayers.audit.test.tsx', 'selects paint layers');
def('image.history', 'image-editor/EditorLayers.audit.test.tsx', 'jumps backward and forward');
def('image.adjustments', 'image-editor/EditorDialogs.audit.test.tsx', 'menu routes');
def('image.menus', 'image-editor/EditorDialogs.audit.test.tsx', 'Image menu routes');
def('image.preview', 'image-editor/EditorDialogs.audit.test.tsx', 'adjustment Preview');
def('image.resize', 'image-editor/EditorDialogs.audit.test.tsx', 'resizes pixels with aspect lock');
def('image.modify', 'image-editor/EditorDialogs.audit.test.tsx', 'all five Modify');
def(
  'image.text',
  'image-editor/EditorDialogs.audit.test.tsx',
  'text Cancel',
  'Rendered Text dialog; fake glyph rasterizer returns a known pixel buffer; real layer commit and cancellation checked. Typeface rasterization is outside this case.',
);
def(
  'image.topbar',
  'image-editor/EditorDialogs.audit.test.tsx',
  'top bar dispatches',
  'Rendered top bar with action callback spies. Verifies routing and enabled states, not the application/image-encoding implementation behind those callbacks.',
);
for (const action of ['Reset', 'Cancel', 'OK'])
  def(
    `image.adjust.${action}`,
    'image-editor/AdjustDialog.test.tsx',
    `native Enter activation of ${action}`,
  );
def(
  'image.resize.cancel',
  'image-editor/ImageStudioAccessibility.test.tsx',
  'production Resize Cancel button',
);
def(
  'image.pad.keys',
  'image-editor/ImageStudioAccessibility.test.tsx',
  'color pad keyboard control',
);
def(
  'image.menu.keyboard',
  'image-editor/EditorAdjustMenus.test.tsx',
  'opens at either end with arrow keys',
);
def(
  'image.menu.transform',
  'image-editor/EditorAdjustMenus.test.tsx',
  'cannot run during an unfinished transform',
);
def(
  'image.kerf',
  'image-editor/KerfStatus.test.tsx',
  'offers Thicken only',
  'Rendered control availability and callback to applyThicken checked against a reversible-target fixture. This case does not qualify the physical kerf correction.',
);
def('image.canvas', 'image-editor/EditorGestures.audit.test.tsx', 'document canvas draws');
def('image.curve', 'image-editor/EditorGestures.audit.test.tsx', 'curve canvas adds');
def('image.pad', 'image-editor/EditorGestures.audit.test.tsx', 'colour pad maps');

map(
  'image-editor/EditorToolStrip.tsx',
  { 72: 'Select each of the 13 displayed image tools and announce only the active tool.' },
  ['image.tools'],
);
map(
  'image-editor/EditorToolStrip.tsx',
  {
    102: 'Open the background picker; Cancel leaves the colour intact.',
    109: 'Open the foreground picker and commit the chosen colour.',
    118: 'Swap foreground and background colours.',
    126: 'Restore black foreground and white background.',
  },
  ['image.colours'],
);
map(
  'image-editor/ColorPickerDialog.tsx',
  {
    106: 'Close without committing the colour draft.',
    114: 'Commit the colour and close the picker.',
  },
  ['image.colours'],
);
map(
  'image-editor/ColorPickerPad.tsx',
  {
    22: 'Map pointer position to saturation/brightness, clamp outside drags, and support keyboard adjustment.',
  },
  ['image.pad', 'image.pad.keys'],
);
map(
  'image-editor/CurvesEditor.tsx',
  {
    75: 'Add, move and remove curve control points in the adjustment draft without committing image pixels.',
  },
  ['image.curve'],
);
map(
  'image-editor/EditorCanvas.tsx',
  {
    101: 'Commit a drawn pencil stroke as one undo step, cancel an unfinished stroke and zoom the view without editing pixels.',
  },
  ['image.canvas'],
  V,
  'Requires an open image session; modal adjustment/transform ownership is handled by the gesture engine.',
  'Representative production-canvas gesture exercised; this is not exhaustive testing of every tool, modifier, platform pointer device or rendered pixel.',
);
map(
  'image-editor/EditorOptionsBar.tsx',
  {
    91: 'Select linear or radial gradient mode.',
    220: 'Toggle whether the magic wand selects only a connected region.',
  },
  ['image.gradient'],
);
map(
  'image-editor/EditorOptionsBar.tsx',
  {
    124: 'Commit the crop box and change actual pixel dimensions.',
    134: 'Discard the pending crop box without changing dimensions.',
  },
  ['image.crop'],
  V,
  'Crop mode only; both actions disabled when there is no pending box.',
);
map(
  'image-editor/EditorOptionsBar.tsx',
  { 184: 'Set the paint colour to each black, gray or white swatch.' },
  ['image.swatches'],
);
map(
  'image-editor/EditorSelectionControls.tsx',
  {
    38: 'Select Replace, Add, Subtract or Intersect selection mode.',
    116: 'Delete selected pixels.',
    122: 'Fill selected pixels with foreground colour.',
    128: 'Invert the selected mask.',
    134: 'Clear the mask.',
    151: 'Dispatch each reusable selection action only when enabled.',
  },
  ['image.selection'],
  V,
  'Selection actions are disabled without a selection; mode controls remain available.',
);
map(
  'image-editor/EditorSelectionControls.tsx',
  {
    90: 'Dispatch Expand, Contract, Border, Feather and Smooth with the selected radius into the real mask operation.',
  },
  ['image.modify'],
);
map(
  'image-editor/EditorAdjustMenus.tsx',
  {
    48: 'Open Image menu and route Image Size/Canvas Size to their dialogs.',
    59: 'Open the image Text dialog.',
    119: 'Dismiss the open operation menu when its backdrop is clicked.',
  },
  ['image.menus'],
);
map(
  'image-editor/EditorAdjustMenus.tsx',
  {
    49: 'Open Adjust and dispatch every listed adjustment.',
    54: 'Open Filter and dispatch every listed filter.',
    137: 'Close the menu and open the selected dialog or apply an instant image operation.',
  },
  ['image.adjustments', 'image.menus'],
);
map(
  'image-editor/EditorAdjustMenus.tsx',
  {
    96: 'Open/focus either end of a menu with arrow keys, navigate/dismiss it, and disable image operations during an unfinished transform.',
  },
  ['image.menu.keyboard', 'image.menu.transform'],
  D,
  'Disabled while a transform is unfinished; keyboard focus and Escape tested.',
  'Menu keyboard/focus and transform-state fixes from the earlier pass remain included in this audit.',
);
map(
  'image-editor/AdjustDialog.tsx',
  { 84: 'Toggle canvas preview without committing image pixels.' },
  ['image.preview'],
);
for (const [line, action, outcome] of [
  [94, 'Reset', 'Restore default adjustment parameters.'],
  [102, 'Cancel', 'Discard the adjustment without a pixel/history change.'],
  [110, 'OK', 'Commit adjusted pixels as exactly one undo step.'],
])
  map('image-editor/AdjustDialog.tsx', { [line]: outcome }, [`image.adjust.${action}`]);
map(
  'image-editor/ResizeDialog.tsx',
  {
    65: 'Toggle proportional resizing and retain the appropriate height/width relation.',
    91: 'Commit image or canvas dimensions to actual pixels.',
    141: 'Select each of nine canvas anchors and use the selected anchor in canvas resizing.',
  },
  ['image.resize'],
);
map(
  'image-editor/ResizeDialog.tsx',
  { 83: 'Cancel the resize draft without committing it, including native Enter activation.' },
  ['image.resize.cancel'],
);
map(
  'image-editor/TextDialog.tsx',
  {
    64: 'Cancel without inserting a paint layer.',
    72: 'Rasterize the entered text and insert one named paint layer.',
  },
  ['image.text'],
  B,
  'OK disabled for blank text. Glyph rasterization replaced with a deterministic buffer.',
);
map(
  'image-editor/HistoryPanel.tsx',
  {
    58: 'Move backward and forward to the clicked history point and restore its actual image pixels.',
  },
  ['image.history'],
);
map(
  'image-editor/LayersPanel.tsx',
  {
    64: 'Toggle a layer visibility while activating the target layer.',
    82: 'Select the clicked paint layer.',
  },
  ['image.layerselect'],
);
map(
  'image-editor/LayersPanel.tsx',
  {
    143: 'Insert a new layer above the active layer.',
    152: 'Duplicate the active layer.',
    189: 'Delete the active layer while preserving the last remaining layer.',
  },
  ['image.layerstack'],
  V,
  'Delete disabled when only one layer remains.',
);
map(
  'image-editor/LayersPanel.tsx',
  {
    161: 'Move a layer up only when a higher stack position exists.',
    170: 'Move a layer down only when a lower stack position exists.',
    179: 'Merge into the lower layer only when one exists.',
  },
  ['image.layerstack'],
  D,
  'Up disabled at top, Down/Merge disabled at bottom.',
  'Reproduced enabled no-op controls, then introduced separate movement/delete availability predicates. Initial failures retained in studios-reproduction-tests.json.',
);
map(
  'image-editor/ImageEditorTopBar.tsx',
  {
    33: 'Ask the window to toggle Layers/History panels.',
    64: 'Dispatch session Undo.',
    73: 'Dispatch session Redo.',
    82: 'Dispatch session Revert.',
    91: 'Dispatch Apply once pending edits exist.',
    100: 'Dispatch Apply and Trace.',
    109: 'Dispatch Close while retaining the session owner policy.',
  },
  ['image.topbar'],
  B,
  'Undo/Redo require their history direction; Revert requires edits; Apply requires dirty pixels and no in-flight Apply; Apply & Trace blocked while applying.',
  'This verifies UI-to-owner routing. It does not by itself establish PNG encoding or project persistence.',
);
map(
  'image-editor/KerfStatus.tsx',
  {
    20: 'Offer the correction only for a reversible target and hand that exact target to Thicken.',
  },
  ['image.kerf'],
  B,
  'Only displayed when the loss check can identify a reversible target.',
);

def('design.tools', 'design-studio/DesignControls.audit.test.tsx', 'arms all eight');
def('design.view', 'design-studio/DesignControls.audit.test.tsx', 'top bar restores geometry');
def('design.apply', 'design-studio/DesignControls.audit.test.tsx', 'top bar Apply writes');
def(
  'design.inspector',
  'design-studio/DesignControls.audit.test.tsx',
  'precision inspector duplicates',
);
def(
  'design.toolbar',
  'design-studio/DesignControls.audit.test.tsx',
  '3D toolbar dispatches',
  'Rendered 3D toolbar with callback spies: preset/tier/simulation request and disabled states checked; no WebGL rendering or completed tool simulation in this case.',
);
def('design.layers', 'design-studio/layers/DesignLayers.audit.test.tsx', 'adds, selects, assigns');
def('design.depth', 'design-studio/layers/DesignLayers.audit.test.tsx', 'sets through depth');
def(
  'design.resize',
  'design-studio/preview3d/DesignSidePanel.test.tsx',
  'resizes on a bubbled arrow',
);
def('design.canvas', 'design-studio/DesignGestures.audit.test.tsx', '2D production canvas');
def(
  'design.3dcanvas',
  'design-studio/DesignGestures.audit.test.tsx',
  '3D production canvas',
  'Production 3D canvas and shared gesture engine commit real sketch geometry. Scene raycast/pixel scale and WebGL hook are replaced by a deterministic scene handle. Real GPU rendering/orbit requires a browser environment.',
);
def('design.drag', 'design-studio/DesignGestures.audit.test.tsx', 'precision header drag');
map(
  'design-studio/DesignToolRails.tsx',
  {
    40: 'Render and select each of eight tool choices.',
    52: 'Arm the selected design tool and update its pressed state.',
  },
  ['design.tools'],
);
map(
  'design-studio/DesignOptionsBar.tsx',
  { 35: 'Open the specific lesson for all eight selected design tools.' },
  ['design.tools'],
);
map(
  'design-studio/DesignTopBar.tsx',
  {
    34: 'Undo the actual geometry creation.',
    40: 'Redo and restore that geometry.',
    50: 'Toggle snapping.',
    56: 'Toggle orthogonal drawing constraints.',
    62: 'Toggle the grid.',
    68: 'Toggle 2D/3D drawing surface.',
    124: 'Dispatch every shared toggle and reflect its real store value.',
  },
  ['design.view'],
);
map(
  'design-studio/DesignTopBar.tsx',
  {
    49: 'Dispatch a request to fit the design view.',
    105: 'Dispatch the named top-bar action and honour disabled state.',
  },
  ['design.view', 'design.apply'],
  B,
  'Undo/Redo and Apply availability derived from actual history/dirty state.',
  'Fit is checked at its callback boundary. Undo/Redo and Apply are checked against real geometry/project state.',
);
map(
  'design-studio/DesignTopBar.tsx',
  {
    77: 'Write design artwork to the project once and leave the Studio open.',
    83: 'Apply the updated geometry and close the Studio.',
    89: 'Close/stash an unapplied session without writing artwork.',
  },
  ['design.apply'],
);
map(
  'design-studio/ShapeInspector.tsx',
  {
    108: 'Duplicate the selected shape with the defined offset.',
    116: 'Toggle construction-guide status.',
    125: 'Delete the selected geometry.',
  },
  ['design.inspector'],
);
map(
  'design-studio/ShapeInspector.tsx',
  {
    64: 'Drag the precision panel, clamp it to the viewport and stop moving on release without altering geometry.',
  },
  ['design.drag'],
);
map(
  'design-studio/DesignCanvas.tsx',
  {
    62: 'Map a rectangle drag through the 2D production canvas into one real sketch/history step.',
  },
  ['design.canvas'],
  V,
  'Open design session with a measured view.',
  'Representative rectangle gesture; additional tools have separate shared gesture tests, not an exhaustive pointer-device qualification.',
);
map(
  'design-studio/viewport3d/DesignViewport3D.tsx',
  {
    33: 'Map a rectangle drag through the production 3D canvas and shared gesture engine into one real sketch/history step.',
  },
  ['design.3dcanvas'],
  B,
  'Requires a ready scene mapping; drawing is unavailable without a scene; 2D fallback remains available.',
);
map(
  'design-studio/layers/DesignLayerFields.tsx',
  { 61: 'Toggle the V-carve flat-depth option.', 179: 'Set cut depth to actual stock thickness.' },
  ['design.depth'],
);
map(
  'design-studio/layers/DesignLayerRow.tsx',
  {
    30: 'Select the carve layer.',
    55: 'Move a carve layer up.',
    64: 'Move a carve layer down.',
    73: 'Delete a removable carve layer.',
  },
  ['design.layers'],
  V,
  'Move controls disabled at stack edges; final remaining layer cannot be deleted.',
);
map(
  'design-studio/layers/DesignLayersCard.tsx',
  { 125: 'Assign selected sketch entities to the active layer.', 138: 'Create a new carve layer.' },
  ['design.layers'],
  V,
  'Assign requires selected geometry.',
);
map(
  'design-studio/layers/DesignLayerSettings.tsx',
  { 28: 'Open the lesson matching the cut type, including the tested V-carve route.' },
  ['design.depth'],
  B,
  'Shown for the selected carve layer.',
  'V-carve binding exercised in the enclosing view; the shared contextual lesson suite exercises all named lessons separately.',
);
map(
  'design-studio/preview3d/DesignSidePanel.tsx',
  { 20: 'Resize the layers panel by keyboard without also moving selected geometry/history.' },
  ['design.resize'],
  V,
  'Panel visible; keyboard separator focused.',
  'Pointer dragging of this particular panel was not separately exercised; keyboard action is verified.',
);
map(
  'design-studio/viewport3d/DesignViewportToolbar.tsx',
  {
    18: 'Request top camera preset.',
    23: 'Request isometric camera preset.',
    29: 'Select the live design tier.',
    35: 'Select the Bits simulation tier only if a result exists.',
    48: 'Request a new bit simulation.',
    70: 'Dispatch each shared viewport button and honour unavailable Bits.',
  },
  ['design.toolbar'],
  B,
  'Bits disabled without a simulation; stale result is labelled.',
);

def('camera.panel', 'camera/panel/CameraPanel.audit.test.tsx', 'opens the camera lesson');
def(
  'camera.usb',
  'camera/panel/CameraPanel.audit.test.tsx',
  'starts USB through',
  'Rendered source controls and actual camera/wizard stores; CameraAdapter returns denial then a fake MediaStream. Start/Stop/Calibrate routing checked; no USB device or permission prompt opened.',
);
def(
  'camera.rtsp',
  'camera/panel/CameraPanel.audit.test.tsx',
  'opens RTSP details',
  'Rendered control and actual source lifecycle using a fake bridge reply. URL handoff and Stop state checked; no network camera or FFmpeg process used.',
);
def(
  'camera.machine',
  'camera/panel/CameraPanel.audit.test.tsx',
  'dispatches machine discovery',
  'Discovery callback spy and found-source fixture; actual activation state and already-active disabled state checked. Discovery transport not performed.',
);
def(
  'camera.diagnostics',
  'camera/panel/CameraPanel.audit.test.tsx',
  'opens Diagnostics',
  'Rendered diagnostics and real feedback state; capture input is deterministic readable pixels or failure. No camera acquired.',
);
def(
  'camera.snapshot',
  'camera/panel/CameraPanel.audit.test.tsx',
  'gates idle snapshot',
  'Rendered Snapshot controls; saveCameraSnapshot callback spy receives the live source and fake platform. No image file written.',
);
def(
  'camera.network',
  'camera/NetworkCameraView.audit.test.tsx',
  'cancels corner collection',
  'Rendered camera image receives synthetic load dimensions and four corner clicks. Real homography solver and device alignment persistence run; no camera or actual overlay rendering.',
);
def(
  'camera.overlay',
  'camera/OverlayControls.audit.test.tsx',
  'toggles the actual overlay',
  'Production overlay controls and real camera/placement store; frame capture input is fixed RGBA pixels, and source is a fake USB stream. No physical origin or camera action.',
);
def(
  'camera.trace',
  'camera/OverlayControls.audit.test.tsx',
  'camera Trace captures',
  'Production Trace button, real homography warp and trace-dialog store; frame acquisition and PNG encoding are deterministic test boundaries. No camera or native file action.',
);
def('camera.auto', 'camera/AutoAlignControls.test.tsx', 'requires the Labs opt-in');
def(
  'camera.burn',
  'camera/align-wizard/AlignControls.audit.test.tsx',
  'gates disconnected marker burn',
  'Actual wizard input controls; burnAlignMarkers is a callback spy receiving selected power/speed. No machine commands, motion or laser output.',
);
def('camera.skip', 'camera/align-wizard/AlignControls.audit.test.tsx', 'skip and clear-bed');
def(
  'camera.detect',
  'camera/align-wizard/AlignControls.audit.test.tsx',
  'detect action requires',
  'Rendered Detect control; alignment pipeline is a spy. Confirms live-source guard and in-flight disabling only; no camera-marker capture performed.',
);
def(
  'camera.board',
  'camera/wizard/WizardControls.audit.test.tsx',
  'prints and saves',
  'Rendered board actions generate real scale-labelled SVG, hand it to fake print and SaveTarget.write boundaries, and advance wizard state. No printer, filesystem destination or external write.',
);
def('camera.frame', 'camera/wizard/WizardControls.audit.test.tsx', 'minimizes and expands');
def(
  'camera.review',
  'camera/wizard/WizardControls.audit.test.tsx',
  'failed review resets',
  'Actual Review controls with recorded successful/failed calibration fixtures; preview choice, reset/capture navigation and device calibration persistence checked. Optical accuracy of the fixture is not established.',
);
def('camera.capture.gates', 'camera/wizard/CaptureControls.audit.test.tsx', 'gates missing board');
def(
  'camera.capture',
  'camera/wizard/CaptureControls.audit.test.tsx',
  'manual capture ingests',
  'Rendered Capture/Reset/Solve controls; synthetic checkerboard pixels run through the real corner detector and capture store. Source capture/live feedback are mocked. Solve handoff is checked; no optical calibration or real camera qualified.',
);
map(
  'camera/AutoAlignControls.tsx',
  { 24: 'Require Labs opt-in, then open the marker alignment wizard.' },
  ['camera.auto'],
  V,
  'Hidden without camera-alignment Labs opt-in; unavailable prerequisites disable it.',
);
map(
  'camera/NetworkCameraView.tsx',
  {
    110: 'Clear the prior alignment and return to corner collection.',
    125: 'Collect four ordered image corners and solve a bed homography.',
    230: 'Cancel collection and return to idle.',
    245: 'Retry failed corner alignment.',
    257: 'Begin a new four-corner alignment.',
  },
  ['camera.network'],
  B,
  'Image must be loaded with natural dimensions; Align/Cancel/Retry reflect the current collection state.',
);
map(
  'camera/NetworkCameraView.tsx',
  {
    104: 'Offer Save alignment for the solved homography.',
    166: 'Persist the homography; label Alignment saved when already current, and instruct Use this camera then Update still and Overlay on if hidden to display it.',
  },
  ['camera.network'],
  D,
  'Save disabled when this exact alignment is already persisted.',
  'Previous Save & show on canvas label falsely promised overlay activation. Raw reproduction retained in studios-network-reproduction-tests.json; label and instruction fixed. Saving alone intentionally does not capture or show a frame.',
);
map(
  'camera/OverlayControls.tsx',
  {
    65: 'Toggle overlay visibility and activate camera placement.',
    74: 'Capture a new still from the selected live source.',
    83: 'Discard the still and return to live overlay.',
    93: 'Render Exit for the current camera placement.',
    160: 'Exit placement, hide overlay and clear coordinate confirmation without changing job origin.',
    179: 'Record confirmation for the current trusted-position epoch.',
  },
  ['camera.overlay'],
  B,
  'Update still requires live source; Live requires a still and a live-overlay-compatible source; coordinate confirmation shown when required.',
);
map(
  'camera/OverlayControls.tsx',
  { 92: 'Render the Trace from camera action and its source availability.' },
  ['camera.trace'],
  B,
);
map(
  'camera/TraceFromCameraButton.tsx',
  {
    74: 'Capture/warp the camera frame into a bed-sized trace source and open normal Trace Image.',
  },
  ['camera.trace'],
  B,
  'Disabled without live source; overlay row requires an alignment.',
);
map('camera/panel/CameraPanel.tsx', { 57: 'Close the camera panel and remove its dialog.' }, [
  'camera.panel',
]);
map(
  'camera/panel/CameraDiagnostics.tsx',
  { 50: 'Expand diagnostics.', 67: 'Test capture and report readable dimensions or failure.' },
  ['camera.diagnostics'],
  B,
  'Capture disabled while source is idle.',
);
map(
  'camera/panel/MachineCameraSection.tsx',
  {
    22: 'Request discovery and prevent a duplicate request while detecting.',
    32: 'Activate the discovered source and disable In use once selected.',
  },
  ['camera.machine'],
  B,
);
map(
  'camera/panel/RtspSourceControls.tsx',
  {
    45: 'Expand RTSP source details.',
    65: 'Connect the entered URL and stop the active RTSP source.',
  },
  ['camera.rtsp'],
  B,
  'Connect disabled for blank URL or during startup.',
);
map(
  'camera/panel/SnapshotControls.tsx',
  { 29: 'Hand the live source and platform to snapshot saving.' },
  ['camera.snapshot'],
  B,
  'Disabled without live source.',
);
map(
  'camera/panel/SnapshotControls.tsx',
  { 38: 'Switch camera panel between compact 320px and larger 560px widths.' },
  ['camera.panel'],
);
map(
  'camera/panel/UsbCameraSection.tsx',
  {
    62: 'Stop the current stream and return to idle.',
    71: 'Request USB camera access, display denial or retain the acquired stream.',
    81: 'Open lens calibration from a live source.',
  },
  ['camera.usb'],
  B,
  'Start disabled while starting; Calibrate disabled without live source.',
);
map(
  'camera/align-wizard/AlignWizardSteps.tsx',
  { 41: 'Hand selected marker power/speed to the transient burn workflow.' },
  ['camera.burn'],
  B,
  'Disabled when disconnected; test never invokes the machine boundary.',
);
map(
  'camera/align-wizard/AlignWizardSteps.tsx',
  {
    50: 'Skip burning and proceed to marker detection.',
    174: 'Confirm bed clear and proceed to marker detection.',
  },
  ['camera.skip'],
);
map(
  'camera/align-wizard/AlignWizardDetectStep.tsx',
  { 25: 'Request marker detection once when source is live.' },
  ['camera.detect'],
  B,
  'Disabled without live source or while detecting.',
);
map(
  'camera/align-wizard/AlignWizardDetectStep.tsx',
  { 63: 'Close the alignment wizard after success.' },
  ['camera.skip'],
);
map(
  'camera/wizard/BoardActions.tsx',
  {
    44: 'Generate a scale-labelled checkerboard and request print.',
    51: 'Request a save destination and write the generated checkerboard SVG to that boundary.',
  },
  ['camera.board'],
  B,
);
map(
  'camera/wizard/SetupStep.tsx',
  { 67: 'Advance from board setup to capture.' },
  ['camera.board'],
  B,
  'Wizard setup step; printable board generation and state transition exercised.',
);
map(
  'camera/wizard/CameraWizardFrame.tsx',
  {
    25: 'Minimize and expand the same calibration session.',
    37: 'Close the current camera wizard.',
  },
  ['camera.frame'],
);
map(
  'camera/wizard/CaptureStep.tsx',
  {
    125: 'Toggle automatic capture.',
    132: 'Read a detected checkerboard frame and append its accepted corners.',
    147: 'Discard all captures and reset the session.',
    155: 'Begin solving only after enough accepted captures.',
  },
  ['camera.capture.gates', 'camera.capture'],
  B,
  'Capture requires a locked board and source element; Reset requires captures; Solve requires the minimum accepted set.',
);
map(
  'camera/wizard/ReviewStep.tsx',
  {
    47: 'Reset failed solve and return to capture.',
    101: 'Show original review image.',
    104: 'Show corrected review image.',
    125: 'Return to capture for additional poses.',
    128: 'Persist the calibration and recorded source binding, then close the wizard.',
  },
  ['camera.review'],
  B,
);

def(
  'inspector.scene',
  'gcode-inspector/InspectorControls.audit.test.tsx',
  'ready Inspector routes',
  'Real Inspector UI/state/model and source index; WebGL scene methods are spies. Camera/display/source requests checked, not GPU rendering or PNG file creation.',
);
def(
  'inspector.transport',
  'gcode-inspector/InspectorControls.audit.test.tsx',
  'all preview transport',
  'Rendered timeline with playback callback spies. Exact restart/play/pause/step direction and empty-program guards checked; no machine transport used.',
);
def(
  'inspector.health',
  'gcode-inspector/InspectorControls.audit.test.tsx',
  'health findings use',
  'Rendered finding button hands zero-based line to onLocate; no-line finding has no navigation control. Callback boundary.',
);
def(
  'inspector.switch',
  'gcode-inspector/InspectorControls.audit.test.tsx',
  'canvas view buttons',
  'Rendered view buttons dispatch boolean view selection; machine store remains identical.',
);
def(
  'inspector.refresh',
  'gcode-inspector/InspectorControls.audit.test.tsx',
  'canvas refresh dispatches',
  'Rendered canvas wrapper with compile/current-G-code hook replaced by state fixtures and refresh spy. Real running/finished enum values tested; no compiler or machine command launched.',
);
def(
  'inspector.dialog',
  'gcode-inspector/InspectorControls.audit.test.tsx',
  'Inspector dialog Close',
  'Rendered Inspector dialog Close and CNC-only handoff callback assertions; parser state is idle fixture.',
);
def(
  'inspector.live',
  'gcode-inspector/InspectorView.live.test.tsx',
  'switches to local playback and back',
  'Production Inspector with real live-source matching and state transition; synthetic controller reports and WebGL scene boundary. Asserts controller state is untouched.',
);
map(
  'gcode-inspector/CanvasGcodeView.tsx',
  {
    39: 'Request compilation/current-design refresh and disable it during compilation or an active run; enable it after the run finishes.',
  },
  ['inspector.refresh'],
  B,
);
map(
  'gcode-inspector/CanvasViewSwitch.tsx',
  { 41: 'Select design or G-code view without changing controller state.' },
  ['inspector.switch'],
  B,
);
map(
  'gcode-inspector/GcodeInspectorDialog.tsx',
  {
    37: 'Notify owner to close the Inspector.',
    73: 'Hand the program to the 2D simulator owner for CNC only.',
  },
  ['inspector.dialog'],
  B,
  '2D handoff omitted in laser mode.',
);
map(
  'gcode-inspector/InspectorHealthPanel.tsx',
  { 59: 'Navigate to the finding line using the correct zero-based callback.' },
  ['inspector.health'],
  B,
  'No navigation button for a finding without a line.',
);
map(
  'gcode-inspector/InspectorSidebar.tsx',
  { 48: 'Toggle non-cutting travel display.', 57: 'Toggle direction arrows on the cut path.' },
  ['inspector.scene'],
  B,
);
map(
  'gcode-inspector/InspectorSourcePane.tsx',
  { 127: 'Jump the local playhead to the selected source line.' },
  ['inspector.scene'],
  B,
);
map(
  'gcode-inspector/InspectorTimeline.tsx',
  {
    112: 'Restart local preview.',
    120: 'Step preview backward by 0.25 seconds.',
    130: 'Play or pause local preview.',
    140: 'Step preview forward by 0.25 seconds.',
  },
  ['inspector.transport'],
  B,
  'Step and Play disabled for a zero-length program.',
);
map(
  'gcode-inspector/InspectorView.tsx',
  {
    156: 'Switch between reported run observation and local playback without controller mutation.',
  },
  ['inspector.live'],
  B,
  'Only shown when the displayed source matches the recorded live run.',
);
map(
  'gcode-inspector/InspectorView.tsx',
  { 167: 'Show/hide the source pane.' },
  ['inspector.scene'],
  B,
  'Available in the full Inspector layout.',
);
map(
  'gcode-inspector/InspectorViewControls.tsx',
  {
    42: 'Select Manual, Follow or Auto views camera mode.',
    57: 'Request each Iso/Top/Front/Right preset.',
    68: 'Request fitted isometric view.',
    77: 'Request scene PNG capture.',
  },
  ['inspector.scene'],
  B,
  'Controls unavailable while the scene is not ready.',
  'PNG case verifies captureImage dispatch only; browser download/real WebGL output remains outside the test.',
);
map(
  'gcode-inspector/InspectorViewport.tsx',
  { 52: 'Toggle non-cutting travel display from the viewport control.' },
  ['inspector.scene'],
  B,
);

def(
  'text.fonts',
  'text/TextControls.audit.test.tsx',
  'font picker opens',
  'Rendered font picker chooses every registry font and one embedded font; CSS/font byte loading stubbed. Callback key and popup dismissal checked, not glyph rasterization.',
);
def(
  'text.import',
  'text/TextControls.audit.test.tsx',
  'font Import opens',
  'Native file-input click and file selection are simulated; exact File reaches the import callback, with no OS picker/network/file write.',
);
def(
  'text.symbols',
  'text/TextControls.audit.test.tsx',
  'symbol disclosure',
  'Rendered disclosure and all 15 accent buttons dispatch exact characters to a callback.',
);
def('text.fields', 'text/TextControls.audit.test.tsx', 'formatting radio');
def(
  'text.canvas',
  'text/TextControls.audit.test.tsx',
  'canvas text Done and Cancel',
  'Actual draft fields and variable controls; Done/Cancel owner callbacks and exact six template insertions checked. No text rendering in this boundary test.',
);
def('text.cancel', 'text/TextControls.audit.test.tsx', 'Add Text Cancel');
def(
  'text.add',
  'text/AddTextDialog.test.tsx',
  'links new text to the selected vector guide',
  'Production Add Text dialog with deterministic font/render fixture; committed project text and guide linkage checked. Real platform font rendering not qualified.',
);
def('text.accent', 'text/AddTextDialog.test.tsx', 'inserts a diacritic');
def('text.embed', 'text/AddTextDialog.test.tsx', 'embeds an imported font');
def(
  'text.csv',
  'text/VariableCsvImport.test.tsx',
  'owns a selection dispatched synchronously',
  'Actual CSV picker ownership and parsing path with native picker event and fake File input. No OS dialog or external file modified.',
);
def(
  'text.sequence',
  'text/VariableSequenceControls.test.tsx',
  'edits ranges, removes',
  'Rendered range controls with real draft state; Previous/Reset/Next callback spies and wrap-state mutations checked.',
);
def(
  'text.wrap',
  'text/VariableSequenceControls.test.tsx',
  'stores a persistable serial wrap endpoint',
);
map(
  'text/FontPicker.tsx',
  {
    56: 'Open and close the font list.',
    93: 'Choose every bundled font key and close the menu.',
    151: 'Choose the embedded project font key and close the menu.',
  },
  ['text.fonts'],
  B,
);
map(
  'text/FontImportButton.tsx',
  { 12: 'Open the native picker boundary and pass the chosen font File to import.' },
  ['text.import', 'text.embed'],
  B,
);
map(
  'text/TextFormattingFields.tsx',
  { 37: 'Expose the import-font control within formatting fields.' },
  ['text.import', 'text.embed'],
  B,
);
map(
  'text/TextFormattingFields.tsx',
  {
    45: 'Toggle letter welding for outline fonts and disable welding for stroke fonts.',
    104: 'Select left/centre/right text alignment.',
  },
  ['text.fields'],
);
map(
  'text/PathTextFields.tsx',
  {
    17: 'Enable/disable path text on an available guide.',
    59: 'Reverse text direction along the enabled guide.',
  },
  ['text.fields', 'text.canvas'],
  V,
  'Path enable disabled when there is no guide. Reverse shown only for enabled path text.',
);
map('text/VariableTextFields.tsx', { 24: 'Enable template evaluation for the dialog draft.' }, [
  'text.fields',
]);
map(
  'text/CanvasVariableTextFields.tsx',
  { 18: 'Enable template evaluation for the canvas text draft.' },
  ['text.canvas'],
  B,
);
map(
  'text/CanvasTextPanel.tsx',
  { 66: 'Notify the text owner to cancel.', 67: 'Notify the text owner to save the canvas text.' },
  ['text.canvas'],
  B,
  'Done requires available font/path and no save in flight.',
  'Owner callback boundary checked; existing CanvasTextEditor cases additionally cover actual commit/cancel ownership.',
);
map(
  'text/CanvasTextSymbols.tsx',
  {
    6: 'Expand accented letters and symbols.',
    11: 'Insert the exact selected accented character.',
  },
  ['text.symbols'],
  B,
);
map('text/AddTextDialog.tsx', { 170: 'Insert an accented character at the text cursor.' }, [
  'text.accent',
]);
map(
  'text/AddTextDialog.tsx',
  { 195: 'Cancel and close without editing the project.' },
  ['text.cancel'],
  V,
  'Disabled while submitting.',
);
map(
  'text/AddTextDialog.tsx',
  { 198: 'Submit text and retain the selected path guide in committed project geometry.' },
  ['text.add'],
  B,
  'Submit disabled when text/font/path prerequisites are unavailable or submitting.',
);
map(
  'text/VariableCsvImport.tsx',
  { 25: 'Open CSV import and parse/publish the file only for the current picker/document owner.' },
  ['text.csv'],
  B,
);
map(
  'text/VariableSequenceControls.tsx',
  { 76: 'Dispatch Previous record.', 77: 'Dispatch sequence Reset.', 78: 'Dispatch Next record.' },
  ['text.sequence'],
  B,
);
map(
  'text/VariableSequenceControls.tsx',
  { 92: 'Enable/remove serial wrapping while keeping the endpoint persistable.' },
  ['text.sequence', 'text.wrap'],
);
map(
  'text/VariableTextControls.tsx',
  { 95: 'Insert exact date/time/serial/power/speed/passes template tokens.' },
  ['text.canvas'],
  B,
  'Variable-text controls visible when template evaluation is enabled.',
);

def(
  'raster.stage',
  'raster/AdjustImageDialog.test.tsx',
  'stages image and layer changes',
  'Actual Adjust Image form and local draft; submit callback receives exact patches. Underlying scene mutation/rendering is owned outside this component.',
);
def(
  'raster.cancel',
  'raster/AdjustImageDialog.test.tsx',
  'discards staged changes',
  'Actual Adjust Image draft and rendered Cancel; onCancel spy called, onApply untouched.',
);
def(
  'raster.native.submit',
  'raster/ViewerAndConversionControls.audit.test.tsx',
  'Adjust Image native OK',
  'Native OK click submits the actual dialog form once and delivers the exact image patch to its owner callback.',
);
def('raster.invert', 'raster/AdjustImageDialog.test.tsx', 'labels preview inversion');
def('raster.presets', 'raster/AdjustImageDialog.test.tsx', 'saves, reapplies, and deletes');
def(
  'raster.convert',
  'raster/ConvertToBitmapDialog.test.tsx',
  'operator clicks Convert',
  'Actual conversion form/native Convert click, output options sent to callback. Raster generation/file output is outside this UI boundary.',
);
def('raster.budget', 'raster/ConvertToBitmapDialog.test.tsx', 'disables Convert when');
def(
  'raster.convert.cancel',
  'raster/ViewerAndConversionControls.audit.test.tsx',
  'bitmap Cancel',
  'Actual busy conversion dialog; Cancel callback remains usable and conversion callback untouched.',
);
def(
  'viewer.modes',
  'raster/ViewerAndConversionControls.audit.test.tsx',
  'every CNC display mode',
  'Actual viewer toolbar dispatches each semantic mode and PNG save callback. Real WebGL and resulting file not exercised.',
);
def(
  'viewer.shell',
  'raster/ViewerAndConversionControls.audit.test.tsx',
  '3D viewer lesson',
  'Actual viewer shell with no scene while building; contextual lesson and Close owner callback checked.',
);
def(
  'viewer.dismiss',
  'cnc-viewer3d/CncBitPreviewToast.test.tsx',
  'auto-dismisses briefly',
  'Rendered preview toast dismisses via real button and timer; lazy scene is a fixture.',
);
map(
  'raster/AdjustImageDialog.fields.tsx',
  {
    246: 'Toggle negative output/pass-through in the local draft; preview inversion does not become negative output.',
  },
  ['raster.stage', 'raster.invert'],
  B,
);
map(
  'raster/AdjustImageDialog.presets.tsx',
  {
    56: 'Save the named settings preset without applying artwork changes.',
    64: 'Delete a saved user preset without applying artwork changes.',
  },
  ['raster.presets'],
  V,
  'Delete unavailable for a built-in or absent user preset.',
);
map(
  'raster/AdjustImageDialog.tsx',
  {
    214: 'Discard local changes and notify Cancel.',
    215: 'Submit the staged image/layer patches.',
  },
  ['raster.stage', 'raster.cancel', 'raster.native.submit'],
  B,
);
map(
  'raster/ConvertToBitmapDialog.tsx',
  {
    88: 'Cancel while busy without invoking conversion.',
    89: 'Send conversion options only when not busy and within raster budget.',
  },
  ['raster.convert', 'raster.budget', 'raster.convert.cancel'],
  B,
);
map(
  'relief-viewer/Viewer3DDialogShell.tsx',
  {
    59: 'Open the supplied contextual viewer lesson while the scene is building.',
    60: 'Notify the dialog owner to close the viewer.',
  },
  ['viewer.shell'],
  B,
  'Lesson appears only when an ID is supplied.',
);
map(
  'cnc-viewer3d/Viewer3DToolbar.tsx',
  {
    23: 'Dispatch Result, Result + path, Path or X-ray display mode.',
    49: 'Request a PNG save from the viewer owner.',
  },
  ['viewer.modes'],
  B,
);
map(
  'cnc-viewer3d/CncBitPreviewToast.tsx',
  { 102: 'Dismiss the bit preview immediately.' },
  ['viewer.dismiss'],
  B,
);

def('trace.finish', 'trace/TraceControls.audit.test.tsx', 'finishing disclosure');
def(
  'trace.actions',
  'trace/TraceControls.audit.test.tsx',
  'trace header Close',
  'Rendered header/actions and native form Submit. Distinct close/cancel/submit/removal callbacks asserted; trace computation is separate.',
);
def(
  'trace.commit',
  'trace/ImportImageDialog.test.ts',
  'passes Delete Image After trace',
  'Actual trace commit ownership path with deterministic decode/trace boundaries; verifies source removal semantics.',
);
def(
  'trace.cancel',
  'trace/ImportImageDialog.cancel.test.tsx',
  'closes ordinary-vector',
  'Actual trace dialog click Cancel while a successful mocked trace reply is pending; document and ownership remain unchanged after reply.',
);
def('trace.fade', 'trace/TracePreview.test.tsx', 'changes only the source image opacity');
def('trace.points', 'trace/TracePreview.test.tsx', 'shows traced nodes when');
def('trace.boundary', 'trace/TracePreview.test.tsx', 'clears the active Boundary');
def('trace.views', 'trace/trace-preview-view.test.tsx', 'starts in Overlay and switches layers');
def('trace.zoom', 'trace/trace-preview-view.test.tsx', 'zooms every layer together');
def('trace.limits', 'trace/trace-preview-view.test.tsx', 'bounds inspection zoom');
map(
  'trace/TraceSettingsControls.tsx',
  {
    74: 'Expand Edge Detection finishing settings.',
    79: 'Render/reset Edge Detection overrides.',
    106: 'Expand filled-contour finishing settings.',
    113: 'Expand transparency options.',
    125: 'Render/reset filled-contour overrides.',
    250: 'Clear overrides back to the chosen preset and disable Reset when already empty.',
    343: 'Enable tracing transparent alpha when available.',
  },
  ['trace.finish'],
  V,
  'Reset disabled with no overrides; alpha option unavailable before source transparency is known or if the source is opaque.',
);
map(
  'trace/dialog-parts.tsx',
  {
    48: 'Close trace preview without creating output.',
    214: 'Choose whether to remove the source bitmap after commit.',
    234: 'Submit Trace exactly once when allowed and disable during tracing/unavailable preview.',
  },
  ['trace.actions', 'trace.commit'],
  B,
);
map(
  'trace/dialog-parts.tsx',
  { 233: 'Cancel a pending trace without committing its later reply.' },
  ['trace.cancel'],
);
map(
  'trace/trace-preview-controls.tsx',
  {
    29: 'Fade only the source comparison image.',
    41: 'Show/hide trace points.',
    53: 'Clear the active trace boundary.',
  },
  ['trace.fade', 'trace.points', 'trace.boundary'],
);
map(
  'trace/trace-preview-controls.tsx',
  { 75: 'Switch Original/Overlay/Trace while retaining trace geometry and point state.' },
  ['trace.views'],
);
map(
  'trace/trace-preview-controls.tsx',
  {
    98: 'Zoom out in bounded half-steps.',
    111: 'Zoom in in bounded double-steps.',
    121: 'Fit all comparison layers and reset the viewport.',
  },
  ['trace.zoom', 'trace.limits'],
);

// Static contextual call sites use the exact named lesson's executed shared contract.
// This is deliberately boundary evidence, not an assertion that each enclosing view was mounted.
for (const c of controls.filter((item) => !rows.has(item.id) && item.tutorialId)) {
  if (!/^[a-z0-9-]+$/.test(c.tutorialId)) {
    if (c.file.endsWith('EditorOptionsBar.tsx')) {
      map(
        'image-editor/EditorOptionsBar.tsx',
        { [c.line]: 'Open the current image-tool lesson; paint-tool route exercised.' },
        ['image.swatches'],
        B,
        'Context changes with selected tool.',
        'Paint route mounted here; other tool lesson IDs are source-reviewed and independently exercised by the shared tutorial suite.',
      );
      continue;
    }
    throw new Error(`Unmapped dynamic tutorial ${c.id}`);
  }
  const key = `tutorial.${c.tutorialId}`;
  def(
    key,
    'tutorials/TutorialControls.audit.test.tsx',
    `'${c.tutorialId}' card and contextual button`,
    'Executed shared TutorialButton with this exact lesson ID: lesson title/step, close, project/undo/dirty immutability asserted. The enclosing call-site ID was inspected in production source; not every enclosing view mounted in this case.',
  );
  map(
    c.file.replace('src/ui/', ''),
    { [c.line]: `Open the ${c.tutorialId} lesson without editing the project.` },
    [key],
    B,
    'Available when its containing view is visible.',
    'Shared contextual-control contract plus inspected site binding; enclosing-site layout/visibility is a separate boundary.',
  );
}
const missing = controls.filter((c) => !rows.has(c.id));
if (missing.length)
  throw new Error(`Missing ${missing.length}: ${missing.map((c) => c.id).join(', ')}`);
const ordered = controls.map((c) => rows.get(c.id));
const counts = {};
for (const r of ordered) counts[r.disposition] = (counts[r.disposition] ?? 0) + 1;
const uniqueCases = new Map(
  ordered.flatMap((r) => r.evidence).map((e) => [`${e.file}::${e.test}`, e]),
);
const sourceDigest = crypto
  .createHash('sha256')
  .update(
    [...new Set(controls.map((c) => c.file))]
      .sort()
      .map((f) => `${f}\0${fs.readFileSync(path.join(repo, f), 'utf8')}`)
      .join('\0'),
  )
  .digest('hex');
const data = {
  metadata: {
    scope: areas,
    baseline: 'buttons.json baseline identifiers retained despite source line shifts',
    baselineCount: controls.length,
    generatedAt: new Date().toISOString(),
    dispositionCounts: counts,
    distinctExecutedCasesCited: uniqueCases.size,
    allCitedResults: 'passed',
    sourceDigestSha256: sourceDigest,
    limits:
      'Software control audit using React/jsdom and deterministic platform/camera/WebGL boundaries. No physical camera, printer, controller, laser, spindle, optical accuracy or material result qualified. A row classified verified-boundary is not an end-to-end success claim.',
  },
  controls: ordered,
};
const target = path.join(dir, 'control-audit-studios.json');
fs.writeFileSync(
  target,
  await prettier.format(JSON.stringify(data), {
    ...(await prettier.resolveConfig(target)),
    filepath: target,
  }),
);
const escape = (v) => String(v).replaceAll('|', '\\|').replaceAll('\n', ' ');
const md = `# Studio and camera control audit\n\nAll ${ordered.length} baseline records are accounted for. ${uniqueCases.size} distinct executed cases are cited by exact name, each with a retained JSON report and an explicit test boundary. These counts describe control records (including reusable call sites), not distinct visible buttons or exhaustive variants.\n\n${Object.entries(
  counts,
)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join(
    '\n',
  )}\n\nVerified behaviour means a rendered control changed a real local draft/store or document as asserted. Verified boundary means a rendered control reached its owner, platform, acquisition or scene boundary; external effects remain unqualified. No hardware was operated. Tutorial entries distinguish a tested shared contextual button from its inspected enclosing-site binding.\n\nConfirmed fixes: image-layer Up/Down/Merge were enabled at impossible stack positions; camera Save & show on canvas claimed an effect it did not perform. The camera control now says Save alignment and explains Use this camera, then Update still, with Overlay on if hidden. Earlier image-menu keyboard/transform-state fixes were also rechecked. Initial failing reproductions are retained; the cited regressions pass.\n\n| Baseline ID | Label | Expected outcome | Availability | Disposition | Specific executed evidence and boundary | Notes |\n|---|---|---|---|---|---|---|\n${ordered.map((r) => `| ${escape(r.id)} | ${escape(r.label)} | ${escape(r.expectedOutcome)} | ${escape(r.availability)} | ${r.disposition} | ${r.evidence.map((e) => escape(`${e.file} — ${e.test} [${e.result}; ${e.report}]. ${e.boundary}`)).join('<br>')} | ${escape(r.notes)} |`).join('\n')}\n`;
fs.writeFileSync(path.join(dir, 'control-audit-studios.md'), md);
const indexPath = path.join(dir, 'studios-evidence-index.json');
fs.writeFileSync(
  indexPath,
  await prettier.format(
    JSON.stringify(
      evidenceIndex.filter((e) => areas.some((a) => e.file.startsWith(`src/ui/${a}/`))),
    ),
    { ...(await prettier.resolveConfig(indexPath)), filepath: indexPath },
  ),
);
console.log(
  JSON.stringify(
    { count: ordered.length, counts, distinctCases: uniqueCases.size, sourceDigest },
    null,
    2,
  ),
);
