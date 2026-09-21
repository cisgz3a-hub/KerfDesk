import type { Tutorial, TutorialVisual } from './tutorial-types';

type ShapeLesson = {
  readonly id: string;
  readonly title: string;
  readonly visual: TutorialVisual;
  readonly gesture: string;
  readonly properties: string;
  readonly outcome: string;
  readonly tip: string;
};

function shapeLesson(shape: ShapeLesson): Tutorial {
  return {
    id: shape.id,
    title: shape.title,
    summary: shape.outcome,
    category: 'Drawing & editing',
    machine: 'all',
    minutes: 2,
    location: 'Left drawing toolbar → drawing tool',
    prerequisites: 'An open project with room on the canvas.',
    visual: shape.visual,
    steps: [
      {
        title: 'Choose the shape',
        instruction: `Choose ${shape.title} on the left toolbar. Find an empty area of the canvas.`,
        focus: shape.title,
        result: 'The tool is ready to draw.',
      },
      {
        title: 'Draw its outline',
        instruction: shape.gesture,
        focus: 'Drag, then release',
        result: 'The new shape is selected and ready to move.',
      },
      {
        title: 'Set the size',
        instruction: shape.properties,
        focus: 'Artwork / Operations → Settings → Artwork',
        result: shape.outcome,
      },
    ],
    tip: shape.tip,
    keywords: [shape.id, 'draw', 'shape', 'size', 'geometry'],
    related: ['select', 'operations', 'nodes'],
  };
}

