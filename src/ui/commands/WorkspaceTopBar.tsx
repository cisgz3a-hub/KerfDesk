import { MachineConnectionToolbar } from '../laser/MachineConnectionToolbar';
import { NumericEditsBar } from './NumericEditsBar';

export function WorkspaceTopBar(): JSX.Element {
  return (
    <div className="lf-workspace-topbar">
      <NumericEditsBar />
      <MachineConnectionToolbar />
    </div>
  );
}
