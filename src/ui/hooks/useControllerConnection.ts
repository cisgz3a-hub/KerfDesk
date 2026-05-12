import { useState, useEffect, useRef, useCallback } from 'react';
import { type MachineState, type JobProgress, type LaserController } from '../../controllers/ControllerInterface';
import { createController, type ControllerId } from '../../controllers/ControllerRegistry';
import { type SerialPortLike } from '../../communication/SerialPort';
import { getMachineEventLedger } from '../../app/MachineEventLedger';
import { GrblController } from '../../controllers/grbl/GrblController';

export function useControllerConnection(controllerId: ControllerId = 'grbl') {
  const [machineState, setMachineState] = useState<MachineState | null>(null);
  const [jobProgress, setJobProgress] = useState<JobProgress | null>(null);
  const [isJobRunning, setIsJobRunning] = useState(false);
  const [controllerReady, setControllerReady] = useState(false);

  const controllerRef = useRef<LaserController | null>(null);
  const serialPortRef = useRef<SerialPortLike | null>(null);

  useEffect(() => {
    const controller = createController(controllerId);
    controller.onStateChange((state) => {
      setMachineState({ ...state });
      setIsJobRunning(controller.isJobRunning);
    });
    controller.onProgress((prog) => {
      setJobProgress({ ...prog });
      setIsJobRunning(controller.isJobRunning);
    });
    // T1-202: wire the controller's safety-event sink to the shared
    // MachineEventLedger so wcs-query-error and placement-uncertain
    // transitions land in support bundles. The `controllers/` layer
    // cannot import from `app/` directly (the layered architecture
    // forbids the reverse dependency); injecting the writer here
    // satisfies the layer rule. Only GrblController exposes the
    // setter today — Marlin / Ruida adapter stubs don't yet have a
    // controller implementation.
    if (controller instanceof GrblController) {
      controller.setSafetyEventSink((event) => {
        getMachineEventLedger().append(event);
      });
    }
    controllerRef.current = controller;
    setControllerReady(true);

    return () => {
      try {
        if (controller.isJobRunning) {
          controller.stop();
        }
      } catch (err: unknown) {
        console.warn('[Command blocked]', err instanceof Error ? err.message : err);
      }
      // App-level disconnects use MachineService.disconnect() (laser off + wake lock).
      void controller.disconnect();
    };
  }, [controllerId]);

  const connect = useCallback(async (port: SerialPortLike) => {
    if (!controllerRef.current) return;
    serialPortRef.current = port;
    await controllerRef.current.connect(port);
  }, []);

  const disconnect = useCallback(async () => {
    if (!controllerRef.current) return;
    await controllerRef.current.disconnect();
    serialPortRef.current = null;
  }, []);

  return {
    controller: controllerRef.current,
    controllerRef,
    portRef: serialPortRef,
    machineState,
    jobProgress,
    isJobRunning,
    controllerReady,
    connect,
    disconnect,
  };
}
