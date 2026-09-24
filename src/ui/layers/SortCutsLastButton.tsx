import { useSortCutsLast } from './use-sort-cuts-last';

const SORT_TITLE =
  'Run each Line cut after the engraving and other work inside it, so a part cannot drop or ' +
  'shift before that work runs. Every other order stays as it is. Undo restores the old order.';

/** Sort cuts last for the operations actions, Run order and Job Review.
 * `hideWhenSorted` (Job Review) checks the order and drops the button once
 * every cut runs last; elsewhere the button is always ready and a toast says
 * when there was nothing to move. Laser only. */
export function SortCutsLastButton(props: {
  readonly hideWhenSorted?: boolean;
  readonly className?: string;
  readonly title?: string;
}): JSX.Element | null {
  const hideWhenSorted = props.hideWhenSorted === true;
  const action = useSortCutsLast(hideWhenSorted);
  if (!action.applicable || (hideWhenSorted && !action.available)) return null;
  return (
    <button
      type="button"
      className={props.className ?? 'lf-btn'}
      title={props.title ?? SORT_TITLE}
      onClick={action.sort}
    >
      Sort cuts last
    </button>
  );
}
