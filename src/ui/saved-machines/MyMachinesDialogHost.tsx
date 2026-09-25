import { MyMachinesDialog } from './MyMachinesDialog';
import { useMyMachinesDialogStore } from './my-machines-dialog-store';

export function MyMachinesDialogHost(): JSX.Element | null {
  const open = useMyMachinesDialogStore((store) => store.open);
  const hide = useMyMachinesDialogStore((store) => store.hide);
  return open ? <MyMachinesDialog onClose={hide} /> : null;
}
