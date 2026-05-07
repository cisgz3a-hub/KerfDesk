import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { type MutableRefObject } from 'react';
import { type LaserController } from '../../controllers/ControllerInterface';
import { type SerialPortLike } from '../../communication/SerialPort';
import { MachineService, type BurnState } from '../../app/MachineService';
import { ExecutionCoordinator } from '../../app/ExecutionCoordinator';

interface UseMachineServiceArgs {
  controllerRef: MutableRefObject<LaserController | null>;
  portRef: MutableRefObject<SerialPortLike | null>;
  /**
   * T2-56: signals when the controller has been created and assigned
   * to `controllerRef.current`. The auto-finalize listener attaches
   * exactly once when this transitions to true. Pre-T2-56 finalization
   * was driven by a `useEffect` inside `ConnectionPanel.tsx`; if the
   * panel was unmounted at the moment of the run→idle transition, the
   * effect didn't fire and finalization was missed.
   */
  controllerReady: boolean;
}

export function useMachineService(args: UseMachineServiceArgs) {
  const { controllerRef, portRef, controllerReady } = args;
  const service = useMemo(
    () => new MachineService(controllerRef as MutableRefObject<LaserController>, portRef),
    [controllerRef, portRef],
  );

  const coordinatorSimulatorNotifyRef = useRef<(line: string) => void>(() => {});
  const executionCoordinator = useMemo(
    () =>
      new ExecutionCoordinator({
        machineService: service,
        controllerRef,
        notifySimulatorRef: coordinatorSimulatorNotifyRef,
      }),
    [service, controllerRef],
  );

  const [messages, setMessages] = useState<string[]>([]);
  const [isSimulator, setIsSimulator] = useState(false);
  const [burnState, setBurnState] = useState<BurnState>(() => service.getBurnState());

  useEffect(() => {
    setBurnState(service.getBurnState());
    return service.onBurnStateChange(setBurnState);
  }, [service]);

  // T2-56: attach the auto-finalize listener once the controller is
  // ready. Cleanup unsubscribes on unmount or controller change.
  useEffect(() => {
    if (!controllerReady) return;
    const ctrl = controllerRef.current;
    if (!ctrl) return;
    return service.attachAutoFinalize(ctrl);
  }, [service, controllerRef, controllerReady]);

  const appendMessage = (message: string) => {
    service.appendMessage(message);
    setMessages(service.getState().messages);
  };

  const replaceMessages = useCallback(
    (next: string[] | ((prev: string[]) => string[])) => {
      setMessages(prev => {
        const resolved = typeof next === 'function' ? next(prev) : next;
        service.setMessages(resolved);
        return [...resolved];
      });
    },
    [service],
  );

  const clearMessages = () => {
    service.clearMessages();
    setMessages(service.getState().messages);
  };

  const setSimulator = (next: boolean) => {
    service.setSimulator(next);
    setIsSimulator(next);
  };

  const appendConsoleLine = useCallback(
    (line: string) => {
      replaceMessages(prev => [...prev.slice(-200), line]);
    },
    [replaceMessages],
  );

  return {
    service,
    executionCoordinator,
    coordinatorSimulatorNotifyRef,
    messages,
    appendMessage,
    replaceMessages,
    clearMessages,
    appendConsoleLine,
    isSimulator,
    setSimulator,
    burnState,
  };
}

export type MachineUiHook = ReturnType<typeof useMachineService>;
