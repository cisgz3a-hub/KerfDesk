// The AppCommandContext slice for further LightBurn parity commands that are
// not layout: image and preview exports. Folded into the batch 5 slice so
// command-types.ts stays as it is; built by parity-tools-command-context.ts.

export type ParityToolsCommandContext = {
  readonly saveOriginalImage: () => void;
  readonly savePreviewImage: () => void;
};

export type ParityToolsCommandId = 'tools.save-original-image' | 'window.save-preview-image';
