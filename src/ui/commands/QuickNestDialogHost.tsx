import { findRegistrationBoxes } from '../../core/scene';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { QuickNestDialog } from './QuickNestDialog';

export function QuickNestDialogHost(props: { readonly onClose: () => void }): JSX.Element {
  const boardAvailable = useStore((state) => findRegistrationBoxes(state.project.scene).length > 0);
  const quickNestSelection = useStore((state) => state.quickNestSelection);
  const pushToast = useToastStore((state) => state.pushToast);
  return (
    <QuickNestDialog
      boardAvailable={boardAvailable}
      onCancel={props.onClose}
      onApply={(options) => {
        const result = quickNestSelection(options);
        if (!result.ok) {
          pushToast(result.reason, 'error');
          return;
        }
        props.onClose();
        pushToast(`Nested ${result.packedUnits} unit(s).`, 'success');
      }}
    />
  );
}
