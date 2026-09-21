import type { Tutorial, TutorialVisual } from './tutorial-types';

type Stage = {
  /** What this step is called, in this lesson's own words. */
  readonly title: string;
  /** What the reader should be looking at when the step is done. */
  readonly result: string;
};

type ImageToolLesson = {
  readonly id: string;
  readonly title: string;
  readonly location: string;
  readonly summary: string;
  readonly visual: TutorialVisual;
  readonly prepare: string;
  readonly action: string;
  readonly finish: string;
  /** Named per lesson: nine Studio tools do not share three step titles. */
  readonly stages: readonly [Stage, Stage, Stage];
  readonly tip: string;
  readonly keywords: readonly string[];
};

function imageToolLesson(tool: ImageToolLesson): Tutorial {
  return {
    id: tool.id,
    title: tool.title,
    summary: tool.summary,
    category: 'Images & tracing',
    machine: 'all',
    minutes: 3,
    location: `Image Studio → ${tool.location}`,
    prerequisites: 'An image open in Image Studio.',
    visual: tool.visual,
    steps: [
      {
        title: tool.stages[0].title,
        instruction: tool.prepare,
        focus: tool.location,
        result: tool.stages[0].result,
      },
      {
        title: tool.stages[1].title,
        instruction: tool.action,
        focus: 'Work in the preview',
        result: tool.stages[1].result,
      },
      {
        title: tool.stages[2].title,
        instruction: tool.finish,
        focus: 'Inspect → Apply',
        result: tool.stages[2].result,
      },
    ],
    tip: tool.tip,
    keywords: ['image', 'studio', ...tool.keywords],
    related: ['image-studio', 'image-layers', 'image-adjust'].filter((id) => id !== tool.id),
  };
}

