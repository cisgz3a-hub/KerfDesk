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
        instruction: `Choose ${shape.title} on the left drawing toolbar. Move the pointer to an empty area of the canvas.`,
        focus: shape.title,
        result: 'The selected tool is highlighted and ready to draw.',
      },
      {
        title: 'Draw its outline',
        instruction: shape.gesture,
        focus: 'Drag, then release',
        result:
          'The new shape is selected. The workspace returns to Select so you can position it.',
      },
      {
        title: 'Give it exact dimensions',
        instruction: shape.properties,
        focus: 'Artwork / Operations → Settings',
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
    summary: 'Choose artwork and position it accurately on the bed.',
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
          'Choose Select / transform, then click an object. Shift-click adds another object; dragging across empty canvas makes a selection box.',
        focus: 'Click or Shift-click',
        result: 'Selection handles identify the artwork you are about to change.',
      },
      {
        title: 'Move the selection',
        instruction:
          'Drag the centre arrows to move the selected artwork. Use the arrow keys for 1 mm nudges, or Shift plus an arrow for 10 mm.',
        focus: 'Centre move handle',
        result: 'The artwork moves without changing its shape or operation settings.',
      },
      {
        title: 'Resize or turn it',
        instruction:
          'Drag a size handle to resize, or a rotation handle to turn. The size drag keeps proportions by default; hold Shift to resize freely. Use the numeric transform fields for an exact position or size.',
        focus: 'Size and rotation handles',
        result: 'The selection fits the intended space on your material.',
      },
    ],
    tip: 'Alt-click cycles through overlapping objects. Undo with Ctrl+Z if you move the wrong item.',
    keywords: ['select', 'move', 'resize', 'rotate', 'group', 'duplicate', 'transform'],
    related: ['align', 'distribute', 'workspace'],
  },
  shapeLesson({
    id: 'rectangle',
    title: 'Draw rectangle',
    visual: 'rectangle',
    gesture:
      'Press at one corner, drag to the opposite corner, then release. Hold Shift for a square. Hold Ctrl or Command to draw outwards from the centre.',
    properties:
      'Keep the rectangle selected. In Settings, enter Width and Height in millimetres. Increase Corner radius for a rounded rectangle.',
    outcome: 'A precisely sized rectangle or rounded rectangle remains editable.',
    tip: 'Corner radius cannot exceed half the shorter side. A rotated rectangle also shows its larger footprint on the bed.',
  }),
  shapeLesson({
    id: 'ellipse',
    title: 'Draw ellipse',
    visual: 'ellipse',
    gesture:
      'Drag across the area the ellipse should occupy. Hold Shift to make a circle, or Ctrl or Command to expand it around the starting point.',
    properties:
      'Keep the ellipse selected and set Width and Height in Settings. Set both values equal when you need an exact circle.',
    outcome: 'A smooth ellipse or circle has the required overall width and height.',
    tip: 'For a 30 mm circle, set both width and height to 30 mm. These are full dimensions, not radii.',
  }),
  shapeLesson({
    id: 'polygon',
    title: 'Draw polygon',
    visual: 'polygon',
    gesture:
      'Drag to size the polygon and release. The starting shape has six sides. Hold Shift while dragging to keep the polygon regular.',
    properties:
      'In Settings, change Sides to the number of edges you need, then adjust Radius. For example, use 3 sides for a triangle or 8 for an octagon.',
    outcome: 'The outline updates to the chosen side count and size.',
    tip: 'The workspace Polygon tool is separate from Design Studio. Use the workspace tool for editable polygon side counts.',
  }),
  shapeLesson({
    id: 'star',
    title: 'Draw star',
    visual: 'star',
    gesture:
      'Drag to size a five-point star. Hold Shift while dragging for a regular star, then release.',
    properties:
      'In Settings, change Points and Outer radius. Adjust Inset to change the inner radius: a smaller percentage makes deeper gaps between the tips.',
    outcome: 'The star keeps editable point-count and inset controls.',
    tip: 'Try 5 points and 50% inset first. Very narrow tips may be difficult to manufacture at small sizes.',
  }),
  {
    id: 'polyline',
    title: 'Draw connected lines',
    summary: 'Click points to make an open line or a closed custom outline.',
    category: 'Drawing & editing',
    machine: 'all',
    minutes: 2,
    location: 'Left drawing toolbar → Draw polyline',
    prerequisites: 'An open project.',
    visual: 'polyline',
    steps: [
      {
        title: 'Start the path',
        instruction:
          'Choose Draw polyline or press Ctrl+L. Click once to place the first point, then move towards the next corner.',
        focus: 'First point',
        result: 'A live segment shows where the next line will go.',
      },
      {
        title: 'Add each corner',
        instruction:
          'Click for each new corner. Hold Shift to constrain the next segment to a 45-degree direction.',
        focus: 'Click the next point',
        result: 'Each click extends the connected path.',
      },
      {
        title: 'Choose open or closed',
        instruction:
          'Press Enter or double-click to finish an open path. To make a closed outline, place at least three points and click near the first point.',
        focus: 'Finish or return to start',
        result: 'The path is selected and ready for editing or an operation.',
      },
    ],
    tip: 'Use a closed outline when you want an enclosed fill or pocket. Escape cancels an unfinished path.',
    keywords: ['pen', 'polyline', 'line', 'closed', 'open', 'draw'],
    related: ['nodes', 'laser-fill', 'cnc-pocket'],
  },
  {
    id: 'nodes',
    title: 'Edit path nodes',
    summary: 'Change individual points and curves without moving the entire object.',
    category: 'Drawing & editing',
    machine: 'all',
    minutes: 3,
    location: 'Left drawing toolbar → Edit nodes',
    prerequisites:
      'Vector artwork on the canvas. Use Convert to Path first when you need plain path geometry.',
    visual: 'nodes',
    steps: [
      {
        title: 'Expose the points',
        instruction:
          'Select the vector artwork and choose Edit nodes. Zoom in so the small nodes are easy to distinguish.',
        focus: 'Edit nodes',
        result: 'The path points become visible for local editing.',
      },
      {
        title: 'Reshape one area',
        instruction:
          'Drag a node to reposition it. Shift-click nodes to select several, then drag a selected node to move them together. Curve handles change the bend between nodes.',
        focus: 'Node and curve handles',
        result: 'Only the selected part of the outline changes.',
      },
      {
        title: 'Refine a curve',
        instruction:
          'For a selected curve node, use Smooth or Corner. Curve and Line change its outgoing segment; Break opens a closed curve, and Join connects two selected open curve endpoints.',
        focus: 'Curve node actions',
        result: 'You control both the contour and whether its ends connect.',
      },
    ],
    tip: 'Node actions appear for supported curve nodes. Undo if the contour loses a hole or closes across a gap you intended to keep.',
    keywords: ['nodes', 'bezier', 'smooth', 'corner', 'curve', 'join', 'break'],
    related: ['convert', 'polyline', 'trace'],
  },
  {
    id: 'measure',
    title: 'Measure distance and angle',
    summary: 'Read a gap, diagonal or angle directly on the canvas.',
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
          'Select Measure or press Alt+M. Position the pointer at the first end of the distance.',
        focus: 'Measure',
        result: 'The next drag measures instead of moving artwork.',
      },
      {
        title: 'Drag between two points',
        instruction:
          'Press at the first point and drag to the second. Hold Shift to constrain the measurement to 45-degree directions.',
        focus: 'Start → end',
        result: 'A measurement line follows the pointer.',
      },
      {
        title: 'Read the dimensions',
        instruction:
          'Read the distance in millimetres, dx and dy for horizontal and vertical differences, and the angle. Return to Select when finished.',
        focus: 'Distance · dx · dy · angle',
        result: 'You know the spacing without adding cuttable geometry.',
      },
    ],
    tip: 'Measure shows design dimensions. It does not measure the physical material or compensate for kerf.',
    keywords: ['measure', 'ruler', 'distance', 'angle', 'dimensions'],
    related: ['select', 'design-precision'],
  },
];
