import type {
  ProductionNestingInput,
  ProductionNestingProgress,
} from '../../core/nesting/production-nest';
import {
  productionNestCopies,
  productionSheetInput,
} from '../../core/nesting/production-nest-plan';
import { NestDraftPreview } from './NestDraftPreview';

export function ProductionNestReview(props: {
  readonly input: ProductionNestingInput;
  readonly progress: ProductionNestingProgress;
  readonly running: boolean;
  readonly stale: boolean;
}): JSX.Element {
  const { best } = props.progress;
  return (
    <section aria-label="Production quantity review" style={{ display: 'grid', gap: 12 }}>
      <p role="status">
        {props.running ? 'Searching' : 'Search stopped or complete'} · {props.progress.attempted} /{' '}
        {props.progress.total} arrangements tried.
      </p>
      {props.stale && (
        <p role="alert">
          Artwork or setup changed. Calculate a fresh quantity draft before accepting.
        </p>
      )}
      {best === null ? (
        <p>No valid draft has been calculated.</p>
      ) : (
        <>
          <p>
            {best.produced} of {best.requested} requested copies placed. {best.unplaced} unplaced.
          </p>
          <table>
            <thead>
              <tr>
                <th>Part</th>
                <th>Requested</th>
                <th>Placed</th>
                <th>Unplaced</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {best.quantities.map((quantity) => (
                <tr key={quantity.partId}>
                  <td>
                    {props.input.definition.parts.find((part) => part.id === quantity.partId)?.name}
                  </td>
                  <td>{quantity.requested}</td>
                  <td>{quantity.produced}</td>
                  <td>{quantity.unplaced}</td>
                  <td>{quantity.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            Used stock utilisation: {best.stockUtilisationPercent.toFixed(1)}% (
            {best.occupiedAreaMm2.toFixed(1)} / {best.stockAreaMm2.toFixed(1)} mm²). Vector geometry
            estimate: {best.vectorLengthMm.toFixed(1)} mm. Placement travel estimate:{' '}
            {best.placementTravelMm.toFixed(1)} mm. Executable cut and rapid distances are
            calculated during job preparation.
          </p>
          <ProductionSheetPreviews input={props.input} sheets={best.sheets} />
        </>
      )}
    </section>
  );
}
function ProductionSheetPreviews({
  input,
  sheets,
}: {
  readonly input: ProductionNestingInput;
  readonly sheets: NonNullable<ProductionNestingProgress['best']>['sheets'];
}): JSX.Element {
  const copies = productionNestCopies(input);
  return (
    <>
      {sheets.map((layout) => {
        const stock = input.definition.sheets.find((sheet) => sheet.id === layout.sheetId);
        if (stock === undefined) return null;
        const ids = new Set(layout.placements.map((placement) => placement.id));
        return (
          <section key={layout.sheetId}>
            <strong>
              {stock.name} · {stock.stockId} · {stock.materialKey} {stock.thicknessMm} mm ·{' '}
              {layout.placements.length} copies · {layout.stockUtilisationPercent.toFixed(1)}%
            </strong>
            <NestDraftPreview
              input={productionSheetInput(
                input,
                stock,
                copies.filter((copy) => ids.has(copy.id)),
              )}
              layout={layout}
            />
          </section>
        );
      })}
    </>
  );
}
