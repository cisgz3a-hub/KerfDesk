// useAutosave + useAutosaveRecovery — wires the autosave module to the
// React lifecycle. Two effects, mounted once each in App.
//
// useAutosave:
//   * 30s interval that snapshots project + dirty + streaming from
//     both stores. Background safety net for force-kills.
//   * beforeunload listener that writes synchronously if dirty when
//     the window closes (X button / Cmd+Q / Alt+F4 / app quit). This
//     is the path the user actually takes — the 30s interval was
//     never going to fire in time for normal closes.
//   Clears both on unmount.
//
// useAutosaveRecovery:
//   Runs once on mount. If localStorage has an autosave AND the
//   current project is empty (no objects), prompts the user via
//   window.confirm to restore. Either path clears the slot so the
//   user isn't re-prompted next session.

import { useEffect } from 'react';
import { useStore } from '../state';
import { clearAutosave, readAutosave, startAutosaveLoop, writeAutosave } from '../state/autosave';
import { useLaserStore } from '../state/laser-store';

function snapshotForAutosave(): {
  readonly project: ReturnType<typeof useStore.getState>['project'];
  readonly dirty: boolean;
  readonly isStreaming: boolean;
} {
  const s = useStore.getState();
  const ls = useLaserStore.getState();
  const streamer = ls.streamer;
  const isStreaming =
    streamer !== null && (streamer.status === 'streaming' || streamer.status === 'paused');
  return { project: s.project, dirty: s.dirty, isStreaming };
}

export function useAutosave(): void {
  useEffect(() => {
    const stopInterval = startAutosaveLoop(snapshotForAutosave);
    const onBeforeUnload = (): void => {
      const snap = snapshotForAutosave();
      // Even mid-stream: if the user closed the window, persisting
      // their scene is more important than respecting "don't write
      // during streaming." The streaming guard exists so the 30s
      // interval doesn't perturb the render loop — that no longer
      // applies once the page is unloading.
      if (snap.dirty) writeAutosave(snap.project);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      stopInterval();
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);
}

export function useAutosaveRecovery(): void {
  useEffect(() => {
    const record = readAutosave();
    if (record === null) return;
    // Only prompt if the in-memory project is still the empty default.
    // If something already loaded (URL drop, deep-link, etc.), the user
    // is mid-workflow and recovery would clobber it.
    const s = useStore.getState();
    if (s.dirty || s.project.scene.objects.length > 0) {
      clearAutosave();
      return;
    }
    const ageMin = Math.max(0, Math.round((Date.now() - record.savedAt) / 60_000));
    const ageLabel = ageMin === 0 ? 'less than a minute ago' : `${ageMin} minute(s) ago`;
    const ok = window.confirm(
      `LaserForge found an auto-saved project from ${ageLabel}. Restore it?\n\n` +
        '(Click Cancel to discard the auto-save and start fresh.)',
    );
    if (ok) {
      s.setProject(record.project);
    }
    clearAutosave();
  }, []);
}
