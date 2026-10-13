import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { SelectionAnchor } from '../../core/scene';
import { AnchoredPopover, movePopoverFocus } from '../common/AnchoredPopover';
import { Icon, type IconName } from '../kit/icons';

const ANCHORS: ReadonlyArray<SelectionAnchor> = ['nw', 'n', 'ne', 'w', 'c', 'e', 'sw', 's', 'se'];
const ANCHOR_NAMES: Readonly<Record<SelectionAnchor, string>> = {
  nw: 'top left',
  n: 'top center',
  ne: 'top right',
  w: 'middle left',
  c: 'center',
  e: 'middle right',
  sw: 'bottom left',
  s: 'bottom center',
  se: 'bottom right',
};
const ANCHOR_ICONS: Readonly<Record<SelectionAnchor, IconName>> = {
  nw: 'arrow-up-left',
  n: 'arrow-up',
  ne: 'arrow-up-right',
  w: 'arrow-left',
  c: 'crosshair',
  e: 'arrow-right',
  sw: 'arrow-down-left',
  s: 'arrow-down',
  se: 'arrow-down-right',
};

export function TransformAnchorPicker(props: {
  readonly active: SelectionAnchor;
  readonly disabled: boolean;
  readonly onChange: (anchor: SelectionAnchor) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverId = useId();
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (props.disabled) close();
  }, [props.disabled, close]);
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="lf-btn lf-transform-anchor-trigger"
        aria-label="Choose transform anchor"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        title={`Transform anchor: ${ANCHOR_NAMES[props.active]}. Choose the X/Y reference and resize anchor.`}
        disabled={props.disabled}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
      >
        <Icon name="crosshair" size={17} />
        <span>Anchor</span>
        <Icon name="chevron-down" size={13} />
      </button>
      {open ? (
        <AnchoredPopover
          id={popoverId}
          label="Transform anchor"
          role="dialog"
          anchorRef={triggerRef}
          className="lf-transform-anchor-popover"
          initialFocus='button[aria-pressed="true"]'
          onClose={close}
          onKeyDown={(event) => movePopoverFocus(event, 3)}
        >
          <div className="lf-transform-anchor-heading">Reference point</div>
          <div className="lf-transform-anchor-grid">
            {ANCHORS.map((anchor) => (
              <button
                key={anchor}
                type="button"
                className="lf-btn"
                aria-label={`Transform anchor: ${ANCHOR_NAMES[anchor]}`}
                title={anchorTitle(anchor)}
                aria-pressed={props.active === anchor}
                tabIndex={props.active === anchor ? 0 : -1}
                disabled={props.disabled}
                onClick={() => {
                  props.onChange(anchor);
                  close();
                  triggerRef.current?.focus();
                }}
              >
                <Icon name={ANCHOR_ICONS[anchor]} size={16} />
              </button>
            ))}
          </div>
        </AnchoredPopover>
      ) : null}
    </>
  );
}

function anchorTitle(anchor: SelectionAnchor): string {
  return `Use the selection ${ANCHOR_NAMES[anchor].replaceAll(' ', '-')} point as the X/Y reference and resize anchor. Rotation always pivots about the centre.`;
}
