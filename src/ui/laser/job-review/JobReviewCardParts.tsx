// Shared building blocks of the Job Review operation cards (ADR-224 v3): the
// colour-edged card frame and header, a labelled value tile, the power meter
// and air pill, the muted one-line detail, and the folded partial compiled
// summary (ADR-224 Amendment, 2026-08-02).

import type { ReactNode, Ref } from 'react';
import {
  airDotStyle,
  airPillStyle,
  cardHeaderStyle,
  cardMetaStyle,
  cardNameStyle,
  cardParentNameStyle,
  compiledDetailsStyle,
  compiledListStyle,
  compiledSummaryStyle,
  detailLineStyle,
  materialChipDotStyle,
  materialChipStyle,
  meterFillStyle,
  meterTrackStyle,
  modeChipStyle,
  operationCardStyle,
  swatchStyle,
  valueLabelStyle,
  valueTextStyle,
  valueTileStyle,
  valueUnitStyle,
  valueWordStyle,
} from './job-review-card.styles';
import type { JobReviewEffectiveOperation } from './job-review-effective-operations';

export type MaterialChip = { readonly label: string; readonly color: string };

export function OperationCard(props: {
  readonly ariaLabel: string;
  readonly color: string;
  readonly isEditing?: boolean;
  readonly cardRef?: Ref<HTMLElement>;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <article
      ref={props.cardRef}
      aria-label={props.ariaLabel}
      style={operationCardStyle(props.color, props.isEditing === true)}
    >
      {props.children}
    </article>
  );
}

export function OperationCardHeader(props: {
  readonly color: string;
  readonly name: string;
  /** Set for a sub-operation: the operation it belongs to. */
  readonly parentName?: string;
  readonly chip: { readonly label: string; readonly title?: string };
  readonly material: MaterialChip | null;
  readonly meta: string;
  readonly children?: ReactNode;
}): JSX.Element {
  return (
    <div style={cardHeaderStyle}>
      <span
        aria-hidden="true"
        title={`Operation color ${props.color}`}
        style={{ ...swatchStyle, background: props.color }}
      />
      <span style={cardNameStyle} title={props.name}>
        {props.parentName === undefined ? null : (
          <span style={cardParentNameStyle}>{props.parentName} › </span>
        )}
        {props.name}
      </span>
      <span data-review-chip="" style={modeChipStyle} title={props.chip.title}>
        {props.chip.label}
      </span>
      {props.material === null ? null : (
        <span style={materialChipStyle}>
          <span
            aria-hidden="true"
            style={{ ...materialChipDotStyle, background: props.material.color }}
          />
          {props.material.label}
        </span>
      )}
      <span style={cardMetaStyle}>{props.meta}</span>
      {props.children}
    </div>
  );
}

export function ValueTile(props: {
  readonly label: string;
  readonly title?: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <div style={valueTileStyle} title={props.title}>
      <span style={valueLabelStyle}>{props.label}</span>
      {props.children}
    </div>
  );
}

/** A read-only number or word, named for assistive tech by `label`. */
export function ValueOutput(props: {
  readonly label: string;
  readonly value: string;
  readonly unit?: string;
  readonly isWord?: boolean;
  readonly title?: string;
}): JSX.Element {
  return (
    <span style={props.isWord === true ? valueWordStyle : valueTextStyle}>
      <output aria-label={props.label} title={props.title}>
        {props.value}
      </output>
      {props.unit === undefined ? null : <span style={valueUnitStyle}>{props.unit}</span>}
    </span>
  );
}

export function PowerMeter(props: { readonly percent: number }): JSX.Element {
  return (
    <div aria-hidden="true" style={meterTrackStyle}>
      <div style={meterFillStyle(props.percent)} />
    </div>
  );
}

export function AirPill(props: { readonly label: string; readonly isOn: boolean }): JSX.Element {
  return (
    <output aria-label={props.label} style={airPillStyle(props.isOn)}>
      <span aria-hidden="true" style={airDotStyle(props.isOn)} />
      {props.isOn ? 'On' : 'Off'}
    </output>
  );
}

export function OperationDetail(props: { readonly text: string }): JSX.Element {
  return (
    <p data-review-detail="" style={detailLineStyle}>
      {props.text}
    </p>
  );
}

export function CompiledSummary(props: {
  readonly operationId: string;
  readonly effectiveOperations: ReadonlyArray<JobReviewEffectiveOperation>;
}): JSX.Element | null {
  const operation = props.effectiveOperations.find((entry) => entry.layerId === props.operationId);
  if (operation === undefined || operation.summaries.length === 0) return null;
  return (
    <details style={compiledDetailsStyle}>
      <summary
        style={compiledSummaryStyle}
        title="Values read back from the exact prepared job. Groups with matching shown values are combined."
      >
        Partial compiled summary
      </summary>
      <ul style={compiledListStyle}>
        {operation.summaries.map((summary) => (
          <li key={summary}>{summary}</li>
        ))}
      </ul>
    </details>
  );
}

export { formatGroupedUpTo3Decimals as formatReviewNumber } from '../../../core/util/number-format';
