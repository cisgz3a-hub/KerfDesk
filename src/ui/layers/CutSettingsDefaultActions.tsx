import { Button } from '../kit';

export type CutSettingsDefaultHandlers = {
  readonly onMakeDefault: () => void;
  readonly onMakeDefaultForAll: () => void;
  readonly onResetToDefault: () => void;
};

export function CutSettingsDefaultActions(props: CutSettingsDefaultHandlers): JSX.Element {
  return (
    <section className="lf-dialog-section" aria-label="Default layer settings" style={sectionStyle}>
      <Button
        type="button"
        onClick={props.onMakeDefault}
        title="Remember this layer's settings as the default for this color."
      >
        Make Default
      </Button>
      <Button
        type="button"
        onClick={props.onResetToDefault}
        title="Reset this layer to the saved default settings."
      >
        Reset to Default
      </Button>
      <Button
        type="button"
        onClick={props.onMakeDefaultForAll}
        title="Use this layer's settings as the default for all layer colors."
      >
        Make Default for All
      </Button>
    </section>
  );
}

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
};
