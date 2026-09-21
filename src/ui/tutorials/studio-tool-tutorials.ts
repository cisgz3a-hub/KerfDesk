import type { Tutorial, TutorialVisual } from './tutorial-types';

type Stage = {
  readonly title: string;
  readonly result: string;
};

type StudioTool = {
  readonly id: string;
  readonly name: string;
  readonly visual: TutorialVisual;
  readonly summary: string;
  readonly prepare: string;
  readonly gesture: string;
  readonly finish: string;
  /** Named per tool: drawing an arc is not "making the geometry". */
  readonly stages: readonly [Stage, Stage, Stage];
  readonly tip: string;
};

function studioToolLesson(tool: StudioTool): Tutorial {
  return {
    id: tool.id,
    title: `Studio: ${tool.name}`,
    summary: tool.summary,
    category: 'Drawing & editing',
    machine: 'all',
    minutes: 2,
    location: `Design Studio → ${tool.name}`,
    prerequisites: 'Open Design Studio using Design on the workspace toolbar.',
    visual: tool.visual,
    steps: [
      {
        title: tool.stages[0].title,
        instruction: tool.prepare,
        focus: tool.name,
        result: tool.stages[0].result,
      },
      {
        title: tool.stages[1].title,
        instruction: tool.gesture,
        focus: 'Follow the drawing gesture',
        result: tool.stages[1].result,
      },
      {
        title: tool.stages[2].title,
        instruction: tool.finish,
        focus: 'Check → Apply',
        result: tool.stages[2].result,
      },
    ],
    tip: tool.tip,
    keywords: ['design', 'studio', tool.name.toLowerCase(), 'draw'],
    related: ['design-studio', 'design-precision', 'design-edit'],
  };
}

