// useAutosave + useAutosaveRecovery — wires the autosave module to the
// React lifecycle. Two effects, mounted once each in App.
//
// useAutosave:
//   Starts a 30s interval that snapshots project + dirty + streaming
//   from both stores (Zustand getState — no re-render on store change,
//   which is the whole point of an interval). Clears on unmount.
//
// useAutosaveRecovery:
//   Runs once on mount. If localStorage has an autosave AND the
//   current project is empty (no objects), prompts the user via
//   window.confirm to restore. Either path clears the slot so the
//   user isn't re-prompted next session.

import { useEffect } from 'react';
import { useStore } from '../state';
import {
  clearAutosave,
  readAutosave,
  startAutosaveLoop,
} from '../state/autosave';
import { useLaserStore } from '../state/laser-store';

export function useAutosave(): void {
  useEffect(() => {
    const stop = startAutosaveLoop(() => {
      const s = useStore.getState();
      const ls = useLaserStore.getState();
      const streamer = ls.streamer;
      const isStreaming =
        streamer !== null && (streamer.status === 'streaming' || streamer.status === 'paused');
      return { project: s.project, dirty: s.dirty, isStreaming };
    });
    return stop;
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
