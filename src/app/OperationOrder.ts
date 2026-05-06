/**
 * T2-63: operation order preview with order warning. Pre-T2-63
 * the operation-order display at `src/ui/components/
 * ConnectionPanelMain.tsx:42-62` (jobModeLabel) was a single
 * label per layer; users could not see the operation order before
 * pressing Start, with a warning if the order was wrong.
 *
 * Cut-before-engrave is the classic mistake — once the piece is
 * cut out, it shifts and the engrave is misregistered. T2-63
 * surfaces this risk before the operator commits.
 *
 * Audit 4B Priority 9.
 *
 * T2-63 ships the analysis layer (typed operation kinds + the
 * per-row preview type + the order-warning detector) so the UI
 * (T2-58 ReadyToRunPanel) can render it. UI integration is filed
 * as T2-63-followup.
 */

export type OperationKind =
  | 'engrave'
  | 'image'
  | 'score'
  | 'cut'
  | 'travel-only';

export interface OperationRow {
  readonly index: number;       // 1-based for display
  readonly layerName: string;
  readonly kind: OperationKind;
  readonly powerPercent: number;
  readonly feedRateMmPerMin: number;
  readonly passes: number;
}

export type OrderWarningKind =
  | 'cut-before-engrave'
  | 'cut-before-image'
  | 'cut-before-score';

export interface OrderWarning {
  readonly kind: OrderWarningKind;
  readonly cutAtIndex: number;       // 1-based index of the offending cut
  readonly engraveAtIndex: number;   // 1-based index of the engrave-class op the cut precedes
  readonly message: string;
}

export interface OrderAnalysis {
  readonly rows: readonly OperationRow[];
  readonly warnings: readonly OrderWarning[];
  readonly summaryOk: boolean;
}

/**
 * "Engrave-class" — operations that produce surface marks rather
 * than separating material. These should run BEFORE any cut whose
 * boundary they fall inside, otherwise the workpiece may shift
 * after the cut and ruin registration.
 */
function isEngraveClass(k: OperationKind): boolean {
  return k === 'engrave' || k === 'image' || k === 'score';
}

function warningKindForEngraveClass(k: OperationKind): OrderWarningKind {
  switch (k) {
    case 'engrave':       return 'cut-before-engrave';
    case 'image':         return 'cut-before-image';
    case 'score':         return 'cut-before-score';
    case 'cut':
    case 'travel-only':   return 'cut-before-engrave';  // shouldn't reach
  }
}

/**
 * Pure analysis: scan the row list, detect any `cut` that precedes
 * an engrave-class operation. Returns one warning per offending
 * pair (i.e. cut-at-1 + engrave-at-3 + image-at-5 → 2 warnings).
 *
 * Travel-only operations are skipped — they don't move material.
 */
export function analyzeOperationOrder(rows: readonly OperationRow[]): OrderAnalysis {
  const warnings: OrderWarning[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].kind !== 'cut') continue;
    for (let j = i + 1; j < rows.length; j++) {
      if (rows[j].kind === 'travel-only') continue;
      if (isEngraveClass(rows[j].kind)) {
        warnings.push({
          kind: warningKindForEngraveClass(rows[j].kind),
          cutAtIndex: rows[i].index,
          engraveAtIndex: rows[j].index,
          message: orderWarningMessage(rows[i], rows[j]),
        });
      }
    }
  }
  return {
    rows,
    warnings,
    summaryOk: warnings.length === 0,
  };
}

function orderWarningMessage(cut: OperationRow, engrave: OperationRow): string {
  const verb =
    engrave.kind === 'engrave' ? 'engrave'
    : engrave.kind === 'image' ? 'image'
    : 'score';
  return (
    `Cut '${cut.layerName}' (op ${cut.index}) runs before ${verb} ` +
    `'${engrave.layerName}' (op ${engrave.index}). ` +
    `The piece may shift after cutting, misregistering the ${verb}.`
  );
}

/** Pretty per-row label for the preview list. */
export function formatOperationRow(row: OperationRow): string {
  const kindLabel =
    row.kind === 'engrave' ? 'Engrave'
    : row.kind === 'image' ? 'Image'
    : row.kind === 'score' ? 'Score'
    : row.kind === 'cut' ? 'Cut'
    : 'Travel';
  const passes = row.passes > 1 ? ` — ${row.passes} passes` : '';
  return (
    `${row.index}. ${kindLabel} — ${row.layerName} — ` +
    `${row.powerPercent}% power — ${row.feedRateMmPerMin} mm/min${passes}`
  );
}

/** Top-level summary line for the preview header. */
export function summaryLine(analysis: OrderAnalysis): string {
  if (analysis.rows.length === 0) {
    return 'No operations to run.';
  }
  if (analysis.summaryOk) {
    const hasEngrave = analysis.rows.some(r => isEngraveClass(r.kind));
    const hasCut = analysis.rows.some(r => r.kind === 'cut');
    if (hasEngrave && hasCut) {
      return 'Order looks correct (engrave before cut).';
    }
    return 'Order looks correct.';
  }
  return `Order check: ${analysis.warnings.length} warning(s).`;
}

/** Predicate: is this analysis presentable to the operator without a confirm? */
export function orderRequiresAcknowledgement(analysis: OrderAnalysis): boolean {
  return analysis.warnings.length > 0;
}
