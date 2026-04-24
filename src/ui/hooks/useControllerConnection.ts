import { useState, useEffect, useRef, useCallback } from 'react';
import { type MachineState, type JobProgress, type LaserController } from '../../controllers/ControllerInterface';
import { createController, type ControllerId } from '../../controllers/ControllerRegistry';
import { type SerialPortLike } from '../../communication/SerialPort';

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