export const STUDIO_TOOL_TUTORIALS: readonly Tutorial[] = [
  studioToolLesson({
    id: 'studio-line',
    stages: [
      {
        title: 'Choose Line and set snapping',
        result: 'Endpoints will land where you intend, free or snapped.',
      },
      {
        title: 'Drag from start to end',
        result: 'A single straight segment exists between the two points.',
      },
      {
        title: 'Set an exact length or angle',
        result: 'The segment measures what the design requires, not what the drag gave.',
      },
    ],
    name: 'Line',
    visual: 'line',
    summary: 'Create a straight segment between two points.',
    prepare:
      'Choose Line in the Studio creation toolbar. Turn on Snap if the endpoints should meet existing geometry.',
    gesture:
      'Press at the start, keep the pointer held down while dragging to the end, then release. Hold Shift during the drag to constrain the line to a 45-degree direction.',
    finish:
      'Switch to Select and click the line. Enter an exact Length or Angle in the properties and press Enter, then Apply when the drawing is ready.',
    tip: 'Use Polyline when you want several segments to form one connected path.',
  }),
  studioToolLesson({
    id: 'studio-path',
    stages: [
      {
        title: 'Decide open or closed',
        result: 'You know whether this outline must enclose an area.',
      },
      { title: 'Click each corner in order', result: 'The corners join into one connected path.' },
      {
        title: 'Check the closing segment',
        result: 'The path ends exactly as intended, open or closed.',
      },
    ],
    name: 'Polyline',
    visual: 'polyline',
    summary: 'Create a connected outline from a series of clicked corners.',
    prepare:
      'Choose Polyline in the Studio. Decide whether the finished path needs to stay open or close back to its start.',
    gesture:
      'Click each corner in order. Double-click to finish an open path, or click the starting point to close the outline.',
    finish:
      'Inspect the final segment and any corners. Use Select to check the path, then Apply when the outline is ready.',
    tip: 'A closed path defines an enclosed area. An open path is useful for linework and does not enclose a pocket by itself.',
  }),
  studioToolLesson({
    id: 'studio-rectangle',
    stages: [
      {
        title: 'Choose Rectangle and a first corner',
        result: 'The starting corner is where you want it.',
      },
      {
        title: 'Drag to the opposite corner',
        result: 'A rectangle spans the two corners, square or free.',
      },
      {
        title: 'Type the exact width and height',
        result: 'The rectangle measures the size the material needs.',
      },
    ],
    name: 'Rectangle',
    visual: 'rectangle',
    summary: 'Create a rectangle from two opposite corners.',
    prepare: 'Choose Rectangle in the Studio. Place the pointer where the first corner belongs.',
    gesture:
      'Drag from one corner to the opposite corner and release. Hold Shift for a square, or Alt to draw from the centre.',
    finish:
      'Select the rectangle and enter exact width and height in its properties. Press Enter to apply the field, then Apply the drawing when ready.',
    tip: 'Use Fillet or Chamfer after drawing when all four rectangle corners need the same treatment.',
  }),
  studioToolLesson({
    id: 'studio-circle',
    stages: [
      {
        title: 'Choose Circle and its centre',
        result: 'The centre sits where the feature belongs.',
      },
      { title: 'Drag out to the rim', result: 'The drag distance has set the radius.' },
      {
        title: 'Confirm radius against diameter',
        result: 'The hole or disc is the size you meant, not twice it.',
      },
    ],
    name: 'Circle',
    visual: 'circle',
    summary: 'Create a circle by choosing its centre and radius.',
    prepare:
      'Choose Circle in the Studio. Use Snap if its centre must coincide with an existing point.',
    gesture:
      'Press at the centre, drag out to the rim and release. The distance from centre to rim establishes the radius.',
    finish:
      'Select the circle and inspect its radius or diameter in the properties. Enter the required editable dimension, then Apply the drawing when ready.',
    tip: 'Diameter is twice radius. Check the field label before entering a hole or disc size.',
  }),
  studioToolLesson({
    id: 'studio-arc',
    stages: [
      {
        title: 'Find the centre it turns about',
        result: 'You know which circle the arc is a part of.',
      },
      {
        title: 'Click centre, start, then sweep',
        result: 'The arc follows the sweep you traced, not the other way round.',
      },
      {
        title: 'Check which way it went',
        result: 'The arc covers the intended side of the circle.',
      },
    ],
    name: 'Arc',
    visual: 'arc',
    summary: 'Create part of a circle from a centre, start and end.',
    prepare:
      'Choose Arc in the Studio. Identify the centre of the circle that the arc will follow.',
    gesture:
      'Click the centre, click the arc start, then sweep the pointer around to the intended end and click again.',
    finish:
      'Inspect the sweep and endpoints. Select the arc to check its properties; undo and redraw if it goes around the wrong part of the circle. Apply when ready.',
    tip: 'An arc is open geometry. Check how it will meet adjacent lines if you need a closed outline.',
  }),
  studioToolLesson({
    id: 'studio-fillet',
    stages: [
      {
        title: 'Set a radius that will fit',
        result: 'The radius is small enough for the adjoining segments.',
      },
      {
        title: 'Click the corner to round',
        result: 'The sharp corner is replaced by a tangent curve.',
      },
      {
        title: 'Check the curve meets both edges',
        result: 'The rounding blends instead of leaving a step.',
      },
    ],
    name: 'Fillet',
    visual: 'fillet',
    summary: 'Replace a sharp corner with a rounded transition.',
    prepare:
      'Choose Fillet and enter Radius in millimetres in the options bar. Start with a radius small enough to fit the adjoining segments.',
    gesture:
      'Click the corner you want to round. On a rectangle, the fillet rounds all four corners.',
    finish:
      'Zoom in and check the curve meets the neighbouring edges. Adjust or undo if necessary, then Apply the drawing.',
    tip: 'A corner too short for the requested radius is left unchanged. Reduce the radius and try again.',
  }),
  studioToolLesson({
    id: 'studio-chamfer',
    stages: [
      {
        title: 'Clear any existing corner radius',
        result: 'The corner is sharp, so a bevel can be cut from it.',
      },
      {
        title: 'Click the corner to flatten',
        result: 'A straight bevel replaces the sharp corner.',
      },
      {
        title: 'Measure what the bevel removed',
        result: 'Enough edge remains on both legs of the corner.',
      },
    ],
    name: 'Chamfer',
    visual: 'trim',
    summary: 'Replace a sharp corner with a straight bevel.',
    prepare:
      'Choose a sharp rectangle or a polyline corner. If a rectangle is rounded, set its Corner radius to zero first. Choose Chamfer and enter Distance in millimetres.',
    gesture:
      'Click the corner to flatten it. A sharp rectangle becomes a closed path with all four corners chamfered; a polyline changes at the clicked corner.',
    finish:
      'Inspect the bevel and the remaining edge lengths. Undo if it removes too much, reduce the distance and retry before Apply.',
    tip: 'Distance measures back along both legs of the corner. It is not the diagonal length of the new bevel.',
  }),
];
