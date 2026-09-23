import type { ReactNode } from 'react';
import './workspace-preview.css';

// View controls and the preview dock have their own rows. Stage and accessories
// share the remaining cell, retaining their coordinate box and React lifetime
// when the user changes view or opens preview details.
export function WorkspaceViewport(props: {
  readonly controls: ReactNode;
  readonly content: ReactNode;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <div className="lf-workspace-canvas-area" data-toast-workspace>
      <div className="lf-workspace-view-controls">{props.controls}</div>
      {props.content}
      <div className="lf-workspace-accessories">{props.children}</div>
    </div>
  );
}
