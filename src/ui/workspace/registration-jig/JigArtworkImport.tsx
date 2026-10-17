import { useEffect, useRef, useState } from 'react';
import type { SceneObject } from '../../../core/scene';
import { importSvgFiles } from '../../app/svg-import-action';
import { importImageFile } from '../../commands/import-image-action';
import { useToastStore } from '../../state/toast-store';

export function JigArtworkImport(props: {
  readonly onImport: (object: SceneObject) => void;
  readonly onBusyChange: (busy: boolean) => void;
}): JSX.Element {
  const alive = useRef(true);
  const pending = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      abort.current?.abort();
    };
  }, []);
  const importFiles = async (files: ReadonlyArray<File>): Promise<void> => {
    if (pending.current || files.length === 0) return;
    pending.current = true;
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    props.onBusyChange(true);
    const toast = useToastStore.getState().pushToast;
    try {
      for (const file of files) {
        if (!alive.current) break;
        if (file.name.toLowerCase().endsWith('.svg')) {
          await importSvgFiles(
            [file],
            (object) => {
              if (!alive.current) throw new DOMException('Import cancelled', 'AbortError');
              props.onImport(object);
              return { kind: 'added' };
            },
            toast,
          );
        } else {
          await importImageFile(
            file,
            (object) => {
              controller.signal.throwIfAborted();
              props.onImport(object);
              return { kind: 'added' };
            },
            toast,
            { signal: controller.signal },
          );
        }
      }
    } finally {
      pending.current = false;
      if (alive.current) {
        setBusy(false);
        props.onBusyChange(false);
      }
    }
  };
  return (
    <label className="lf-jig-import">
      Import artwork
      <input
        title="Import SVG or image artwork into the jig, fitted inside the selected outline"
        type="file"
        accept=".svg,.png,.jpg,.jpeg,.webp,.bmp"
        multiple
        disabled={busy}
        aria-label="Import jig artwork"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          void importFiles(files);
        }}
      />
    </label>
  );
}
