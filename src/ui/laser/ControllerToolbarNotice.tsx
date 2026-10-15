import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** A brief notice stays inside the reserved toolbar space, never over the canvas. */
export function ControllerToolbarNotice(props: {
  readonly focusFallbackRef?: RefObject<HTMLButtonElement>;
  readonly message: string;
  readonly detail: string;
  readonly onShow: () => void;
}): JSX.Element | null {
  const [visible, setVisible] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => setVisible(true), []);
  useLayoutEffect(() => {
    const button = buttonRef.current;
    const fallback = props.focusFallbackRef?.current;
    return () => {
      if (button !== null && document.activeElement === button) fallback?.focus();
    };
  }, [props.focusFallbackRef, visible]);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const held = hovered || focused;
  useEffect(() => {
    if (held) return;
    const timer = window.setTimeout(() => setVisible(false), 6000);
    return () => window.clearTimeout(timer);
  }, [held]);
  if (!visible) return null;
  return (
    <div className="lf-controller-toolbar-notice" role="group" aria-label="Controller notification">
      <button
        ref={buttonRef}
        type="button"
        className="lf-btn lf-btn--ghost"
        title={`${props.message} ${props.detail} Show controller info.`}
        aria-label={`${props.message} Show controller info`}
        onClick={props.onShow}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        <span aria-hidden="true">ⓘ</span>
        <span className="lf-controller-toolbar-notice__text">{props.message}</span>
      </button>
    </div>
  );
}