export const IMAGE_TOOL_TUTORIALS: readonly Tutorial[] = [
  imageToolLesson({
    id: 'image-paint',
    stages: [
      {
        title: 'Pick the layer and the mark',
        result: 'The tool and colour suit the kind of mark you want to make.',
      },
      {
        title: 'Set the brush, then drag',
        result: 'The stroke follows the size, hardness and opacity you chose.',
      },
      {
        title: 'Check the edge, then apply',
        result: 'The marks are committed to the project image.',
      },
    ],
    title: 'Paint, draw and erase pixels',
    location: 'Brush, Pencil, Eraser or Line',
    visual: 'image-paint',
    summary: 'Make controlled marks on the active image layer.',
    prepare:
      'Select the layer to edit. Choose Brush for a soft stroke, Pencil for a hard edge, or Line for a straight mark. Pick the foreground colour using the colour chip.',
    action:
      'Set Size, Hardness and Opacity in the tool options. Drag to paint; with Line, hold Shift for a 45-degree direction. Eraser clears upper layers and paints the background colour on the Background layer.',
    finish:
      'Inspect the edge at a useful zoom. Undo a poor stroke and try a smaller brush. Click Apply when the marks are ready for the project.',
    tip: 'Paint on a new transparent layer to keep the original image separate. Erasing a top layer can reveal the image beneath.',
    keywords: ['brush', 'pencil', 'line', 'eraser', 'paint', 'opacity'],
  }),
  imageToolLesson({
    id: 'image-select',
    stages: [
      {
        title: 'Choose how to outline it',
        result: 'The selection tool matches the shape of the region.',
      },
      {
        title: 'Draw it, then add or subtract',
        result: 'The outline covers exactly the pixels you meant.',
      },
      {
        title: 'Edit inside it, then deselect',
        result: 'Later edits can reach the whole layer again.',
      },
    ],
    title: 'Select part of an image',
    location: 'Marquee, Lasso or Magic wand',
    visual: 'image-select',
    summary: 'Restrict image edits to a chosen region.',
    prepare:
      'Choose Marquee for a rectangle or ellipse, Lasso for a freehand outline, or Magic wand for similar pixels. M cycles marquee shapes.',
    action:
      'Drag the marquee or lasso, or click with the wand. Once a selection exists, hold Shift before the next gesture to add, or Alt to subtract. Set wand Tolerance and Contiguous before clicking.',
    finish:
      'Check the selection edge, then perform the pixel edit you need. Use Deselect when finished so the next edit can reach the whole active layer. Apply commits pixel changes; selecting alone does not change the project.',
    tip: 'With no existing selection, Shift makes a square or circular marquee and Alt draws it from the centre. Invert selects the opposite region; Modify changes the selection by a pixel amount.',
    keywords: ['selection', 'marquee', 'lasso', 'wand', 'tolerance', 'invert'],
  }),
  imageToolLesson({
    id: 'image-fill',
    stages: [
      {
        title: 'Set the colours and the limit',
        result: 'The fill can only reach where you intend it to.',
      },
      {
        title: 'Click to flood, or drag a gradient',
        result: 'The region fills, or blends between the two colours.',
      },
      {
        title: 'Confirm the boundary held',
        result: 'The fill stopped where it should and nearby detail survived.',
      },
    ],
    title: 'Fill areas and add gradients',
    location: 'Paint bucket or Gradient',
    visual: 'image-fill',
    summary: 'Fill a connected region or blend between two colours.',
    prepare:
      'Choose the active layer and foreground and background colours. Select a region first if the fill should be limited to that area. The bucket finds its boundary from the visible composite and paints on the active layer.',
    action:
      'For Paint bucket, set Tolerance and Contiguous, then click the region. If the boundary is wrong, Undo, change the settings and click again. For Gradient, choose Linear or Radial and drag from foreground towards background.',
    finish:
      'Check that the fill has reached the intended area and preserved nearby detail. Undo and refine the selection if needed, then Apply.',
    tip: 'G cycles the bucket and gradient tools. A short gradient drag makes a faster tonal transition; a longer drag spreads it out.',
    keywords: ['bucket', 'fill', 'gradient', 'linear', 'radial', 'colour'],
  }),
  imageToolLesson({
    id: 'image-retouch',
    stages: [
      {
        title: 'Zoom in and size the brush',
        result: 'The brush is only slightly larger than the defect.',
      },
      {
        title: 'Sample clean pixels, then paint',
        result: 'The blemish is replaced with surrounding detail.',
      },
      {
        title: 'Look for repeated pattern',
        result: 'The repair reads as part of the image, not as a patch.',
      },
    ],
    title: 'Remove blemishes and clone detail',
    location: 'Clone stamp or Spot heal',
    visual: 'image-retouch',
    summary: 'Repair a small area using nearby image detail.',
    prepare:
      'Zoom in and select the layer containing the pixels. Choose a brush size slightly larger than the small defect you want to repair.',
    action:
      'With Clone stamp, Alt-click a clean source area and then paint where the copy should appear. With Spot heal, click the blemish so the surrounding pixels can patch it.',
    finish:
      'Inspect the repaired area and its edges. Undo and try a different source or smaller stroke if a repeated pattern becomes obvious. Apply when the repair looks right.',
    tip: 'Retouch a few small areas at a time. A large copied patch is more likely to produce visible repetition.',
    keywords: ['clone', 'stamp', 'heal', 'retouch', 'blemish', 'repair'],
  }),
  imageToolLesson({
    id: 'image-crop',
    stages: [
      {
        title: 'Decide what must survive',
        result: 'You know which content has to stay inside the new edge.',
      },
      {
        title: 'Drag the box and commit',
        result: 'The image is trimmed to the pixel dimensions shown.',
      },
      {
        title: 'Re-check the physical size',
        result: 'The millimetre size now follows the cropped area.',
      },
    ],
    title: 'Crop an image in the Studio',
    location: 'Crop',
    visual: 'image-crop',
    summary: 'Trim the image to a rectangular region.',
    prepare:
      'Choose Crop or press C. Decide which content must remain inside the new image boundary.',
    action:
      'Drag a crop box. Check the shown pixel dimensions, then press Enter or click Crop to commit. Escape cancels the pending crop box.',
    finish:
      'Inspect the trimmed image and its physical placement after Apply. Cropping keeps the same pixel density, so its millimetre dimensions change with the cropped area.',
    tip: 'Committing a crop clears the Studio tile history. Keep a project copy when you may need earlier pixel edits or the full image.',
    keywords: ['crop', 'trim', 'pixels', 'size', 'bounds'],
  }),
  imageToolLesson({
    id: 'image-layers',
    stages: [
      {
        title: 'Open Panels and pick a layer',
        result: 'The active layer is the one your edits will land on.',
      },
      {
        title: 'Add, paint and compare',
        result: 'Opacity and visibility let you weigh one version against another.',
      },
      {
        title: 'Reorder, then apply the composite',
        result: 'The stack reads top-down as the project image.',
      },
    ],
    title: 'Build an image with layers',
    location: 'Panels → Layers',
    visual: 'image-layers',
    summary: 'Separate image edits so you can reorder and compare them.',
    prepare:
      'Click Panels to show Layers and History. Click a layer row to make it the active paint layer.',
    action:
      'Use + to add a transparent layer above the active one, or duplicate a layer. Paint on the active layer, change its opacity and toggle visibility to compare the effect.',
    finish:
      'Drag rows or use the up and down controls to change stacking. Merge down only when you want to combine layers. Apply commits the visible composite to the project image.',
    tip: 'Studio image layers organise pixels. Artwork / Operations in the main workspace controls machine processes.',
    keywords: ['layers', 'opacity', 'blend', 'history', 'stack', 'merge'],
  }),
  imageToolLesson({
    id: 'image-transform',
    stages: [
      {
        title: 'Choose the pixels to move',
        result: 'The transform will act on exactly the pixels you selected.',
      },
      {
        title: 'Drag the handles, or resize',
        result: 'Content moves, or the pixel dimensions change.',
      },
      {
        title: 'Hold the ratio and the anchor',
        result: 'The result keeps its proportions and the side you meant to fix.',
      },
    ],
    title: 'Move pixels and resize images',
    location: 'Move, free transform or Image menu',
    visual: 'image-transform',
    summary: 'Reposition image content or change its pixel dimensions.',
    prepare:
      'Choose the active layer. Select pixels, then choose Move and drag to reposition them. Ctrl+A selects the whole layer. Ctrl+T starts free transform of the selection, or the whole active layer when nothing is selected.',
    action:
      'Use transform handles to adjust the pixels, then Enter to commit or Escape to cancel. Image → Image Size resamples pixel dimensions while retaining workspace millimetres. Canvas Size changes the canvas without scaling its content.',
    finish:
      'For Image Size, keep Constrain proportions on to preserve the ratio. For Canvas Size, choose the anchor that should stay fixed. Click OK, inspect the result and Apply.',
    tip: 'Image Size retains the physical size; Canvas Size changes the extent at the same pixel density. Both resize every Studio layer and clear its pixel-edit history. Revert restores the as-opened image at the current resolution.',
    keywords: ['move', 'transform', 'resize', 'image size', 'canvas size', 'scale'],
  }),
  imageToolLesson({
    id: 'image-text',
    stages: [
      { title: 'Open Text and type the words', result: 'The lettering is ready to be rasterised.' },
      {
        title: 'Choose font, size and ink',
        result: 'The words land as pixels on their own transparent layer.',
      },
      {
        title: 'Place it and check legibility',
        result: 'The lettering still reads at the size it will be made.',
      },
    ],
    title: 'Add lettering to an image',
    location: 'Text',
    visual: 'image-text',
    summary: 'Create text as pixels on a new image layer.',
    prepare:
      'Click Text in the Studio top bar or press T. Type the words in the dialog; Enter adds another line.',
    action:
      'Choose a bundled font, Size in pixels and black or white Ink. Click OK or press Ctrl+Enter to rasterise the lettering onto a new transparent layer.',
    finish:
      'Keep the new lettering layer active. Press Ctrl+A to select it, then choose Move and drag, or use Ctrl+T for free transform and Enter to commit. Check its legibility at the final size and click Apply.',
    tip: 'Studio text becomes image pixels. Use the main workspace Text tool when you want editable vector lettering.',
    keywords: ['text', 'lettering', 'font', 'pixels', 'raster'],
  }),
  imageToolLesson({
    id: 'image-tone',
    stages: [
      {
        title: 'Choose the layer and the area',
        result: 'The adjustment is aimed at the pixels you meant to change.',
      },
      {
        title: 'Make a small change, Preview on',
        result: 'You can see the effect before committing to it.',
      },
      {
        title: 'Compare, then keep or discard',
        result: 'Only the adjustment you actually wanted survives.',
      },
    ],
    title: 'Adjust tones and filter an image',
    location: 'Adjust or Filter',
    visual: 'image-tone',
    summary: 'Refine contrast, tonal detail or image texture inside the Studio.',
    prepare:
      'Choose the layer to edit and select an area if only part should change. Adjust and Filter affect that active layer. Open Adjust for Brightness / Contrast, Levels, Curves or Threshold, or Filter for Gaussian Blur and Unsharp Mask.',
    action:
      'For a dialog-based effect, leave Preview enabled and make a small change. Levels sets tonal endpoints and gamma; Curves shapes tone with editable points. Threshold creates a black-and-white split.',
    finish:
      'Toggle Preview to compare. Use Reset to start again, Cancel to discard, or OK to keep the adjustment in the session. Click the Studio Apply button when the full image is ready.',
    tip: 'Invert and Desaturate apply immediately as an editor step. Undo can reverse them. Strong blur or sharpening can remove detail or create edge halos.',
    keywords: ['adjust', 'filter', 'levels', 'curves', 'threshold', 'blur', 'sharpen'],
  }),
];
