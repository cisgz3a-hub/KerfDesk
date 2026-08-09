import type { CncStartupSetupField } from './machine-setup-dialog-store';

const FIELD_ID_PREFIX = 'machine-setup-cnc-';

export function machineSetupFieldId(field: CncStartupSetupField): string {
  return `${FIELD_ID_PREFIX}${field}`;
}

export function MachineSetupFieldAnchor(props: {
  readonly field: CncStartupSetupField;
  readonly label: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <div
      id={machineSetupFieldId(props.field)}
      tabIndex={-1}
      aria-label={props.label}
      style={anchorStyle}
    >
      {props.children}
    </div>
  );
}

const anchorStyle: React.CSSProperties = {
  borderRadius: 5,
  outlineOffset: 3,
};
