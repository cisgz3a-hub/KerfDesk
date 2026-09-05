import { useEffect, useRef, useState } from 'react';
import { saveSurfacingProgram } from './save-surfacing-program';

type Options = Omit<
  Parameters<typeof saveSurfacingProgram>[0],
  'signal' | 'onWriting' | 'onFinalizing' | 'isCurrent'
>;
type Phase = 'preparing' | 'writing' | 'finalizing' | null;
type SaveOwner = { readonly controller: AbortController; finalizing: boolean };

export function useSurfacingSave(
  options: Options,
  documentEpoch: number,
): {
  readonly save: () => void;
  readonly cancel: () => void;
  readonly phase: Phase;
} {
  const activeSave = useRef<SaveOwner | null>(null);
  const [phase, setPhase] = useState<Phase>(null);
  useEffect(() => {
    setPhase(null);
    return () => {
      activeSave.current?.controller.abort();
      activeSave.current = null;
    };
  }, [documentEpoch]);
  const save = (): void => {
    activeSave.current?.controller.abort();
    const owner: SaveOwner = { controller: new AbortController(), finalizing: false };
    activeSave.current = owner;
    setPhase('preparing');
    const isCurrent = (): boolean => activeSave.current === owner;
    void saveSurfacingProgram({
      ...options,
      signal: owner.controller.signal,
      isCurrent,
      onWriting: () => {
        if (isCurrent()) setPhase('writing');
      },
      onFinalizing: () => {
        owner.finalizing = true;
        if (isCurrent()) setPhase('finalizing');
      },
    })
      .catch((error: unknown) => {
        if (!isCurrent()) return;
        if (owner.controller.signal.aborted && !owner.finalizing)
          options.pushToast('Surfacing save cancelled.');
        else
          options.pushToast(
            'Could not save the surfacing program: ' +
              (error instanceof Error ? error.message : String(error)),
            'error',
          );
      })
      .finally(() => {
        if (!isCurrent()) return;
        activeSave.current = null;
        setPhase(null);
      });
  };
  const cancel = (): void => {
    const owner = activeSave.current;
    if (owner !== null && !owner.finalizing) owner.controller.abort();
  };
  return { save, cancel, phase };
}
