// The workspace's bars above the canvas: the app menu bar, the toolbar, the
// object/placement bar with the machine connection, and the canvas context bar.
// The Registration jig and Place Board pages (ADR-641, ADR-636) are full pages,
// so none of them shows while a page is open: the page's own header carries its
// title, its steps, Undo/Redo, the machine connection and Done. Done brings the
// bars back as they were; their state lives in the stores, not in these bars.
import type { MachineKind } from '../../core/scene';
import { Toolbar } from '../common/Toolbar';
import { useToolPageOpen } from '../state/tool-page';
import { AppMenuBar } from './AppMenuBar';
import type { AppCommand } from './command-registry';
import { WorkspaceContextBar } from './WorkspaceContextBar';
import { WorkspaceTopBar } from './WorkspaceTopBar';

export function WorkspaceChromeBars(props: {
  readonly commands: ReadonlyArray<AppCommand>;
  readonly machineKind: MachineKind;
}): JSX.Element | null {
  if (useToolPageOpen()) return null;
  return (
    <>
      <AppMenuBar commands={props.commands} machineKind={props.machineKind} />
      <Toolbar commands={props.commands} machineKind={props.machineKind} />
      <WorkspaceTopBar />
      <WorkspaceContextBar commands={props.commands} />
    </>
  );
}
