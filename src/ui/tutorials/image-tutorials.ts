import type { Tutorial } from './tutorial-types';

export const IMAGE_TUTORIALS: readonly Tutorial[] = [
  {
    id: 'image-studio',
    title: 'Edit pixels in Image Studio',
    summary: 'Clean up or paint an image, then apply the result to the project.',
    category: 'Images & tracing',
    machine: 'all',
    minutes: 3,
    location: 'Tools → Image Studio, or top toolbar Image Studio',
    prerequisites: 'Select an image, or choose an image file when the Studio opens.',
    visual: 'image',
    steps: [
      {
        title: 'Open the image',
        instruction:
          'Select a bitmap and open Image Studio. If no bitmap is selected, the command lets you import one. Zoom into the area you want to improve.',
        focus: 'Image Studio',
        result: 'The image opens in a separate pixel-editing session.',
      },
      {
        title: 'Choose a local edit',
        instruction:
          'Use Panels to show layers and history, then choose the layer to edit. Use Brush or Eraser for direct marks, a selection tool to isolate an area, or Adjust and Filter to change the active layer.',
        focus: 'Tool → options → image',
        result: 'The Studio previews your image edits before project output changes.',
      },
      {
        title: 'Apply the result',
        instruction:
          'Click Apply to update the project image, or Apply & Trace to update it and open Trace Image. Close returns to the workspace and keeps the editing session.',
        focus: 'Apply or Apply & Trace',
        result: 'Applied pixels are available to the project as one undo step.',
      },
    ],
    tip: 'Closing the Studio keeps pending edits in its session. Apply is the action that commits them to the project image.',
    keywords: ['image', 'studio', 'edit', 'paint', 'filter', 'adjust', 'history'],
    related: ['image-paint', 'image-select', 'image-layers', 'trace'],
  },
  {
    id: 'image-adjust',
    title: 'Prepare an image for engraving',
    summary: 'Compare the original picture with its processed image output.',
    category: 'Images & tracing',
    machine: 'laser',
    minutes: 3,
    location: 'Tools → Adjust Image',
    prerequisites: 'One selected bitmap with an Image operation.',
    visual: 'raster',
    steps: [
      {
        title: 'Compare source and processed',
        instruction:
          'Select the image and open Adjust Image. Look at the source beside the processed preview; try a preset as a starting point.',
        focus: 'Source and processed previews',
        result: 'You can judge changes against the original image.',
      },
      {
        title: 'Tune the important detail',
        instruction:
          'Adjust Brightness, Contrast and Gamma in small steps. Choose how the image is converted into dots or grayscale power with the dither control.',
        focus: 'Tone and dither',
        result: 'Important features remain visible in the processed preview.',
      },
      {
        title: 'Check density and apply',
        instruction:
          'Check Line Interval or DPI at the final image size, then click OK to keep the changes. Use Preview and a material test to assess the intended output.',
        focus: 'Line Interval · DPI · OK',
        result: 'The image adjustments and Image operation processing are updated.',
      },
    ],
    tip: 'Dithering turns tones into dot patterns. A screen preview cannot show the exact result on a particular material; keep notes from actual tests.',
    keywords: ['image', 'brightness', 'contrast', 'gamma', 'dither', 'dpi', 'engrave'],
    related: ['laser-image', 'image-studio', 'interval-test'],
  },
  {
    id: 'image-mask',
    title: 'Mask and crop an image',
    summary: 'Show an image through a vector outline, with the option to bake the crop.',
    category: 'Images & tracing',
    machine: 'all',
    minutes: 3,
    location: 'Tools → Apply Image Mask, Crop Image or Remove Image Mask',
    prerequisites: 'Exactly one image and one closed vector mask selected together.',
    visual: 'mask',
    steps: [
      {
        title: 'Place the mask outline',
        instruction:
          'Draw a closed shape over the area of the image you want to keep, such as a circle for a round photograph. Position the image and outline carefully.',
        focus: 'Image plus closed outline',
        result: 'The overlapping area defines the visible image region.',
      },
      {
        title: 'Apply a reversible mask',
        instruction:
          'Select the image and the closed vector shape together, then choose Apply Image Mask. Inspect the edge at a useful zoom.',
        focus: 'Apply Image Mask',
        result: 'The image is clipped to the vector geometry without baking the original pixels.',
      },
      {
        title: 'Keep, remove or bake it',
        instruction:
          'Select the masked image. Remove Image Mask restores the unmasked view. Crop Image bakes the mask into the pixels and trims the image bounds.',
        focus: 'Remove mask or Crop Image',
        result: 'You choose whether to retain an editable mask or a cropped bitmap.',
      },
    ],
    tip: 'Save a project copy before baking if you may need the full source later. A mask outline is different from an Image Studio pixel selection.',
    keywords: ['mask', 'crop', 'image', 'clip', 'circle', 'photo'],
    related: ['rectangle', 'ellipse', 'image-crop'],
  },
  {
    id: 'trace',
    title: 'Turn an image into paths',
    summary: 'Compare trace styles and make vector artwork from a bitmap.',
    category: 'Images & tracing',
    machine: 'all',
    minutes: 4,
    location: 'Tools → Trace Image, or top toolbar Trace Image',
    prerequisites: 'One selected bitmap. A clear, high-contrast source is easiest to learn with.',
    visual: 'trace',
    steps: [
      {
        title: 'Choose a trace style',
        instruction:
          'Open Trace Image. Try Line Art for logos or drawings, Smooth for quieter curves, or Sharp for fine details. Centerline follows the middle of strokes; outline styles follow their edges.',
        focus: 'Trace preset',
        result: 'The preview shows the kind of geometry the selected style produces.',
      },
      {
        title: 'Refine the preview',
        instruction:
          'Compare small holes and thin lines with the source. For Line Art, Smooth or Sharp, choose Detection → Manual brightness band when you need Cutoff and Threshold controls. Expand Curve finishing to adjust the outline; Centerline has no Curve finishing section.',
        focus: 'Refine detail',
        result: 'The preview preserves useful features while reducing unwanted marks.',
      },
      {
        title: 'Choose output and source retention',
        instruction:
          'Use Editable vectors for paths. Laser mode also offers Raster scan. Clear Delete image after trace if you want to keep the original for Re-trace Original later.',
        focus: 'Result and Delete image after trace',
        result: 'You decide both the output form and whether the source remains in the project.',
      },
      {
        title: 'Create and inspect',
        instruction:
          'Confirm the trace, then inspect it on the canvas and in Preview. Check that holes, outlines and operation settings match the intended result.',
        focus: 'Trace → inspect',
        result: 'The traced artwork is available for editing and output.',
      },
    ],
    tip: 'Centerline and outline tracing make different paths. Use Centerline for single-stroke linework; inspect closed regions before using a fill or pocket.',
    keywords: ['trace', 'bitmap', 'vector', 'centerline', 'threshold', 'outline', 'retrace'],
    related: ['image-studio', 'nodes', 'trace-batch', 'laser-fill'],
  },
  {
    id: 'trace-batch',
    title: 'Trace several image files',
    summary: 'Export a set of images as separate SVG files.',
    category: 'Images & tracing',
    machine: 'all',
    minutes: 3,
    location: 'Tools → Multi-File Trace',
    prerequisites: 'Several image files that suit the Line Art trace preset.',
    visual: 'trace',
    steps: [
      {
        title: 'Choose several files',
        instruction:
          'Open Multi-File Trace and select the image files to process. This workflow uses the Line Art preset for the batch.',
        focus: 'Multi-file picker',
        result: 'The selected sources are queued for vector conversion.',
      },
      {
        title: 'Save the SVG results',
        instruction:
          'Wait for processing, then complete the offered saves for the generated SVG files. Read the completion message and any notices.',
        focus: 'SVG export saves',
        result: 'Each saved result is a separate vector file.',
      },
      {
        title: 'Inspect before production',
        instruction:
          'Import an exported SVG to review its size, detail and contours. Use the single-image Trace Image workflow for a source that needs individual adjustments.',
        focus: 'Import and inspect SVG',
        result: 'The exported vectors can be checked before assigning operations.',
      },
    ],
    tip: 'Batch tracing exports files without changing the current workspace. It does not apply the individually tuned settings of a separate Trace Image dialog.',
    keywords: ['batch', 'multi-file', 'trace', 'svg', 'export'],
    related: ['trace', 'import', 'nodes'],
  },
];
