// RetainedScaleNotice — says how a canvas resize meets a sketch's or a part's
// dimensions (ADR-573 Amendment 1). An even resize is already folded into the
// values the editor shows; a stretch cannot be, and applying removes it.

import {
  retainedSourceScale,
  type RetainedSourceExtent,
} from '../../core/scene/retained-source-scale';

export function RetainedScaleNotice(props: {
  readonly source: RetainedSourceExtent | undefined;
  readonly subject: 'sketch' | 'part';
}): JSX.Element | null {
  if (props.source === undefined) return null;
  const scale = retainedSourceScale(props.source);
  if (scale.kind === 'unit') return null;
  if (scale.kind === 'even')
    return (
      <p role="status">
        This {props.subject} was resized to {percent(scale.factor)} on the canvas. The sizes here
        include that resize, so they are the sizes that burn.
      </p>
    );
  return (
    <p role="alert">
      This {props.subject} is stretched on the canvas (width {percent(scale.x)}, height{' '}
      {percent(scale.y)}). Its dimensions keep one scale, so applying returns it to the sizes here
      and its holes stay round.{' '}
      {props.subject === 'sketch'
        ? 'Bake as vectors keeps the stretched outline instead.'
        : 'Bake the part instead to keep the stretched outline.'}
    </p>
  );
}

function percent(factor: number): string {
  return `${Number((factor * 100).toFixed(2))}%`;
}
