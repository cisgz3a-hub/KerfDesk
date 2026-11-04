import { isApplePlatform } from '../common/operating-system';
import { SOFTWARE_ABORT_TITLE } from '../common/software-abort-copy';
import { LIVE_MOTION_ACTION_BUTTON_STYLE } from './LiveMotionActionButton';
import { controllerActionFailureHandler } from './report-controller-action-failure';

/** The keyboard Abort (use-job-shortcuts.ts), named on the controls it stands for. */
export function abortShortcut(): { readonly label: string; readonly aria: string } {
  return isApplePlatform()
    ? { label: '⌘.', aria: 'Meta+.' }
    : { label: 'Ctrl+.', aria: 'Control+.' };
}

/** The bar's ABORT JOB / ABORT MOTION / LASER OFF, naming its shortcut (UX audit U7-P3-3). */
export function LiveMotionAbortButton(props: {
  readonly label: string;
  readonly abort: () => Promise<void>;
}): JSX.Element {
  const shortcut = abortShortcut();
  return (
    <button
      type="button"
      className="lf-btn lf-btn--danger"
      style={abortButtonStyle}
      title={`${SOFTWARE_ABORT_TITLE} Shortcut: ${shortcut.label}, also from inside a dialog.`}
      aria-keyshortcuts={shortcut.aria}
      onClick={() => void props.abort().catch(controllerActionFailureHandler('Abort'))}
    >
      {props.label}
    </button>
  );
}

const abortButtonStyle: React.CSSProperties = {
  ...LIVE_MOTION_ACTION_BUTTON_STYLE,
  minWidth: 144,
  fontWeight: 800,
  letterSpacing: 0.4,
};
