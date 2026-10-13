// The store-opened dialogs added for LightBurn parity, mounted together so
// CommandShell stays inside the file-size cap.

import { ClosePathsToleranceDialogHost } from './ClosePathsToleranceDialog';
import { DockOptionsDialogHost } from './DockOptionsDialog';
import { RadiusFilletDialogHost } from './RadiusFilletDialog';
import { SaveOriginalImageDialogHost } from './SaveOriginalImageDialog';
import { SelectCirclesDialogHost } from './SelectCirclesDialog';
import { ShearDialogHost } from './ShearDialog';
import { PrintArtworkDialogHost } from './PrintArtworkDialog';
import { TangentCircleDialogHost } from './TangentCircleDialog';

export function ParityDialogHosts(): JSX.Element {
  return (
    <>
      <SelectCirclesDialogHost />
      <SaveOriginalImageDialogHost />
      <DockOptionsDialogHost />
      <TangentCircleDialogHost />
      <ClosePathsToleranceDialogHost />
      <RadiusFilletDialogHost />
      <ShearDialogHost />
      <PrintArtworkDialogHost />
    </>
  );
}
