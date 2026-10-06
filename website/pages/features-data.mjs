// Copy for the features page, kept here so features.mjs stays readable. Every
// sentence traces to the verified site-facts extract (features, how-it-works
// and machines areas) or to source on origin/main 90c791c5f:
//   - Offset outlines: src/ui/layers/OffsetPathsRow.tsx:1-5,31-33,51-58,
//     mounted in src/ui/layers/SelectedObjectProperties.tsx:123
//   - fonts 21 + 4: src/core/text/font-registry.ts:8-40
//   - Quick Nest 32: src/core/nesting/outline-compact-nest.ts:29
//   - arrays: src/core/scene/array-layout.ts:3-26
//   - masks, crop, Adjust Image, measure, jig, laser-only gate:
//     src/ui/help/command-help-topics.ts, src/ui/commands/machine-command-gate.ts:31-46
//   - Registration Jig: DECISIONS.md ADR-057 (hardware verification pending)
//   - file types: README.md "File formats", src/ui/app/*-action(s).ts pickers,
//     src/io/lightburn/lbdev-import.ts:44-48 (.lbzip refused, GRBL-only profiles)
//   - camera bed alignment: the "Align to bed" wizard needs the Labs flag
//     (src/ui/camera/AutoAlignControls.tsx:15-16,40); manual four-corner
//     alignment is the desktop network-camera view (NetworkCameraView.tsx:1-5)
//   - Design Studio / Image Studio stages: PROJECT.md Phase N (DS-3c, DS-6b)
//     and Phase L (IE-2/IE-3 planned, IE-4 deferred)

import { proPill, statusPill } from '../lib/components.mjs';
import { html } from '../lib/html.mjs';

// Overview cards; each links to a section id on the features page. `pro` marks a
// tool the owner listed as Pro (commerce.config.mjs, ADR-524 Amendment 1).
export const OVERVIEW = [
  {
    icon: 'pen-tool',
    title: 'Design and drawing',
    href: '#design',
    body: 'Shapes, pen and node editing, Weld and the other booleans and offset outlines, plus Design Studio in Pro.',
  },
  {
    icon: 'type',
    title: 'Text and fonts',
    href: '#text',
    body: '25 bundled fonts, your own fonts, and variable text from CSV files, serial numbers and dates.',
  },
  {
    icon: 'scan-eye',
    title: 'Images and tracing',
    href: '#images',
    body: 'Line Art tracing, image masks and crop, and the Image Studio editor. Every other trace preset is in Pro.',
  },
  {
    icon: 'package',
    title: 'Generators and layout',
    href: '#generators',
    body: 'Arrays, Quick Nest, test grids, material libraries and a Registration Jig, plus the box generator in Pro.',
  },
  {
    icon: 'circle-play',
    title: 'Preview and G-code Inspector',
    href: '#preview',
    body: 'Toolpath preview and a job-time estimate. In Pro, the G-code Inspector plays back .nc, .gcode and .tap files in 3D.',
  },
  {
    icon: 'camera',
    title: 'Camera alignment',
    href: '#camera',
    pro: true,
    body: 'Lens calibration and bed alignment, with a USB camera or, in the desktop app, a network camera.',
  },
];

export const DESIGN_POINTS = [
  'Rectangles, ellipses, polygons, stars and pen lines, with node and curve editing',
  'Weld, Subtract, Intersect and Exclude to combine closed shapes',
  'Offset outlines: add a larger or smaller copy of selected closed shapes at a set distance, and keep the originals',
  'Import SVG, DXF, PNG, JPG or STL files with File → Import, the toolbar or drag-and-drop',
  'Measure distance and angle on the workspace',
  html`Design Studio: draw parts to exact size in a full window, with snapping, fillets and
  chamfers. Typing sizes while you draw, trim and extend are planned. ${statusPill('in-progress')}
  ${proPill()}`,
];

export const TEXT = [
  {
    icon: 'type',
    title: '25 bundled fonts',
    body: 'Choose from 21 outline fonts and 4 single-line fonts made for engraving. Styles include sans, serif, mono, script, display and stencil. All of them are under open licenses (Apache-2.0 or OFL-1.1).',
  },
  {
    icon: 'stamp',
    title: 'Stencil and welded script',
    body: 'Stencil fonts keep the centers of letters like O attached when you cut them out. Weld joins touching script letters and keeps the text editable.',
  },
  {
    icon: 'file-type',
    title: 'Your own fonts',
    body: html`Add <code>.ttf</code> or <code>.otf</code> fonts, up to 10 MB each and 32 per
      project. They’re saved inside the project, so it opens the same way on another computer.
      KerfDesk doesn’t use the fonts installed on your system.`,
  },
  {
    icon: 'file-spreadsheet',
    title: 'Variable text',
    body: 'Fill in names and other data from a CSV file, plus serial numbers, dates and times, or cut settings. KerfDesk can step to the next row or number after each job or G-code save. Each job uses one row. Barcodes, QR codes and live databases aren’t supported.',
  },
];

