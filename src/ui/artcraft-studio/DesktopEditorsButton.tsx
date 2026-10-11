import { lazy, Suspense, useEffect, useState } from 'react';
import { usePlatformOptional } from '../app/platform-context';
import { Button } from '../kit/Button';
import { getStudioStatus } from './artcraft-api';

const Panel = lazy(() =>
  import('./DesktopEditorsPanel').then((module) => ({ default: module.DesktopEditorsPanel })),
);

export function DesktopEditorsButton(): JSX.Element | null {
  const desktop = usePlatformOptional()?.desktopWindow !== undefined;
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let current = true;
    if (desktop)
      void getStudioStatus().then(
        (status) => {
          if (current) setAvailable(status.available);
        },
        () => {
          if (current) setAvailable(false);
        },
      );
    return () => {
      current = false;
    };
  }, [desktop]);
  if (!desktop || !available) return null;
  return (
    <>
      <Button
        title="Open the full VectorCraft and PhotoCraft desktop editors (preview)"
        onClick={() => setOpen(true)}
      >
        Desktop editors
      </Button>
      {open && (
        <Suspense fallback={<span role="status">Loading desktop editors…</span>}>
          <Panel onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
