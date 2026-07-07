// BoxFitTestHost — connects BoxFitTestDialog to the store (F-K8): machine
// context, insertion through the shared generated-part path (one undo
// step), and the toast. CommandShell only mounts it.

import { activeCncTool } from '../../core/scene';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import type { BoxMachineContext } from './box-draft';
import { BoxFitTestDialog } from './BoxFitTestDialog';

export function BoxFitTestHost(props: { readonly onClose: () => void }): JSX.Element {
  const machine = useStore((s) => s.project.machine);
  const insertBoxPanels = useStore((s) => s.insertBoxPanels);
  const pushToast = useToastStore((s) => s.pushToast);
  const context: BoxMachineContext =
    machine !== undefined && machine.kind === 'cnc'
      ? {
          kind: 'cnc',
          stockThicknessMm: machine.stock.thicknessMm,
          toolDiameterMm: activeCncTool(machine).diameterMm,
        }
      : { kind: 'laser' };
  return (
    <BoxFitTestDialog
      machine={context}
      onCancel={props.onClose}
      onGenerate={(parts) => {
        insertBoxPanels(
          parts.map((part) => ({
            name: part.name,
            outline: part.rings.outline,
            cutouts: part.rings.cutouts,
          })),
        );
        props.onClose();
        pushToast('Inserted fit test strips — press each rung, best fit wins.', 'success');
      }}
    />
  );
}
