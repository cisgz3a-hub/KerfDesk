import type { Tutorial, TutorialVisual } from './tutorial-types';

type StudioTool = {
  readonly id: string;
  readonly name: string;
  readonly visual: TutorialVisual;
  readonly summary: string;
  readonly prepare: string;
  readonly gesture: string;
  readonly finish: string;
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
        title: `Choose ${tool.name}`,
        instruction: tool.prepare,
        focus: tool.name,
        result: 'The tool hint and options match the action you are about to take.',
      },
      {
        title: 'Make the geometry',
        instruction: tool.gesture,
        focus: 'Follow the drawing gesture',
        result: tool.summary,
      },
      {
        title: 'Inspect and apply',
        instruction: tool.finish,
        focus: 'Check → Apply',
        result: 'The checked drawing is ready to apply to the project.',
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
    name: 'Line',
    visual: 'line',
    summary: 'Create a straight segment between two points.',
    prepare:
      'Choose Line in the Studio creation toolbar. Turn on Snap if the endpoints should meet existing geometry.',
    gesture:
      'Click the start, then click the end. Hold Shift to constrain the line to a 45-degree direction.',
    finish:
      'Switch to Select and click the line. Inspect its dimensions, adjust an editable field if needed, then Apply when the drawing is ready.',
    tip: 'Use Polyline when you want several segments to form one connected path.',
  }),
  studioToolLesson({
    id: 'studio-path',
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
    name: 'Chamfer',
    visual: 'trim',
    summary: 'Replace a sharp corner with a straight bevel.',
    prepare:
      'Choose Chamfer and enter Distance in millimetres. This is the setback along each of the two adjoining edges.',
    gesture: 'Click the corner to flatten it. On a rectangle, the tool chamfers all four corners.',
    finish:
      'Inspect the bevel and the remaining edge lengths. Undo if it removes too much, reduce the distance and retry before Apply.',
    tip: 'Distance measures back along both legs of the corner. It is not the diagonal length of the new bevel.',
  }),
];
