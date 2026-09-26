// Runs the automatic fill (ADR-420) once a connected controller has answered
// its settings read. It fills by itself for a machine that has not been set up
// yet, or on the connection Find my machine opened in this setup; a machine
// already set up keeps its values and gets the explicit Use detected values offer.

import { useCallback, useEffect, useState, type Dispatch } from 'react';
import { useLaserStore } from '../../state/laser-store';
import { nextAutoFill, type DeviceSetupAutoFillRecord } from './device-setup-auto-fill';
import type { DeviceSetupAction, DeviceSetupState } from './device-setup-flow';

export type DeviceSetupAutomatic = {
  readonly record: DeviceSetupAutoFillRecord | null;
  /** True when this setup fills in reported values by itself. */
  readonly fillsItself: boolean;
  /** The live connection is the one Find my machine opened in this setup. Any
   *  other connect or disconnect ends that, so a new machine's fill on open
   *  or on someone else's connection never makes the connection Find's. */
  readonly findOwnsConnection: boolean;
  /** Counts Find presses, so Find's own follow-up reconnect runs once per press. */
  readonly findCount: number;
  readonly undo: () => void;
  /** Find my machine started connect attempt `attempt`: fill in what it reports. */
  readonly requestFind: (attempt: number) => void;
  /** Find's own reconnect started attempt `attempt`; the claim moves to it. */
  readonly continueFind: (attempt: number) => void;
};

export function liveConnectionAttempt(): number {
  return useLaserStore.getState().connectionAttempt ?? 0;
}

export function useControllerAutoFill(
  state: DeviceSetupState,
  dispatch: Dispatch<DeviceSetupAction>,
  newMachine: boolean,
): DeviceSetupAutomatic {
  const detected = useLaserStore((s) => s.detectedSettings);
  const controllerKind = useLaserStore((s) => s.detectedControllerKind);
  const baudRate = useLaserStore((s) => s.connectedBaudRate ?? null);
  const readAt = useLaserStore((s) => s.lastSettingsReadAt);
  const liveAttempt = useLaserStore((s) => s.connectionAttempt ?? 0);
  const readDone = useLaserStore(
    (s) =>
      s.connection.kind === 'connected' &&
      (s.lastSettingsReadAt !== null || s.controllerQualification.kind === 'qualified'),
  );
  const [record, setRecord] = useState<DeviceSetupAutoFillRecord | null>(null);
  const [find, setFind] = useState<{ readonly attempt: number | null; readonly count: number }>({
    attempt: null,
    count: 0,
  });
  const findOwnsConnection = find.attempt !== null && find.attempt === liveAttempt;
  const fillsItself = newMachine || findOwnsConnection;
  useEffect(() => {
    if (!fillsItself || !readDone) return;
    const report = { detected: detected ?? {}, controllerKind, baudRate, readAt };
    const next = nextAutoFill(state, record, report);
    if (next === null) return;
    for (const action of next.actions) dispatch(action);
    setRecord(next.record);
  }, [baudRate, controllerKind, detected, dispatch, fillsItself, readAt, readDone, record, state]);
  const undo = useCallback(() => {
    if (record?.status !== 'applied') return;
    dispatch({ kind: 'restore', state: record.undo });
    setRecord({ status: 'undone' });
  }, [dispatch, record]);
  const requestFind = useCallback((attempt: number) => {
    setFind((previous) => ({ attempt, count: previous.count + 1 }));
    setRecord(null);
  }, []);
  const continueFind = useCallback((attempt: number) => {
    setFind((previous) => ({ ...previous, attempt }));
  }, []);
  return {
    record,
    fillsItself,
    findOwnsConnection,
    findCount: find.count,
    undo,
    requestFind,
    continueFind,
  };
}
