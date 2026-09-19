import { useState } from 'react';
import { useLaserStore } from '../state/laser-store';

/** A numerical mapping is an operator choice for this connection, not every
 * controller that happens to report the same S maximum. */
export function useSpindleScaleChoice(scale: number | undefined): {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
} {
  const sessionEpoch = useLaserStore((state) => state.controllerSessionEpoch);
  const [selection, setSelection] = useState<{
    readonly scale: number;
    readonly sessionEpoch: number;
  } | null>(null);
  return {
    checked: selection?.sessionEpoch === sessionEpoch && selection?.scale === scale,
    onChange: (checked) =>
      setSelection(checked && scale !== undefined ? { scale, sessionEpoch } : null),
  };
}
