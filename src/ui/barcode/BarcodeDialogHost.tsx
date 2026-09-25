// BarcodeDialogHost — mounts the barcode dialog for the open request
// (ADR-386). Inserting starts from the last inserted settings; editing starts
// from the selected barcode and closes itself if that barcode disappears.

import { useEffect, useMemo } from 'react';
import {
  defaultBarcodeSpec,
  isBarcodeObject,
  type BarcodeObject,
  type BarcodeShape,
} from '../../core/barcode';
import { IDENTITY_TRANSFORM, type SceneObject, type ShapeObject } from '../../core/scene';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { useBarcodeDialogStore, type BarcodeDialogRequest } from './barcode-dialog-store';
import { BarcodeDialog } from './BarcodeDialog';
import { commitBarcode } from './commit-barcode';

export function BarcodeDialogHost(): JSX.Element | null {
  const request = useBarcodeDialogStore((s) => s.request);
  if (request === null) return null;
  return (
    <OpenBarcodeDialog
      key={request.mode === 'edit' ? request.objectId : 'insert'}
      request={request}
    />
  );
}

function OpenBarcodeDialog(props: { readonly request: BarcodeDialogRequest }): JSX.Element | null {
  const close = useBarcodeDialogStore((s) => s.close);
  const lastInserted = useBarcodeDialogStore((s) => s.lastInserted);
  const rememberInserted = useBarcodeDialogStore((s) => s.rememberInserted);
  const project = useStore((s) => s.project);
  const pushToast = useToastStore((s) => s.pushToast);
  const editing = editedBarcode(props.request, project.scene.objects);
  const missing = props.request.mode === 'edit' && editing === undefined;
  useEffect(() => {
    if (missing) close();
  }, [missing, close]);
  // Fixed for the dialog's lifetime: later insertions must not reset the form.
  const initial = useMemo(
    () => editing?.spec ?? lastInserted ?? defaultBarcodeSpec('qr'),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seeded once on open.
    [],
  );
  const standIn = useMemo(() => standInObject(initial), [initial]);
  if (missing) return null;
  return (
    <BarcodeDialog
      mode={editing === undefined ? 'insert' : 'edit'}
      initial={initial}
      project={project}
      subject={editing ?? standIn}
      onCancel={close}
      onSubmit={async (spec, value) => {
        const result = await commitBarcode({ spec, value, ...(editing ? { editing } : {}) });
        if (!result.ok) return result.message;
        if (editing === undefined) rememberInserted(spec);
        close();
        pushToast(result.message, 'success');
        return null;
      }}
    />
  );
}

function editedBarcode(
  request: BarcodeDialogRequest,
  objects: ReadonlyArray<SceneObject>,
): BarcodeObject | undefined {
  if (request.mode !== 'edit') return undefined;
  const object = objects.find((candidate) => candidate.id === request.objectId);
  return isBarcodeObject(object) ? object : undefined;
}

// Variable fields are evaluated against an object; a new code has none yet.
function standInObject(spec: BarcodeShape): ShapeObject {
  return {
    kind: 'shape',
    id: 'barcode-preview',
    spec,
    // eslint-disable-next-line no-restricted-syntax -- scene DATA: evaluation stand-in color.
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    transform: IDENTITY_TRANSFORM,
    paths: [],
  };
}
