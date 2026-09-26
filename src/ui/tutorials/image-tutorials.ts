import type { Tutorial } from './tutorial-types';

export const IMAGE_TUTORIALS: readonly Tutorial[] = [
  {
    id: 'image-studio',
    title: 'Edit pixels in Image Studio',
    summary: 'Touch up a picture and save the changes to your project.',
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
          'Select a picture and open Image Studio. If no picture is selected, choose one to import. Zoom in on the area you want to edit.',
        focus: 'Image Studio',
        result: 'Your picture opens in Image Studio.',
      },
      {
        title: 'Edit the picture',
        instruction:
          'Use Panels to show the layers. Choose the layer to edit. Use Brush to paint or Eraser to remove marks.',
        focus: 'Tool → options → image',
        result: 'You can see your changes in Image Studio.',
      },
      {
        title: 'Apply the result',
        instruction:
          'Click Apply to update the project picture. Use Apply & Trace if you want to trace it next. Click Close to return to the workspace.',
        focus: 'Apply or Apply & Trace',
        result: 'The project picture includes your applied changes.',
      },
    ],
    tip: 'Close keeps your edits in Image Studio. Click Apply to use them in the project.',
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
    summary: 'Use a shape to choose which part of a picture is visible.',
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
          'Draw a closed shape over the part of the picture you want to keep. For example, use a circle for a round photo.',
        focus: 'Image plus closed outline',
        result: 'The shape marks the part of the picture to keep.',
      },
      {
        title: 'Apply a reversible mask',
        instruction:
          'Select the picture and shape together. Choose Apply Image Mask. Zoom in to check the edge.',
        focus: 'Apply Image Mask',
        result: 'The picture appears inside the shape. The original pixels are kept.',
      },
      {
        title: 'Keep the mask or crop',
        instruction:
          'Select the masked picture. Remove Image Mask shows the full picture again. Crop Image applies the crop to the pixels.',
        focus: 'Remove mask or Crop Image',
        result: 'You can keep the mask or make a cropped picture.',
      },
    ],
    tip: 'Save a project copy before using Crop Image if you may need the full picture later.',
    keywords: ['mask', 'crop', 'image', 'clip', 'circle', 'photo'],
    related: ['rectangle', 'ellipse', 'image-crop'],
  },
  {
    id: 'trace',
    title: 'Turn an image into paths',
    summary: 'Make editable outlines from a picture.',
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
          'Open Trace Image. Start with Line Art for a logo or drawing. Try Smooth for smoother outlines or Sharp to keep fine detail.',
        focus: 'Trace preset',
        result: 'The preview shows the traced outlines.',
      },
      {
        title: 'Refine the preview',
        instruction:
          'Check small holes and thin lines in the preview. For Line Art, Smooth or Sharp, choose Detection → Manual brightness band to adjust Cutoff and Threshold.',
        focus: 'Refine detail',
        result: 'You can check which details the trace keeps.',
      },
      {
        title: 'Keep editable paths',
        instruction:
          'In laser mode, choose Editable vectors; CNC already uses vectors. Clear Delete Image After trace to keep the picture for Re-trace Original later.',
        focus: 'Result and Delete Image After trace',
        result: 'The trace will be editable and the original picture will stay.',
      },
      {
        title: 'Create and inspect',
        instruction:
          'Click Trace. Check the outlines and holes on the canvas. Open Preview to check the paths and operation settings.',
        focus: 'Trace → inspect',
        result: 'Your traced paths are ready to edit.',
      },
    ],
    tip: 'Centerline follows the middle of each stroke. Other styles trace outlines. Check that regions are closed before using a fill or pocket.',
    keywords: ['trace', 'bitmap', 'vector', 'centerline', 'threshold', 'outline', 'retrace'],
    related: ['image-studio', 'nodes', 'trace-batch', 'laser-fill'],
  },
  {
    id: 'trace-batch',
    title: 'Trace several image files',
    summary: 'Export a set of images as separate SVG or DXF files.',
    category: 'Images & tracing',
    machine: 'all',
    minutes: 3,
    location: 'Tools → Multi-File Trace',
    prerequisites: 'Several image files that suit one trace preset.',
    visual: 'trace',
    steps: [
      {
        title: 'Choose several files',
        instruction:
          'Open Multi-File Trace, pick the preset, format and precision for the batch, then choose the image files to process.',
        focus: 'Multi-file picker',
        result: 'The selected sources are queued for vector conversion.',
      },
      {
        title: 'Save the results',
        instruction:
          'Wait for processing, then complete the offered saves for the generated files. Read the completion message: images with nothing to trace are skipped and named there.',
        focus: 'Export saves',
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
