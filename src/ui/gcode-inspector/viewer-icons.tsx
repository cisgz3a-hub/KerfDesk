// The G-code viewer's own icons (ADR-701), drawn on the kit's 24-unit grid so
// they sit beside the shared set (src/ui/kit/icons.tsx). They live here, not in
// the kit, because only the viewer's transport and toolbar use them.

import { Icon, type IconName } from '../kit';
// Deep import: the kit barrel exports the finished icons, not their frame.
import { IconFrame } from '../kit/icon-frame';

export type ViewerIconName =
  | 'restart'
  | 'step-back'
  | 'step-forward'
  | 'code'
  | 'maximize'
  | 'minimize'
  | 'hand'
  | 'orbit'
  | 'ortho';

const VIEWER_ICON_PATHS: Readonly<Record<ViewerIconName, JSX.Element>> = {
  restart: (
    <>
      <path d="M6 5v14" />
      <path className="lf-icon-plane" d="M19 5 9 12l10 7V5Z" />
    </>
  ),
  'step-back': (
    <>
      <path d="M17 6v12" />
      <path className="lf-icon-plane" d="m13 6-8 6 8 6V6Z" />
    </>
  ),
  'step-forward': (
    <>
      <path d="M7 6v12" />
      <path className="lf-icon-plane" d="m11 6 8 6-8 6V6Z" />
    </>
  ),
  code: (
    <>
      <path d="m8 7-5 5 5 5M16 7l5 5-5 5" />
      <path className="lf-icon-accent" d="m13.5 4-3 16" />
    </>
  ),
  maximize: (
    <>
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
      <rect className="lf-icon-accent" x="9" y="9" width="6" height="6" rx="1" />
    </>
  ),
  minimize: (
    <>
      <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
    </>
  ),
  hand: (
    <>
      <path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11m0-6.5a1.5 1.5 0 0 1 3 0V11m0-5a1.5 1.5 0 0 1 3 0v6" />
      <path d="M17 9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1a7 7 0 0 1-5.6-2.8L4 15a1.6 1.6 0 0 1 2.4-2.1L8 14.5" />
    </>
  ),
  orbit: (
    <>
      <ellipse cx="12" cy="12" rx="9" ry="4" />
      <path d="M17.5 15.2 19 16l-.2-1.7" />
      <circle className="lf-icon-accent" cx="12" cy="12" r="2" />
    </>
  ),
  ortho: (
    <>
      <path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z" />
      <path className="lf-icon-accent" d="M4 7.5 12 12l8-4.5M12 12v9" />
    </>
  ),
};

/** A viewer icon, or one of the kit's when the name is the kit's. */
export function ViewerIcon(props: {
  readonly name: ViewerIconName | IconName;
  readonly size?: number;
}): JSX.Element {
  const size = props.size ?? 16;
  const { name } = props;
  if (isViewerIcon(name)) return <IconFrame size={size}>{VIEWER_ICON_PATHS[name]}</IconFrame>;
  return <Icon name={name} size={size} />;
}

function isViewerIcon(name: ViewerIconName | IconName): name is ViewerIconName {
  return name in VIEWER_ICON_PATHS;
}
