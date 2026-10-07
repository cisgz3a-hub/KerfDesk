import { JointResizeDialog } from './JointResizeDialog';
import { useJointResizeReview } from './use-joint-resize-review';
export function JointResizeDialogHost(props: { readonly onClose: () => void }): JSX.Element {
  return <JointResizeDialog review={useJointResizeReview(props.onClose)} />;
}
