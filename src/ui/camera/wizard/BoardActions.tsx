// BoardActions — the print/save row of the calibration SetupStep. Split out
// so SetupStep stays within the function-size limit and this owns one
// concern: getting a true-scale checkerboard onto paper.

import { usePlatform } from '../../app';
import { Button } from '../../kit';
import { useToastStore } from '../../state/toast-store';
import type { CheckerboardSpec } from '../../../core/camera';
import { checkerboardFileName, checkerboardSvg } from './checkerboard-svg';
import { printCheckerboard } from './print-checkerboard';

export function BoardActions(props: {
  readonly spec: CheckerboardSpec;
  readonly spacingMm: number;
}): JSX.Element {
  const platform = usePlatform();
  const pushToast = useToastStore((s) => s.pushToast);

  const printBoard = (): void => {
    const result = printCheckerboard(checkerboardSvg(props.spec, props.spacingMm));
    pushToast(
      result === 'printed'
        ? 'Print at 100% scale (no "fit to page"), check the 100 mm bar with a ruler, then mount it flat.'
        : 'Printing is not available here — use "Save…" instead, then print the file at 100% scale.',
      result === 'printed' ? 'success' : 'error',
    );
  };

  const saveBoard = async (): Promise<void> => {
    const target = await platform.pickFileForSave({
      suggestedName: checkerboardFileName(props.spec, props.spacingMm),
      extensions: ['.svg'],
    });
    if (target === null) return;
    await target.write(checkerboardSvg(props.spec, props.spacingMm));
    pushToast(
      'Checkerboard saved — print it at 100% scale, check the 100 mm bar with a ruler, and mount it flat.',
      'success',
    );
  };

  return (
    <div style={rowStyle}>
      <Button
        variant="primary"
        onClick={printBoard}
        title="Print a true-scale checkerboard (with a 100 mm verification bar) matching the numbers below."
      >
        Print checkerboard…
      </Button>
      <Button
        onClick={() => void saveBoard()}
        title="Save the checkerboard as an SVG to print later."
      >
        Save…
      </Button>
    </div>
  );
}

const rowStyle: React.CSSProperties = { display: 'flex', gap: 8 };
