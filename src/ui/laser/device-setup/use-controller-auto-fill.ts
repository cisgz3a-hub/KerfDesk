// Runs the automatic fill (ADR-420) once a connected controller has answered
// its settings read. It fills by itself for a machine that has not been set up
// yet, or after the operator pressed Find my machine in this setup; a machine
// already set up keeps its values and gets the explicit Use detected values offer.

import { useCallback, useEffect, useState, type Dispatch } from 'react';
import { useLaserStore } from '../../state/laser-store';
import { nextAutoFill, type DeviceSetupAutoFillRecord } from './device-setup-auto-fill';
import type { DeviceSetupAction, DeviceSetupState } from './device-setup-flow';

export type DeviceSetupAutomatic = {
  readonly record: DeviceSetupAutoFillRecord | null;
  /** True when this setup fills in reported values by itself. */
  readonly fillsItself: boolean;
  readonly undo: () => void;
  /** The operator pressed Find my machine: fill in what it reports. */
  readonly requestFind: () => void;
};

export function useControllerAutoFill(
  state: DeviceSetupState,
  dispatch: Dispatch<DeviceSetupAction>,
  newMachine: boolean,
): DeviceSetupAutomatic {
  const detected = useLaserStore((s) => s.detectedSettings);
  const controllerKind = useLaserStore((s) => s.detectedControllerKind);
  const baudRate = useLaserStore((s) => s.connectedBaudRate ?? null);
  const readAt = useLaserStore((s) => s.lastSettingsReadAt);
  const readDone = useLaserStore(
    (s) =>
      s.connection.kind === 'connected' &&
      (s.lastSettingsReadAt !== null || s.controllerQualification.kind === 'qualified'),
  );
  const [record, setRecord] = useState<DeviceSetupAutoFillRecord | null>(null);
  const [findRequested, setFindRequested] = useState(false);
  const fillsItself = newMachine || findRequested;
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
  const requestFind = useCallback(() => {
    setFindRequested(true);
    setRecord(null);
  }, []);
  return { record, fillsItself, undo, requestFind };
}