export const DRAWING_TUTORIALS: readonly Tutorial[] = [
  {
    id: 'select',
    title: 'Select, move and resize',
    summary: 'Choose an object, move it and change its size.',
    category: 'Drawing & editing',
    machine: 'all',
    minutes: 3,
    location: 'Left drawing toolbar → Select / transform',
    prerequisites: 'At least one unlocked object on the canvas.',
    visual: 'select',
    steps: [
      {
        title: 'Pick the artwork',
        instruction:
          'Choose Select / transform. Click an object to select it. Hold Shift while clicking to add another object.',
        focus: 'Click or Shift-click',
        result: 'Handles appear around the selected artwork.',
      },
      {
        title: 'Move the selection',
        instruction:
          'Drag the centre arrows to move the artwork. Use the arrow keys to move it 1 mm at a time.',
        focus: 'Centre move handle',
        result: 'The artwork moves to its new position.',
      },
      {
        title: 'Resize or turn it',
        instruction:
          'Drag a corner handle to change the size while keeping the proportions. Drag a rotation handle to turn the artwork.',
        focus: 'Size and rotation handles',
        result: 'The artwork has the size and angle you want.',
      },
    ],
    tip: 'Use the numeric transform fields for an exact size or position. Ctrl+Z undoes the last change.',
    keywords: ['select', 'move', 'resize', 'rotate', 'group', 'duplicate', 'transform'],
    related: ['align', 'distribute', 'workspace'],
  },
  shapeLesson({
    id: 'rectangle',
    title: 'Draw rectangle',
    visual: 'rectangle',
    gesture:
      'Drag from one corner to the opposite corner. Release to finish. Hold Shift while dragging to make a square.',
    properties:
      'Keep the rectangle selected. In Settings → Artwork, enter Width and Height. Increase Corner radius if you want rounded corners.',
    outcome: 'A rectangle with the width and height you need.',
    tip: 'Width and Height are in millimetres. Corner radius cannot exceed half the shorter side.',
  }),
  shapeLesson({
    id: 'ellipse',
    title: 'Draw ellipse',
    visual: 'ellipse',
    gesture:
      'Drag across the space where you want the ellipse. Hold Shift to make a circle. Release to finish.',
    properties:
      'Keep the ellipse selected. In Settings → Artwork, enter Width and Height. Use the same value for both to make a circle.',
    outcome: 'An oval or circle in the size you need.',
    tip: 'For a 30 mm circle, set Width and Height to 30 mm.',
  }),
  shapeLesson({
    id: 'polygon',
    title: 'Draw polygon',
    visual: 'polygon',
    gesture: 'Drag to draw a six-sided shape. Hold Shift to keep it regular. Release to finish.',
    properties:
      'In Settings → Artwork, enter the number of Sides. Use 3 for a triangle or 8 for an octagon. Change Radius to set the size.',
    outcome: 'A shape with the number of sides you need.',
    tip: 'The workspace Polygon tool is separate from Design Studio. Use the workspace tool for editable polygon side counts.',
  }),
  shapeLesson({
    id: 'star',
    title: 'Draw star',
    visual: 'star',
    gesture: 'Drag to draw a five-point star. Hold Shift to keep it regular. Release to finish.',
    properties:
      'In Settings → Artwork, change Points and Outer radius. Lower Inset to make deeper gaps between the tips.',
    outcome: 'A star with the points and size you choose.',
    tip: 'Try 5 points and 50% inset first. Very narrow tips may be difficult to manufacture at small sizes.',
  }),
  {
    id: 'polyline',
    title: 'Draw connected lines',
    summary: 'Click to draw connected lines or a closed outline.',
    category: 'Drawing & editing',
    machine: 'all',
    minutes: 2,
    location: 'Left drawing toolbar → Draw polyline',
    prerequisites: 'An open project.',
    visual: 'polyline',
    steps: [
      {
        title: 'Start the path',
        instruction: 'Choose Draw polyline. Click on the canvas to place the first point.',
        focus: 'First point',
        result: 'A live segment shows where the next line will go.',
      },
      {
        title: 'Add each corner',
        instruction: 'Click each new corner. Hold Shift to keep the line in a 45-degree direction.',
        focus: 'Click the next point',
        result: 'Each click extends the connected path.',
      },
      {
        title: 'Choose open or closed',
        instruction:
          'Press Enter to finish an open path. For a closed outline, add at least three points and click near the first point.',
        focus: 'Finish or return to start',
        result: 'Your path is selected and ready to use.',
      },
    ],
    tip: 'Use a closed outline when you want an enclosed fill or pocket. Escape cancels an unfinished path.',
    keywords: ['pen', 'polyline', 'line', 'closed', 'open', 'draw'],
    related: ['nodes', 'laser-fill', 'cnc-pocket'],
  },
  {
    id: 'nodes',
    title: 'Edit path nodes',
    summary: 'Move the points that make up a line or curve.',
    category: 'Drawing & editing',
    machine: 'all',
    minutes: 3,
    location: 'Left drawing toolbar → Edit nodes',
    prerequisites:
      'Vector artwork on the canvas. Use Convert to Path first when you need plain path geometry.',
    visual: 'nodes',
    steps: [
      {
        title: 'Show the points',
        instruction:
          'Select the artwork. Choose Edit nodes. Zoom in until you can see the individual points.',
        focus: 'Edit nodes',
        result: 'You can see the points along the path.',
      },
      {
        title: 'Reshape one area',
        instruction:
          'Drag a point to move it. Drag a curve handle to change the bend. Shift-click points to select several at once.',
        focus: 'Node and curve handles',
        result: 'Only the selected part of the outline changes.',
      },
      {
        title: 'Change a curve',
        instruction:
          'Select a curve point. Choose Smooth or Corner to change how the lines meet. Choose Curve or Line to change the next section.',
        focus: 'Curve node actions',
        result: 'The path has the shape you want.',
      },
    ],
    tip: 'These controls appear for supported curve points. Break opens a closed curve. Join connects two selected open curve ends.',
    keywords: ['nodes', 'bezier', 'smooth', 'corner', 'curve', 'join', 'break'],
    related: ['convert', 'polyline', 'trace'],
  },
  {
    id: 'measure',
    title: 'Measure distance and angle',
    summary: 'Check a distance or angle on the canvas.',
    category: 'Drawing & editing',
    machine: 'all',
    minutes: 2,
    location: 'Left drawing toolbar → Measure, or Tools → Measure',
    prerequisites: 'An open project; zoom in for small details.',
    visual: 'measure',
    steps: [
      {
        title: 'Choose the ruler',
        instruction:
          'Choose Measure. Move the pointer to the point where you want to start measuring.',
        focus: 'Measure',
        result: 'The next drag measures instead of moving artwork.',
      },
      {
        title: 'Drag between two points',
        instruction:
          'Drag from the first point to the second. Hold Shift to measure in a 45-degree direction.',
        focus: 'Start → end',
        result: 'A measurement line follows the pointer.',
      },
      {
        title: 'Read the dimensions',
        instruction:
          'Read the distance in millimetres and the angle. dx is the horizontal distance; dy is the vertical distance. Return to Select when finished.',
        focus: 'Distance · dx · dy · angle',
        result: 'You can check the gap without adding artwork.',
      },
    ],
    tip: 'Measure shows design dimensions. It does not measure the physical material or compensate for kerf.',
    keywords: ['measure', 'ruler', 'distance', 'angle', 'dimensions'],
    related: ['select', 'design-precision'],
  },
];
