// Mounts the Copy Along Path dialog (LightBurn gap LBG-T09) while it is open.
// It reopens with the settings last applied in this session, so the next row
// of copies is one click; the spacing starts from the artwork's width.

import { useMemo, useState } from 'react';
import { useStore } from '../state';
import { selectedSceneObjects } from '../state/copy-along-path-actions';
import { useCopyAlongPathDialogStore } from './copy-along-path-dialog-store';
import { CopyAlongPathDialog, defaultCopyAlongPathForm } from './CopyAlongPathDialog';
import type { CopyAlongPathForm } from './CopyAlongPathFields';

let lastApplied: CopyAlongPathForm | null = null;

export function CopyAlongPathDialogHost(): JSX.Element | null {
  const open = useCopyAlongPathDialogStore((state) => state.open);
  return open ? <OpenCopyAlongPathDialog /> : null;
}

function OpenCopyAlongPathDialog(): JSX.Element {
  const close = useCopyAlongPathDialogStore((state) => state.close);
  const project = useStore((state) => state.project);
  const selectedObjectId = useStore((state) => state.selectedObjectId);
  const additionalSelectedIds = useStore((state) => state.additionalSelectedIds);
  const copyAlongPath = useStore((state) => state.copyAlongPath);
  const selected = useMemo(
    () => selectedSceneObjects({ project, selectedObjectId, additionalSelectedIds }),
    [project, selectedObjectId, additionalSelectedIds],
  );
  const [initial] = useState(() => lastApplied ?? defaultCopyAlongPathForm(selected));
  return (
    <CopyAlongPathDialog
      selected={selected}
      scene={project.scene}
      initial={initial}
      onCancel={close}
      onApply={(request, form) => {
        if (!copyAlongPath(request)) return;
        lastApplied = form;
        close();
      }}
    />
  );
}

/** Test seam: forget the remembered settings. */
export function resetCopyAlongPathDialogMemory(): void {
  lastApplied = null;
}
