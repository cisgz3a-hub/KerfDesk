import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { type MutableRefObject } from 'react';
import { type LaserController } from '../../controllers/ControllerInterface';
import { type MockSerialPort } from '../../communication/SerialPort';
import { type WebSerialPort } from '../../communication/WebSerialPort';
import { MachineService, type BurnState } from '../../app/MachineService';
import { ExecutionCoordinator } from '../../app/ExecutionCoordinator';

interface UseMachineServiceArgs {
  controllerRef: MutableRefObject<LaserController | null>;
  portRef: MutableRefObject<WebSerialPort | MockSerialPort | null>;
}

export function useMachineService(args: UseMachineServiceArgs) {
  const { controllerRef, portRef } = args;
  const service = useMemo(
    () => new MachineService(controllerRef, portRef),
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
