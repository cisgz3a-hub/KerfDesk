import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import { machineSettingsReadBlockReason } from '../../state/machine-settings-read-readiness';
import { MachineSettingsPanel } from '../MachineSettingsPanel';
import { SuperConsoleDiagnostics } from './SuperConsoleDiagnostics';
import { SuperConsoleSnapshotCompare } from './SuperConsoleSnapshotCompare';

type AutoReadPhase = 'waiting' | 'reading' | 'done' | 'failed';

export function SuperConsoleSettingsPane(): JSX.Element {
  const project = useStore((s) => s.project);
  const rows = useLaserStore((s) => s.grblSettingsRows);
  const { note, phase } = useSettingsAutoRead();

  return (
    <div className="lf-super-console-settings" style={paneStyle}>
      {note !== null ? (
        <p role={phase === 'failed' ? 'alert' : 'status'} style={noteStyle}>
          {note}
        </p>
      ) : null}
      <SuperConsoleDiagnostics profile={project.device} machine={project.machine} rows={rows} />
      <SuperConsoleSnapshotCompare profile={project.device} />
      <MachineSettingsPanel defaultOpen />
    </div>
  );
}

function useSettingsAutoRead(): { readonly note: string | null; readonly phase: AutoReadPhase } {
  const connectionKind = useLaserStore((s) => s.connection.kind);
  const controllerSessionEpoch = useLaserStore((s) => s.controllerSessionEpoch);
  const lastSettingsReadAt = useLaserStore((s) => s.lastSettingsReadAt);
  const readMachineSettings = useLaserStore((s) => s.readMachineSettings);
  const readBlockReason = useLaserStore(machineSettingsReadBlockReason);
  const [phase, setPhase] = useState<AutoReadPhase>('waiting');
  const [autoReadError, setAutoReadError] = useState<string | null>(null);
  const attemptedSession = useRef<number | null>(null);

  useEffect(() => {
    if (connectionKind !== 'connected') attemptedSession.current = null;
    setPhase('waiting');
    setAutoReadError(null);
  }, [connectionKind, controllerSessionEpoch]);

  useEffect(() => {
    if (connectionKind === 'connected' && lastSettingsReadAt !== null) {
      attemptedSession.current = controllerSessionEpoch;
      setPhase('done');
      setAutoReadError(null);
      return;
    }
    if (
      connectionKind !== 'connected' ||
      readBlockReason !== null ||
      attemptedSession.current === controllerSessionEpoch
    ) {
      return;
    }
    attemptedSession.current = controllerSessionEpoch;
    setPhase('reading');
    setAutoReadError(null);
    const expectedEpoch = controllerSessionEpoch;
    let active = true;
    void readMachineSettings()
      .then(() => {
        const current = useLaserStore.getState();
        if (
          active &&
          current.connection.kind === 'connected' &&
          current.controllerSessionEpoch === expectedEpoch
        ) {
          setPhase('done');
        }
      })
      .catch((err: unknown) => {
        const current = useLaserStore.getState();
        if (
          active &&
          current.connection.kind === 'connected' &&
          current.controllerSessionEpoch === expectedEpoch
        ) {
          setPhase('failed');
          setAutoReadError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      active = false;
    };
  }, [
    connectionKind,
    controllerSessionEpoch,
    lastSettingsReadAt,
    readBlockReason,
    readMachineSettings,
  ]);

  return {
    phase,
    note: autoReadNote({ connectionKind, phase, readBlockReason, autoReadError }),
  };
}

function autoReadNote(state: {
  readonly connectionKind: ReturnType<typeof useLaserStore.getState>['connection']['kind'];
  readonly phase: AutoReadPhase;
  readonly readBlockReason: string | null;
  readonly autoReadError: string | null;
}): string | null {
  if (state.connectionKind !== 'connected') {
    return 'Connect to the controller to auto-read its settings.';
  }
  if (state.phase === 'reading') return 'Auto-reading controller settings ($$)...';
  if (state.phase === 'failed') {
    return `Auto-read failed: ${state.autoReadError ?? 'Unknown controller error.'} Use Read ($$) to retry.`;
  }
  if (state.phase === 'waiting' && state.readBlockReason !== null) {
    return `Auto-read waiting: ${state.readBlockReason}`;
  }
  return null;
}

const paneStyle: React.CSSProperties = {
  flex: 2,
  overflowY: 'auto',
};
const noteStyle: React.CSSProperties = {
  margin: '0 0 6px',
  color: 'var(--lf-text-muted)',
  fontSize: 12,
};
