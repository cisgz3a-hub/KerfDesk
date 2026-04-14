import { useState, useEffect, useRef, useCallback } from 'react';
import { GrblController } from '../../controllers/grbl/GrblController';
import { type MachineState, type JobProgress } from '../../controllers/ControllerInterface';
import { type MockSerialPort, type SerialPortLike } from '../../communication/SerialPort';
import { type WebSerialPort } from '../../communication/WebSerialPort';

export function useGrblConnection() {
  const [machineState, setMachineState] = useState<MachineState | null>(null);
  const [jobProgress, setJobProgress] = useState<JobProgress | null>(null);
  const [isJobRunning, setIsJobRunning] = useState(false);
  const [grblReady, setGrblReady] = useState(false);

  const grblControllerRef = useRef<GrblController | null>(null);
  const serialPortRef = useRef<WebSerialPort | MockSerialPort | null>(null);

  useEffect(() => {
    const controller = new GrblController();
    controller.onStateChange((state) => {
      setMachineState({ ...state });
      setIsJobRunning(controller.isJobRunning);
    });
    controller.onProgress((prog) => {
      setJobProgress({ ...prog });
      setIsJobRunning(controller.isJobRunning);
    });
    grblControllerRef.current = controller;
    setGrblReady(true);

    return () => {
      try {
        if (controller.isJobRunning) {
          controller.stop();
        }
        controller.sendCommand('M5 S0');
      } catch (err: unknown) {
        console.warn('[Command blocked]', err instanceof Error ? err.message : err);
      }
      void controller.disconnect();
    };
  }, []);

  const connect = useCallback(async (port: SerialPortLike) => {
    if (!grblControllerRef.current) return;
    serialPortRef.current = port as WebSerialPort | MockSerialPort;
    await grblControllerRef.current.connect(port);
  }, []);

  const disconnect = useCallback(async () => {
    if (!grblControllerRef.current) return;
    await grblControllerRef.current.disconnect();
    serialPortRef.current = null;
  }, []);

  return {
    controller: grblControllerRef.current,
    controllerRef: grblControllerRef,
    portRef: serialPortRef,
    machineState,
    jobProgress,
    isJobRunning,
    grblReady,
    connect,
    disconnect,
  };
}
