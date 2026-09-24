// Preview dock controls that also render while the toolpath is being prepared.
//
// Separate from the route controls because those need a finished
// toolpath and this must not: the render status exists precisely for the
// window where preview is on and the raster is not ready yet.

import { PreviewScrubber } from './overlays';
import { PreviewRenderStatus } from './PreviewRenderStatus';

export function WorkspacePreviewChrome(props: {
  readonly previewMode: boolean;
  readonly rasterPending: boolean;
}): JSX.Element {
  return (
    <>
      {props.previewMode ? <PreviewScrubber /> : null}
      <PreviewRenderStatus pending={props.previewMode && props.rasterPending} />
    </>
  );
}
