import { disabled, enabled, type AppCommand, type AppCommandContext } from './command-types';

type RasterToolCommandId =
  | 'tools.adjust-image'
  | 'tools.save-processed-bitmap'
  | 'tools.trace-image';

export function adjustImageCommand(ctx: AppCommandContext): AppCommand {
  return rasterToolCommand(ctx, 'tools.adjust-image', 'Adjust Image...', 'Adjust selected image');
}

export function processedRasterToolCommands(ctx: AppCommandContext): ReadonlyArray<AppCommand> {
  return [
    rasterToolCommand(
      ctx,
      'tools.save-processed-bitmap',
      'Save Processed Bitmap...',
      'Save selected image after layer processing',
    ),
    rasterToolCommand(ctx, 'tools.trace-image', 'Trace Image...', 'Trace selected image'),
    retraceOriginalCommand(ctx),
  ];
}

function retraceOriginalCommand(ctx: AppCommandContext): AppCommand {
  return ctx.canRetraceOriginal
    ? enabled(
        'tools.retrace-original',
        'tools',
        'Re-trace Original...',
        'Re-open Trace Image from the selected trace source raster',
        ctx.retraceOriginal,
      )
    : disabled(
        'tools.retrace-original',
        'tools',
        'Re-trace Original...',
        'Select a traced image whose original raster is still in the project.',
        ctx.retraceOriginal,
      );
}

function rasterToolCommand(
  ctx: AppCommandContext,
  id: RasterToolCommandId,
  label: string,
  title: string,
): AppCommand {
  const invoke = rasterToolInvoke(ctx, id);
  return ctx.hasRasterSelection
    ? enabled(id, 'tools', label, title, invoke)
    : disabled(id, 'tools', label, 'Select an image first.', invoke);
}

function rasterToolInvoke(ctx: AppCommandContext, id: RasterToolCommandId): () => void {
  switch (id) {
    case 'tools.adjust-image':
      return ctx.adjustImage;
    case 'tools.save-processed-bitmap':
      return ctx.saveProcessedBitmap;
    case 'tools.trace-image':
      return ctx.traceImage;
  }
}
