import { Button, Dialog, DialogActions, NumberInput } from '../kit';
import type { ProductionNestDefinition } from '../../core/nesting/production-nest';
import { ProductionNestPartFields } from './ProductionNestPartFields';
import { ProductionNestStockFields } from './ProductionNestStockFields';
import { ProductionNestReview } from './ProductionNestReview';
import { useProductionNestForm } from './use-production-nest-form';
import { useProductionNestReview } from './use-production-nest-review';

export function ProductionNestDialogHost(props: {
  readonly onClose: () => void;
  readonly onBack: () => void;
}): JSX.Element {
  const form = useProductionNestForm();
  const review = useProductionNestReview(props.onClose);
  const close = (): void => {
    review.reset();
    props.onClose();
  };
  return (
    <Dialog title="Quantity production" size="lg" onClose={close}>
      <fieldset
        disabled={review.running || review.draft !== null}
        style={{ display: 'grid', gap: 12, margin: 0, padding: 0, border: 0 }}
      >
        <label>
          Production name{' '}
          <input
            title="Name this retained production nesting layout"
            value={form.definition.name}
            maxLength={200}
            onChange={(event) => form.change({ name: event.currentTarget.value })}
          />
        </label>
        <p>
          Each part includes its grouped artwork, engraving and linked guides. Material and
          thickness must match stock. Permitted turns must respect declared part and stock grain.
        </p>
        {form.definition.parts.map((part) => (
          <ProductionNestPartFields
            key={part.id}
            part={part}
            onChange={form.partChange}
            onRemove={() =>
              form.change({
                parts: form.definition.parts.filter((current) => current.id !== part.id),
              })
            }
          />
        ))}
        <Button onClick={form.addSelection}>Add selection as part</Button>
        {form.definition.sheets.map((stock) => (
          <ProductionNestStockFields
            key={stock.id}
            stock={stock}
            onChange={form.stockChange}
            onRemove={() =>
              form.change({
                sheets: form.definition.sheets.filter((current) => current.id !== stock.id),
              })
            }
          />
        ))}
        <Button onClick={form.addSheet}>Add stock sheet or remnant</Button>
        <ProductionNestOptions definition={form.definition} change={form.change} />
        <Button onClick={form.save}>Save production definition</Button>
      </fieldset>
      {review.draft !== null && review.progress !== null && (
        <ProductionNestReview
          input={review.draft.input}
          progress={review.progress}
          running={review.running}
          stale={review.stale}
        />
      )}
      <ProductionReviewActions
        review={review}
        onCancel={close}
        onBack={() => {
          review.reset();
          props.onBack();
        }}
        onCalculate={() => review.calculate(form.definition)}
      />
    </Dialog>
  );
}
function ProductionNestOptions(props: {
  readonly definition: ProductionNestDefinition;
  readonly change: (patch: Partial<ProductionNestDefinition>) => void;
}): JSX.Element {
  const { definition, change } = props;
  return (
    <>
      <label>
        Part spacing (mm){' '}
        <NumberInput
          value={String(definition.padding)}
          min={0}
          step={0.1}
          onChange={(event) => change({ padding: Number(event.currentTarget.value) })}
        />
      </label>
      <label>
        Production layout goal{' '}
        <select
          title="Choose a compact, tidy or grid arrangement for the production layout"
          value={definition.goal}
          onChange={(event) =>
            change({ goal: event.currentTarget.value as ProductionNestDefinition['goal'] })
          }
        >
          <option value="compact">Compact</option>
          <option value="tidy">Tidy</option>
          <option value="grid">Grid</option>
        </select>
      </label>
      <label>
        Production nesting method{' '}
        <select
          title="Choose closed-outline nesting or conservative rectangular bounds"
          value={definition.method}
          onChange={(event) =>
            change({ method: event.currentTarget.value as ProductionNestDefinition['method'] })
          }
        >
          <option value="outline">Closed outlines</option>
          <option value="fast">Conservative rectangular bounds</option>
        </select>
      </label>
      <label>
        <input
          title="Compare up to 24 deterministic arrangements before choosing a layout"
          type="checkbox"
          checked={definition.optimise}
          onChange={(event) => change({ optimise: event.currentTarget.checked })}
        />{' '}
        Compare up to 24 deterministic arrangements
      </label>
      <p>
        Spacing reserves half the gap at the stock edge. A rectangular remnant uses its declared
        usable rectangle. Acceptance creates named sheets for review; source artwork stays active.
      </p>
    </>
  );
}
function ProductionReviewActions(props: {
  readonly review: ReturnType<typeof useProductionNestReview>;
  readonly onCancel: () => void;
  readonly onBack: () => void;
  readonly onCalculate: () => void;
}): JSX.Element {
  const { review } = props;
  const best = review.progress?.best;
  const hasBest = best !== null && best !== undefined && best.produced > 0;
  return (
    <DialogActions>
      <Button onClick={props.onCancel}>Cancel</Button>
      <Button onClick={props.onBack}>Back to Quick Nest</Button>
      {review.running && <Button onClick={review.stop}>Stop quantity search</Button>}
      {review.draft !== null && !review.running && (
        <Button onClick={review.reset}>Change production settings</Button>
      )}
      {review.draft === null ? (
        <Button variant="primary" onClick={props.onCalculate}>
          Calculate quantity layout
        </Button>
      ) : (
        <Button
          variant="primary"
          disabled={!hasBest || review.stale}
          onClick={() => review.accept((best?.unplaced ?? 0) > 0)}
        >
          {(best?.unplaced ?? 0) > 0
            ? 'Accept partial production with unplaced copies'
            : 'Accept complete quantities'}
        </Button>
      )}
    </DialogActions>
  );
}
