// BoxGeneratorHost — connects BoxGeneratorDialog to the store (F-K1):
// resolves the machine context (CNC prefills stock thickness and the active
// tool), inserts the generated sheet as one undo step, and toasts the count.
// Lives here rather than in CommandShell to keep that file inside its size
// budget; CommandShell only mounts it.

import { activeCncTool } from '../../core/scene';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import type { BoxMachineContext } from './box-draft';
import { BoxGeneratorDialog } from './BoxGeneratorDialog';

export function BoxGeneratorHost(props: { readonly onClose: () => void }): JSX.Element {
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
    <BoxGeneratorDialog
      machine={context}
      onCancel={props.onClose}
      onGenerate={(panels) => {
        insertBoxPanels(panels);
        props.onClose();
        pushToast(`Inserted ${panels.length} box panels.`, 'success');
      }}
    />
  );
}
