import { StampPreparationDialog } from './StampPreparationDialog';
import { useStampPreparation } from './use-stamp-preparation';
export function StampPreparationDialogHost({
  onClose,
}: {
  readonly onClose: () => void;
}): JSX.Element {
  return <StampPreparationDialog review={useStampPreparation(onClose)} />;
}