export const IMAGES = [
  {
    icon: 'scan-line',
    title: 'Trace to vectors',
    body: 'Line Art is included in Free. Pro adds Smooth, Sharp, Centerline, Line + fill, Edge Detection, Photo shading and Colour layers. Centerline traces a pen stroke as a single line.',
  },
  {
    icon: 'files',
    title: 'Multi-file trace',
    body: 'Trace several images at once into separate SVG files, without changing your workspace.',
  },
  {
    icon: 'brush',
    title: 'Image Studio',
    body: 'Touch up an image before you trace or engrave it, with a brush, pencil, eraser, selection tools and crop. Adjustments, filters, retouching and layers aren’t built yet.',
    status: 'in-progress',
  },
  {
    icon: 'crop',
    title: 'Masks and crop',
    body: 'Use a closed vector shape as a mask for an image without changing its pixels. When you’re ready, bake the mask in and crop the image.',
  },
  {
    icon: 'mountain-snow',
    title: 'Engrave photos',
    href: '/laser/',
    body: 'On a laser, tune brightness, contrast and gamma, then engrave with 11 dither and grayscale options at 5 to 25 lines per mm. Run a test piece first.',
    status: 'shipped-code-and-tests',
  },
  {
    icon: 'file-image',
    title: 'Save the processed image',
    body: 'In laser mode, save an image as the processed PNG that KerfDesk will engrave, so you can look it over before you burn.',
  },
];

export const GENERATORS = [
  {
    icon: 'package',
    title: 'Box generator',
    pro: true,
    body: 'Make finger-jointed boxes (closed, open-top or slide-lid) with dividers and panel cutouts, as flat panels for a laser or CNC. No generated box has been cut and assembled yet, so check joint clearance on your own material with Box Fit Test strips first.',
    status: 'shipped-code-and-tests',
  },
  {
    icon: 'align-center-horizontal',
    title: 'Align, distribute and array',
    body: 'Line objects up, space them evenly, and make grid, circular or rotated arrays.',
  },
  {
    icon: 'puzzle',
    title: 'Quick Nest',
    body: 'Pack parts onto your material. Jobs of up to 32 shapes can be packed by their real outlines. Bigger or more complex jobs are packed as rectangles instead.',
  },
  {
    icon: 'grid-2x2-check',
    title: 'Material and interval tests',
    body: 'For lasers, create Material Test and Interval Test grids to find good settings for a new material. KerfDesk builds the pattern. The results depend on your machine and material.',
    status: 'shipped-code-and-tests',
  },
  {
    icon: 'library',
    title: 'Material libraries',
    body: 'Save your speed and power settings and reuse them. You can also import a LightBurn .clb cut library, which replaces your active library.',
  },
  {
    icon: 'crosshair',
    title: 'Registration Jig',
    body: 'For lasers: burn a box outline as a placement guide, set your workpiece inside it, then burn your artwork. Both runs are placed from the same box, so the art keeps its position relative to it.',
    status: 'shipped-code-and-tests',
  },
];

// The canvas switch: src/ui/gcode-inspector/CanvasGcodeView.tsx:1-5, CanvasViewSwitch.tsx:10.
export const PREVIEW_POINTS = [
  'Switch the canvas from Design to G-code 3D for a quick look at what the current design will run',
  'An estimated job time before you run, and the time remaining while it runs',
  html`Open any <code>.nc</code>, <code>.gcode</code> or <code>.tap</code> file in laser or CNC
    mode. It stays view-only and doesn’t become editable artwork.`,
  'Open the exact program you’re about to run',
  'A Program Health report that points out possible issues but never blocks Frame, Start or export',
];

export const CAMERA = [
  {
    icon: 'camera',
    title: 'Calibrate the lens',
    body: 'Use a printed checkerboard so KerfDesk can correct your camera’s lens distortion. Do this before you align the camera to your bed.',
    status: 'shipped-code-and-tests',
  },
  {
    icon: 'webcam',
    title: 'USB and network cameras',
    body: 'USB webcams can be used in the web app and the desktop app. Network cameras, both JPEG snapshot and RTSP, need the desktop app. RTSP also needs ffmpeg on your computer and hasn’t been qualified yet.',
  },
  {
    icon: 'flask-conical',
    title: 'Align to your bed',
    body: 'Automatic alignment burns a marker target and finds it with the camera. It’s an experiment that stays off until you turn it on in Tools > Labs. With a network camera in the desktop app, you can instead click the four bed corners by hand. Placement accuracy hasn’t been measured on a real machine, so run Frame to check where the job lands.',
    status: 'shipped-code-and-tests',
  },
];

