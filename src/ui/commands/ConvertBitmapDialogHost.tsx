import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ConvertToBitmapDialog,
  type ConvertToBitmapDialogOptions,
} from '../raster/ConvertToBitmapDialog';
import {
  bitmapConversionTarget,
  conversionSourceLabel,
  type ConvertibleVector,
} from '../raster/vector-to-bitmap';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { convertSelectedVectorsToBitmap } from './bitmap-conversion';

export function ConvertBitmapDialogHost(props: {
  readonly convertibles: ReadonlyArray<ConvertibleVector>;
  readonly onClose: () => void;
}): JSX.Element {
  const layers = useStore((state) => state.project.scene.layers);
  const epoch = useStore((state) => state.projectDocumentEpoch);
  const [openingEpoch] = useState(epoch);
  const convertToBitmap = useStore((state) => state.convertToBitmap);
  const pushToast = useToastStore((state) => state.pushToast);
  const active = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = useMemo(() => bitmapConversionTarget(props.convertibles), [props.convertibles]);
  const { onClose } = props;
  const sourceCount = props.convertibles.length;
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    [],
  );
  useEffect(() => {
    if (epoch !== openingEpoch || sourceCount === 0) onClose();
  }, [epoch, openingEpoch, sourceCount, onClose]);

  const onCancel = (): void => {
    active.current?.abort();
    active.current = null;
    props.onClose();
  };
  const onConvert = (options: ConvertToBitmapDialogOptions): void => {
    if (active.current !== null) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(null);
    void convertSelectedVectorsToBitmap(
      props.convertibles,
      layers,
      options,
      convertToBitmap,
      pushToast,
      controller.signal,
    ).then((outcome) => {
      if (active.current !== controller) return;
      active.current = null;
      setBusy(false);
      if (outcome.kind === 'converted' || outcome.kind === 'cancelled') props.onClose();
      else
        setError(
          outcome.kind === 'error'
            ? outcome.message
            : 'Artwork or cut settings changed. Review the settings and convert again.',
        );
    });
  };
  return (
    <ConvertToBitmapDialog
      sourceName={conversionSourceLabel(props.convertibles)}
      target={target}
      busy={busy}
      error={error}
      onCancel={onCancel}
      onConvert={onConvert}
    />
  );
}
