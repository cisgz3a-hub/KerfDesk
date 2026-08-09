import { useStore } from '../state';
import { SurfacingPanel } from './SurfacingPanel';

// Standalone CNC actions live with machine controls. They are not project
// setup fields and should not re-create the removed bottom setup card.
export function CncUtilitiesPanel(): JSX.Element | null {
  const machine = useStore((state) => state.project.machine);
  if (machine?.kind !== 'cnc') return null;
  return <SurfacingPanel machine={machine} />;
}
