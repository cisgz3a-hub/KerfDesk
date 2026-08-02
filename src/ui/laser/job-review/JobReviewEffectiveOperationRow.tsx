import type { JobReviewEffectiveOperation } from './job-review-effective-operations';
import { OperationDetailRow } from './JobReviewLayerCells';

export function JobReviewEffectiveOperationRow(props: {
  readonly colSpan: number;
  readonly layerId: string;
  readonly effectiveOperations: ReadonlyArray<JobReviewEffectiveOperation>;
}): JSX.Element | null {
  const operation = props.effectiveOperations.find((entry) => entry.layerId === props.layerId);
  if (operation === undefined || operation.summaries.length === 0) return null;
  return (
    <OperationDetailRow
      colSpan={props.colSpan}
      chip={null}
      text={`Exact compiled output: ${operation.summaries.join(' | ')}`}
    />
  );
}
