import type { ReactNode } from 'react';
import './workspace-preview.css';

// Stage and accessories occupy the same grid cell. The preview dock alone
// contributes the second row, so coordinate overlays retain both their box and
// their React lifetime when the user changes view or opens preview details.
export function WorkspaceViewport(props: {
  readonly content: ReactNode;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <div className="lf-workspace-canvas-area" data-toast-workspace>
      {props.content}
      <div className="lf-workspace-accessories">{props.children}</div>
    </div>
  );
}
