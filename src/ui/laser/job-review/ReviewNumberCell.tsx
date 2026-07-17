// One debounced editable number cell in the Job Review layers table
// (ADR-224). Commits through useDebouncedCommit so typing follows the F-A7
// contract every other layer field honors: debounced store commits while
// typing, display reconciled on blur/external change, blank never commits.

import { NumberInput } from '../../kit';
import { useDebouncedCommit } from '../../layers/use-debounced-commit';
import { cellInputStyle, tableCellStyle } from './job-review-table.styles';

export function ReviewNumberCell(props: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max?: number;
  readonly step?: number | 'any';
  readonly isInteger?: boolean;
  readonly onCommit: (next: number) => void;
}): JSX.Element {
  const field = useDebouncedCommit<number>({
    value: props.value,
    commit: props.onCommit,
    parse: (input) => parseReviewNumber(input, props.value, props),
  });
  return (
    <td style={tableCellStyle}>
      <NumberInput
        aria-label={props.label}
        value={field.displayValue}
        onChange={field.onChange}
        onBlur={field.onBlur}
        min={props.min}
        {...(props.max === undefined ? {} : { max: props.max })}
        step={props.step ?? 1}
        style={cellInputStyle}
      />
    </td>
  );
}

function parseReviewNumber(
  input: string,
  fallback: number,
  range: { readonly min: number; readonly max?: number; readonly isInteger?: boolean },
): number {
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) return fallback;
  const stepped = range.isInteger === true ? Math.floor(parsed) : parsed;
  const lowClamped = Math.max(range.min, stepped);
  return range.max === undefined ? lowClamped : Math.min(range.max, lowClamped);
}
