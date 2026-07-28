// useGcodeInspectorSlot — owns the F-M1 Inspector dialog state so
// CommandShell stays inside its size caps: returns the open callback for the
// command layer plus the mounted element (null when closed), and wires the
// CNC-only handoff back to the retained F-CNC10 2D simulator (ADR-255).

import { useCallback, useState } from 'react';
import { open2dSimulatorFromText } from '../app/gcode-open-action';
import { GcodeInspectorDialog } from '../gcode-inspector';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';

type InspectorProgram = { readonly name: string; readonly text: string };

export function useGcodeInspectorSlot(): {
  readonly open: (name: string, text: string) => void;
  readonly element: JSX.Element | null;
} {
  const [program, setProgram] = useState<InspectorProgram | null>(null);
  const open = useCallback((name: string, text: string) => setProgram({ name, text }), []);
  const element =
    program === null ? null : <InspectorHost program={program} onClose={() => setProgram(null)} />;
  return { open, element };
}

function InspectorHost(props: {
  readonly program: InspectorProgram;
  readonly onClose: () => void;
}): JSX.Element {
  const machineKind = useStore((s) => s.project.machine?.kind ?? 'laser');
  const openExternalGcodePreview = useStore((s) => s.openExternalGcodePreview);
  const pushToast = useToastStore((s) => s.pushToast);
  const handoff =
    machineKind === 'cnc'
      ? {
          onOpen2dSimulator: () => {
            open2dSimulatorFromText(
              props.program.name,
              props.program.text,
              openExternalGcodePreview,
              pushToast,
            );
            props.onClose();
          },
        }
      : {};
  return (
    <GcodeInspectorDialog
      programName={props.program.name}
      text={props.program.text}
      machineKind={machineKind}
      onClose={props.onClose}
      {...handoff}
    />
  );
}