// [file, what KerfDesk can do with it, notes]
export const FILE_ROWS = [
  [
    html`KerfDesk project <code>.lf2</code>`,
    'Open and save',
    'One file per project, with any custom fonts stored inside. Older project files upgrade automatically when you open them.',
  ],
  [
    html`SVG <code>.svg</code>`,
    'Import',
    'Cleaned by a sanitizer before it loads. Convert text to paths first: text and embedded images inside an SVG are skipped.',
  ],
  [
    html`DXF <code>.dxf</code>`,
    'Import',
    'Lines, circles, arcs, polylines, ellipses, splines and blocks. ASCII DXF only; binary DXF isn’t supported.',
  ],
  [
    html`<code>.png</code>, <code>.jpg</code>`,
    'Import',
    'Images to engrave or to trace into vectors.',
  ],
  [
    html`STL <code>.stl</code>`,
    'Import',
    html`A 3D model to carve as a CNC relief. ${statusPill('shipped-code-and-tests')}`,
  ],
  [
    html`Height map <code>.png</code>`,
    'Import',
    html`A grayscale PNG used as CNC relief depth. ${statusPill('in-progress')}`,
  ],
  [
    html`LightBurn project <code>.lbrn2</code>, <code>.lbrn</code>`,
    'Open, read only',
    'Opens with File → Open as a new KerfDesk project, bringing shapes plus each layer’s speed, power, passes and Line or Fill mode. Bitmaps and some text are dropped. Tested with real .lbrn2 files; older .lbrn files haven’t been tested.',
  ],
  [
    html`LightBurn cut library <code>.clb</code>`,
    'Import, read only',
    'Becomes your material library and replaces the active one.',
  ],
  [
    html`LightBurn device <code>.lbdev</code>`,
    'Import, read only',
    'Experimental, and for GRBL devices only. Imported in Machine Setup and shown for review before anything is applied. Not yet tested with a real LightBurn device file.',
  ],
  [
    html`Fonts <code>.ttf</code>, <code>.otf</code>`,
    'Import',
    'Stored inside the project. Up to 10 MB each and 32 per project.',
  ],
  [html`CSV <code>.csv</code>`, 'Import', 'Data for variable text. Each job uses one row.'],
  [
    html`G-code <code>.nc</code>, <code>.gcode</code>, <code>.tap</code>`,
    'View',
    'Opens in the G-code Inspector, part of Pro, for viewing only.',
  ],
  [
    html`G-code <code>.gcode</code>, <code>.nc</code>`,
    'Save',
    'Your job as a file you can run with the sender you prefer. Check it in a separate G-code viewer first.',
  ],
  [
    html`Traced SVG <code>.svg</code>`,
    'Save',
    'Multi-file trace saves traced images as SVG files.',
  ],
  [
    html`Processed image <code>.png</code>`,
    'Save',
    'The processed bitmap KerfDesk will engrave in laser Image mode.',
  ],
  [
    html`Material library <code>.lfml.json</code>`,
    'Open and save',
    'Your saved speed and power settings.',
  ],
  [
    html`Machine profile <code>.lfmachine.json</code>`,
    'Open and save',
    'A Machine Setup profile you can export and import.',
  ],
  [
    html`Ruida <code>.rd</code>`,
    'Save',
    html`Experimental and vectors only. No real Ruida controller has accepted one yet, so check it
    on scrap with the machine’s own preview first. ${statusPill('shipped-code-and-tests')}`,
  ],
];

export const MACHINE_TYPES = [
  {
    icon: 'zap',
    title: 'Laser',
    href: '/laser/',
    body: 'Line, Fill and Image modes, kerf compensation, holding tabs, Convert to Bitmap, rotary setup and a second pass for areas you want darker. Image engraving, rotary jobs and the second pass haven’t been run on a real machine yet.',
  },
  {
    icon: 'drill',
    title: 'CNC router',
    href: '/cnc/',
    body: 'Eight cut types from profile to V-carve and inlay, pocket clearing, holding tabs, touch-plate probing, a tool library, 3D reliefs from STL and a material-removal preview.',
    status: 'shipped-code-and-tests',
  },
];
