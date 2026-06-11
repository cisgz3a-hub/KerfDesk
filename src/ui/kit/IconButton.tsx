// IconButton — a square icon-only button. `label` is REQUIRED and becomes
// both aria-label and title: icon-only controls with no accessible name were
// a recurring audit-class gap (the JogPad arrows shipped nameless for two
// phases).

import { Icon, type IconName } from './icons';

type IconButtonSize = 'sm' | 'md' | 'lg';

const SIZE_CLASS: Readonly<Record<IconButtonSize, string>> = {
  sm: 'lf-btn lf-iconbtn lf-iconbtn--sm',
  md: 'lf-btn lf-iconbtn lf-iconbtn--md',
  lg: 'lf-btn lf-iconbtn lf-iconbtn--lg',
};

const ICON_PX: Readonly<Record<IconButtonSize, number>> = { sm: 12, md: 16, lg: 18 };

export function IconButton(props: {
  readonly icon: IconName;
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly size?: IconButtonSize;
  readonly pressed?: boolean;
}): JSX.Element {
  const size = props.size ?? 'md';
  return (
    <button
      type="button"
      className={SIZE_CLASS[size]}
      onClick={props.onClick}
      disabled={props.disabled ?? false}
      aria-label={props.label}
      title={props.label}
      {...(props.pressed === undefined ? {} : { 'aria-pressed': props.pressed })}
    >
      <Icon name={props.icon} size={ICON_PX[size]} />
    </button>
  );
}
