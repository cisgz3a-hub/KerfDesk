// "Replace this machine's settings?" (ADR-637 Amendment 1). Asked in place
// before a list choice or a profile import (Amendment 3) replaces values
// someone set in the draft.

import { Button } from '../../kit';
import { joinSettingLabels } from './machine-choice-replaces';
import './device-setup-picker.css';

export function ReplaceSettingsConfirm(props: {
  /** What replaces them, e.g. "Choosing Genmitsu 3018-PRO". */
  readonly subject: string;
  readonly replaces: ReadonlyArray<string>;
  readonly onReplace: () => void;
  readonly onKeep: () => void;
}): JSX.Element {
  const what = props.replaces.length === 0 ? 'its values' : joinSettingLabels(props.replaces);
  return (
    <div className="lf-setup-picker-confirm" role="alert">
      <p>
        <strong>Replace this machine’s settings?</strong> {props.subject} replaces the {what} set
        for the machine in this draft. Nothing is saved until you save setup.
      </p>
      <div>
        <Button variant="danger" onClick={props.onReplace}>
          Replace settings
        </Button>
        <Button onClick={props.onKeep}>Keep current settings</Button>
      </div>
    </div>
  );
}
