import { Button } from '../kit';
import { useTemplateVectorRepair } from './use-template-vector-repair';

/** Repairs use the established geometry engine and its undo action after a separate preview. */
export function TemplateVectorRepair(): JSX.Element {
  const model = useTemplateVectorRepair();
  return (
    <details aria-label="Template vector repair">
      <summary title="Preview a vector path repair before applying the template">
        Review a path repair
      </summary>
      <label>
        Join tolerance (mm){' '}
        <input
          title="Set the maximum endpoint gap in millimetres for a proposed path join"
          aria-label="Template repair join tolerance"
          type="number"
          min="0"
          max="10"
          step="0.01"
          value={model.tolerance}
          onChange={(event) => model.setTolerance(event.currentTarget.value)}
        />
      </label>
      <Button disabled={!model.canReview} onClick={model.review}>
        Review path repair
      </Button>
      <Button disabled={!model.canApply} onClick={model.apply}>
        Apply path repair
      </Button>
      {model.status === '' ? null : <p role="status">{model.status}</p>}
    </details>
  );
}
