import type { MachineKind } from '../../core/scene';
import { openArtworkCreation } from '../layers/artwork-creation-store';
import { disabled, enabled, type AppCommand } from './command-types';
export function artworkCreationCommands(machineKind: MachineKind): readonly AppCommand[] {
  const relief = () => openArtworkCreation('relief');
  return [
    enabled(
      'tools.constrained-sketch',
      'tools',
      'Constrained sketch…',
      'Create an editable 2D sketch with named dimensions and geometric relations',
      () => openArtworkCreation('sketch'),
    ),
    enabled(
      'tools.parametric-part',
      'tools',
      'Parametric part…',
      'Create a dimensioned panel, bracket, hole grid or fixture',
      () => openArtworkCreation('part'),
    ),
    machineKind === 'cnc'
      ? enabled(
          'tools.editable-relief',
          'tools',
          'Editable relief…',
          'Create and sculpt an editable relief for CNC carving',
          relief,
        )
      : disabled(
          'tools.editable-relief',
          'tools',
          'Editable relief…',
          'Switch to CNC mode to create a relief',
          relief,
        ),
  ];
}
