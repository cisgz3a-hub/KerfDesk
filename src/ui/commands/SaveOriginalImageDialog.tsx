// Save Original Image: choose PNG, JPEG or BMP, then pick where to save the
// selected image's own pixels (see app/save-original-image.ts).

import { useState } from 'react';
import { create } from 'zustand';
import type { RasterImage } from '../../core/scene';
import { saveOriginalImage, type OriginalImageFormat } from '../app/save-original-image';
import { usePlatform } from '../app/platform-context';
import { Button, Dialog, DialogActions } from '../kit';
import { useToastStore } from '../state/toast-store';

type State = {
  readonly image: RasterImage | null;
  readonly open: (image: RasterImage) => void;
  readonly close: () => void;
};

export const useSaveOriginalImageStore = create<State>((set) => ({
  image: null,
  open: (image) => set({ image }),
  close: () => set({ image: null }),
}));

export function SaveOriginalImageDialogHost(): JSX.Element | null {
  const image = useSaveOriginalImageStore((state) => state.image);
  return image === null ? null : <SaveOriginalImageDialog image={image} />;
}

function SaveOriginalImageDialog(props: { readonly image: RasterImage }): JSX.Element {
  const close = useSaveOriginalImageStore((state) => state.close);
  const platform = usePlatform();
  const pushToast = useToastStore((state) => state.pushToast);
  const [format, setFormat] = useState<OriginalImageFormat>(initialFormat(props.image));
  return (
    <Dialog
      title="Save Original Image"
      size="sm"
      onClose={close}
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        close();
        void saveOriginalImage({ platform, image: props.image, format, pushToast });
      }}
    >
      <p className="lf-dialog-body">
        Saves {props.image.source} as it is in the project, before any operation's dithering,
        adjustments or mask. Use Save Processed Bitmap for what the laser engraves.
      </p>
      <label className="lf-field">
        <span>Format</span>
        <select
          className="lf-input"
          aria-label="Image format"
          value={format}
          onChange={(event) => setFormat(event.currentTarget.value as OriginalImageFormat)}
        >
          <option value="png">PNG (lossless)</option>
          <option value="jpeg">JPEG</option>
          <option value="bmp">BMP</option>
        </select>
      </label>
      <DialogActions>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" type="submit">
          Save...
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function initialFormat(image: RasterImage): OriginalImageFormat {
  const mime = image.imageAsset?.sourceMimeType ?? /^data:([^;,]+)/u.exec(image.dataUrl ?? '')?.[1];
  if (mime === 'image/jpeg') return 'jpeg';
  if (mime === 'image/bmp') return 'bmp';
  return 'png';
}
