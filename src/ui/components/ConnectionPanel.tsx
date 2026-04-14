import React, { useEffect, useRef, useState } from 'react';
import { type JobReplay } from '../../core/replay/JobReplay';
import {
  ConnectionPanelMain,
  type ConnectionPanelMainProps,
} from './ConnectionPanelMain';
import { JobOutcomeDialog } from './JobOutcomeDialog';
import { useMachineService } from '../hooks/useMachineService';

export type ConnectionPanelProps = Omit<
  ConnectionPanelMainProps,
  | 'machineService'
  | 'outcomeReplaySection'
  | 'messages'
  | 'appendMessage'
  | 'replaceMessages'
  | 'clearMessages'
  | 'isSimulator'
  | 'setSimulator'
>;

const FONT = "'DM Sans', system-ui, sans-serif";

export function ConnectionPanel(props: ConnectionPanelProps) {
  const { controller, portRef, machineState, jobProgress } = props;
  const controllerRef = useRef(controller);
  controllerRef.current = controller;

  const {
    service: machineService,
    messages,
    appendMessage,
    replaceMessages,
    clearMessages,
    appendConsoleLine,
    isSimulator,
    setSimulator,
  } = useMachineService({ controllerRef, portRef });

  const [currentReplay, setCurrentReplay] = useState<JobReplay | null>(null);
  const [showOutcome, setShowOutcome] = useState(false);

  useEffect(() => {
    return machineService.attachJobRecording(controller, {
      appendConsoleLine,
      onReplayCompleted: r => {
        setCurrentReplay({ ...r });
        setShowOutcome(true);
      },
    });
  }, [controller, machineService, appendConsoleLine]);

  useEffect(() => {
    const running = controllerRef.current?.isJobRunning ?? false;
    machineService.tryFinalizeJobLog(machineState, jobProgress, running, appendMessage);
  }, [
    machineState?.status,
    jobProgress?.linesAcknowledged,
    jobProgress?.totalLines,
    machineService,
    appendMessage,
    machineState,
    jobProgress,
  ]);

  const outcomeReplaySection =
    showOutcome && currentReplay
      ? React.createElement(JobOutcomeDialog, {
          font: FONT,
          replay: currentReplay,
          onOutcome: outcome => {
            machineService.applyReplayOutcome(currentReplay, outcome);
            appendMessage(`Outcome recorded: ${outcome.replace(/_/g, ' ')}`);
            setShowOutcome(false);
          },
          onSkip: () => setShowOutcome(false),
        })
      : null;

  return React.createElement(ConnectionPanelMain, {
    ...props,
    machineService,
    outcomeReplaySection,
    messages,
    appendMessage,
    replaceMessages,
    clearMessages,
    isSimulator,
    setSimulator,
  });
}
