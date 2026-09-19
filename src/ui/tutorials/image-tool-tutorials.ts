import type { Tutorial, TutorialVisual } from './tutorial-types';

type ImageToolLesson = {
  readonly id: string;
  readonly title: string;
  readonly location: string;
  readonly summary: string;
  readonly visual: TutorialVisual;
  readonly prepare: string;
  readonly action: string;
  readonly finish: string;
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
        title: 'Choose the area and tool',
        instruction: tool.prepare,
        focus: tool.location,
        result: 'The image is ready for the intended edit.',
      },
      {
        title: 'Make the edit',
        instruction: tool.action,
        focus: 'Edit the preview',
        result: tool.summary,
      },
      {
        title: 'Review and apply',
        instruction: tool.finish,
        focus: 'Inspect → Apply',
        result: 'The checked image can be committed to the project.',
      },
    ],
    tip: tool.tip,
    keywords: ['image', 'studio', ...tool.keywords],
    related: ['image-studio', 'image-layers', 'image-adjust'],
  };
}

export const IMAGE_TOOL_TUTORIALS: readonly Tutorial[] = [
  imageToolLesson({
    id: 'image-paint',
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
    title: 'Select part of an image',
    location: 'Marquee, Lasso or Magic wand',
    visual: 'image-select',
    summary: 'Restrict image edits to a chosen region.',
    prepare:
      'Choose Marquee for a rectangle or ellipse, Lasso for a freehand outline, or Magic wand for similar pixels. M cycles marquee shapes.',
    action:
      'Drag the marquee or lasso, or click with the wand. Shift adds to the selection and Alt subtracts. For the wand, tune Tolerance and Contiguous to control which pixels match.',
    finish:
      'Check the selection edge before Fill, Delete or an adjustment. Use Deselect when finished so your next edit can reach the whole image, then Apply to update the project.',
    tip: 'Invert selects the opposite region. The Modify controls grow, shrink or soften a selection by the entered pixel amount.',
    keywords: ['selection', 'marquee', 'lasso', 'wand', 'tolerance', 'invert'],
  }),
  imageToolLesson({
    id: 'image-fill',
    title: 'Fill areas and add gradients',
    location: 'Paint bucket or Gradient',
    visual: 'image-fill',
    summary: 'Fill a connected region or blend between two colours.',
    prepare:
      'Choose foreground and background colours. Select a region first if the fill should be limited to that area.',
    action:
      'With Paint bucket, click the region to fill and adjust Tolerance or Contiguous if the boundary is wrong. With Gradient, choose Linear or Radial and drag from foreground towards background.',
    finish:
      'Check that the fill has reached the intended area and preserved nearby detail. Undo and refine the selection if needed, then Apply.',
    tip: 'G cycles the bucket and gradient tools. A short gradient drag makes a faster tonal transition; a longer drag spreads it out.',
    keywords: ['bucket', 'fill', 'gradient', 'linear', 'radial', 'colour'],
  }),
  imageToolLesson({
    id: 'image-retouch',
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
    title: 'Move pixels and resize images',
    location: 'Move, free transform or Image menu',
    visual: 'image-transform',
    summary: 'Reposition image content or change its pixel dimensions.',
    prepare:
      'Select pixels and choose Move to reposition them. Use Ctrl+T for free transform of a selection or the image; inspect the transform before committing.',
    action:
      'Use transform handles to adjust the pixels, then Enter to commit or Escape to cancel. Image → Image Size resamples pixel dimensions while retaining workspace millimetres. Canvas Size changes the canvas without scaling its content.',
    finish:
      'For Image Size, keep Constrain proportions on to preserve the ratio. For Canvas Size, choose the anchor that should stay fixed. Click OK, inspect the result and Apply.',
    tip: 'Image Size changes pixel density, not the physical workspace size. Resize the artwork on the main canvas to change its millimetre dimensions.',
    keywords: ['move', 'transform', 'resize', 'image size', 'canvas size', 'scale'],
  }),
  imageToolLesson({
    id: 'image-text',
    title: 'Add lettering to an image',
    location: 'Text',
    visual: 'image-text',
    summary: 'Create text as pixels on a new image layer.',
    prepare:
      'Click Text in the Studio top bar or press T. Type the words in the dialog; Enter adds another line.',
    action:
      'Choose a bundled font, Size in pixels and black or white Ink. Click OK or press Ctrl+Enter to rasterise the lettering onto a new transparent layer.',
    finish:
      'Use Move or free transform to position the new lettering layer. Check its legibility at the final size and click Apply.',
    tip: 'Studio text becomes image pixels. Use the main workspace Text tool when you want editable vector lettering.',
    keywords: ['text', 'lettering', 'font', 'pixels', 'raster'],
  }),
  imageToolLesson({
    id: 'image-tone',
    title: 'Adjust tones and filter an image',
    location: 'Adjust or Filter',
    visual: 'image-tone',
    summary: 'Refine contrast, tonal detail or image texture inside the Studio.',
    prepare:
      'Choose an area first if only part should change. Open Adjust for Brightness / Contrast, Levels, Curves or Threshold, or open Filter for effects such as Gaussian Blur and Unsharp Mask.',
    action:
      'For a dialog-based effect, leave Preview enabled and make a small change. Levels sets tonal endpoints and gamma; Curves shapes tone with editable points. Threshold creates a black-and-white split.',
    finish:
      'Toggle Preview to compare. Use Reset to start again, Cancel to discard, or OK to keep the adjustment in the session. Click the Studio Apply button when the full image is ready.',
    tip: 'Invert and Desaturate apply immediately as an editor step. Undo can reverse them. Strong blur or sharpening can remove detail or create edge halos.',
    keywords: ['adjust', 'filter', 'levels', 'curves', 'threshold', 'blur', 'sharpen'],
  }),
];
