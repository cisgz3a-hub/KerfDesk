// One CNC operation in the Job Review (ADR-224 v3): cut type, bit, depth,
// depth per pass, feed, plunge and spindle speed as read-only values, the
// strategy detail line and the folded compiled summary. CNC changes belong
// in Artwork settings (ADR-306), so the card has no Edit.

import { cutTypeLabel, type CncCutType, type CncLayerSettings } from '../../../core/scene';
import { valueGridStyle } from './job-review-card.styles';
import type { CompiledReliefFacts } from './job-review-detail-facts';
import type { JobReviewEffectiveOperation } from './job-review-effective-operations';
import {
  CompiledSummary,
  formatReviewNumber,
  OperationCard,
  OperationCardHeader,
  OperationDetail,
  ValueOutput,
  ValueTile,
} from './JobReviewCardParts';

export type CncOperationCardProps = {
  readonly operationId: string;
  readonly name: string;
  readonly color: string;
  readonly toolName: string;
  readonly meta: string;
  readonly settings: CncLayerSettings;
  readonly detail: string;
  readonly effective: JobReviewEffectiveOperation | undefined;
  readonly effectiveOperations: ReadonlyArray<JobReviewEffectiveOperation>;
};

export function JobReviewCncOperationCard(props: CncOperationCardProps): JSX.Element {
  const { settings, name } = props;
  return (
    <OperationCard ariaLabel={`${name} settings`} color={props.color}>
      <OperationCardHeader
        color={props.color}
        name={name}
        chip={cutChip(settings.cutType, props.effective?.relief)}
        material={null}
        meta={props.meta}
      />
      <div style={valueGridStyle}>
        <ValueTile label="Bit">
          <ValueOutput label={`Tool for ${name}`} value={props.toolName} isWord />
        </ValueTile>
        <CncDepthTile {...props} />
        <ReadOnlyTile
          label="Per pass"
          aria={`Depth per pass mm for ${name}`}
          value={settings.depthPerPassMm}
          unit="mm"
        />
        <ReadOnlyTile
          label="Feed"
          aria={`Feed mm/min for ${name}`}
          value={settings.feedMmPerMin}
          unit="mm/min"
        />
        <ReadOnlyTile
          label="Plunge"
          aria={`Plunge mm/min for ${name}`}
          value={settings.plungeMmPerMin}
          unit="mm/min"
        />
        <ReadOnlyTile
          label="Spindle"
          aria={`Spindle RPM for ${name}`}
          value={settings.spindleRpm}
          unit="RPM"
        />
      </div>
      <OperationDetail text={props.detail} />
      <CompiledSummary
        operationId={props.operationId}
        effectiveOperations={props.effectiveOperations}
      />
    </OperationCard>
  );
}

/** The cut type, or Relief when the compiled job cuts only reliefs, since
 * that cut type then reaches no shape. */
function cutChip(
  cutType: CncCutType,
  relief: CompiledReliefFacts | undefined,
): { readonly label: string; readonly title?: string } {
  const label = cutTypeLabel(cutType);
  if (!cutsOnlyReliefs(relief)) return { label };
  return {
    label: 'Relief',
    title: `This operation cuts only reliefs. Its cut type, ${label}, applies to other shapes only.`,
  };
}

// Depth shows Cut depth unless no shape is cut to it. A flowing V-carve's
// depth comes from the artwork width and bit (ADR-285), and an operation that
// cuts only reliefs takes each relief's own depth (ADR-224 Amendment 4), so
// both show the deepest compiled pass instead.
function CncDepthTile(props: CncOperationCardProps): JSX.Element {
  const { settings, name, effective } = props;
  const relief = effective?.relief;
  if (cutsOnlyReliefs(relief)) {
    return (
      <ActualDepthTile
        name={name}
        title="Deepest compiled relief pass, including any flat cleanup or finishing passes. Depth comes from each relief, not from Cut depth."
        depthMm={relief.maxDepthMm}
      />
    );
  }
  if (settings.cutType === 'v-carve' && settings.vCarveFlatDepthEnabled === false) {
    return (
      <ActualDepthTile
        name={name}
        title="Flowing V-carve depth is calculated from the artwork width and selected bit"
        depthMm={effective?.cncActualMaxDepthMm}
      />
    );
  }
  return (
    <ReadOnlyTile
      label="Depth"
      aria={`Cut depth mm for ${name}`}
      value={settings.depthMm}
      unit="mm"
    />
  );
}

function ActualDepthTile(props: {
  readonly name: string;
  readonly title: string;
  readonly depthMm: number | undefined;
}): JSX.Element {
  return (
    <ValueTile label="Depth" title={props.title}>
      <ValueOutput
        label={`Actual compiled max depth mm for ${props.name}`}
        value={
          props.depthMm === undefined ? 'Pending' : `${formatReviewNumber(props.depthMm)} mm actual`
        }
        title={props.title}
      />
    </ValueTile>
  );
}

function ReadOnlyTile(props: {
  readonly label: string;
  readonly aria: string;
  readonly value: number;
  readonly unit: string;
}): JSX.Element {
  return (
    <ValueTile label={props.label}>
      <ValueOutput label={props.aria} value={formatReviewNumber(props.value)} unit={props.unit} />
    </ValueTile>
  );
}

// An operation whose compiled job cut reliefs and nothing else: its cut type
// and Cut depth reach no shape (ADR-224 Amendment 4).
function cutsOnlyReliefs(relief: CompiledReliefFacts | undefined): relief is CompiledReliefFacts {
  return relief?.cutsOtherShapes === false;
}
