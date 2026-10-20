import { useCallback, useEffect, useRef, useState } from 'react';
import type { SceneObject } from '../../../core/scene';
import { importSvgFiles } from '../../app/svg-import-action';
import { importImageFile } from '../../commands/import-image-action';
import { Button } from '../../kit';
import { useToastStore } from '../../state/toast-store';
import type { JigImportPlacement } from './jig-editor-artwork';

export const JIG_ARTWORK_ACCEPT = '.svg,.png,.jpg,.jpeg,.webp,.bmp';
const JIG_ARTWORK_EXTENSIONS = JIG_ARTWORK_ACCEPT.split(',');

export type JigImportOptions = {
  /** Dropped on one outline: put the design on that piece only. */
  readonly onlyThisPiece?: boolean;
};

export type JigArtworkImporter = {
  readonly busy: boolean;
  /** Import files one by one; file N fits into the Nth outline from the anchor.
   *  One file goes on every piece unless it was dropped on one outline. */
  readonly importFiles: (
    files: ReadonlyArray<File>,
    anchorIds: ReadonlySet<string>,
    options?: JigImportOptions,
  ) => Promise<void>;
};

/** True for a file the jig editor can import (by extension, as the picker filters). */
export function isJigArtworkFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return JIG_ARTWORK_EXTENSIONS.some((extension) => name.endsWith(extension));
}

// One importer per editor, shared by the Import button and canvas drops, so a
// second batch cannot start while the first is still being added.
export function useJigArtworkImport(
  onImport: (object: SceneObject, placement: JigImportPlacement) => void,
  onBusyChange: (busy: boolean) => void,
): JigArtworkImporter {
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
  const importFiles = useCallback(
    async (
      files: ReadonlyArray<File>,
      anchorIds: ReadonlySet<string>,
      options: JigImportOptions = {},
    ): Promise<void> => {
      if (pending.current || files.length === 0) return;
      pending.current = true;
      const controller = new AbortController();
      abort.current = controller;
      setBusy(true);
      onBusyChange(true);
      const toast = useToastStore.getState().pushToast;
      let batchIndex = 0;
      const add = (object: SceneObject): { readonly kind: 'added' } => {
        // One file is one design for every piece; several fill one outline each,
        // and a file dropped on one outline stays on that piece (ADR-641).
        const copyToEveryOutline = files.length === 1 && options.onlyThisPiece !== true;
        onImport(object, { anchorIds, batchIndex, copyToEveryOutline });
        batchIndex += 1;
        return { kind: 'added' };
      };
      try {
        for (const file of files) {
          if (!alive.current) break;
          if (file.name.toLowerCase().endsWith('.svg')) {
            await importSvgFiles(
              [file],
              (object) => {
                if (!alive.current) throw new DOMException('Import cancelled', 'AbortError');
                return add(object);
              },
              toast,
            );
          } else {
            await importImageFile(
              file,
              (object) => {
                controller.signal.throwIfAborted();
                return add(object);
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
          onBusyChange(false);
        }
      }
    },
    [onImport, onBusyChange],
  );
  return { busy, importFiles };
}

/** The Import button of the jig's Add artwork row; drops on the canvas use
 *  the same importer. */
export function JigArtworkImport(props: {
  readonly busy: boolean;
  readonly onFiles: (files: ReadonlyArray<File>) => void;
}): JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        disabled={props.busy}
        title="Choose an SVG or image file to put on every piece, or several files for one piece each"
        onClick={() => input.current?.click()}
      >
        {props.busy ? 'Importing…' : 'Import…'}
      </Button>
      <input
        ref={input}
        hidden
        title="Import SVG or image artwork into the jig, fitted inside the outlines"
        type="file"
        accept={JIG_ARTWORK_ACCEPT}
        multiple
        disabled={props.busy}
        aria-label="Import jig artwork"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          props.onFiles(files);
        }}
      />
    </>
  );
}
