import { DEFAULT_CNC_LAYER_SETTINGS, type Layer, type SceneObject } from '../../core/scene';
import { useStore } from '../state';
import {
  CNC_BULK_DEPTH_MAX_MM,
  CNC_BULK_DEPTH_MIN_MM,
  cncFixedDepthRole,
  type CncFixedDepthRole,
} from '../state/operation-actions';
import { inputStyle, Row, unitStyle } from './CncLayerPrimitives';
import { useDebouncedCommit } from './use-debounced-commit';

export function CncSelectionDepthField(props: {
  readonly objects: ReadonlyArray<SceneObject>;
  readonly operations: ReadonlyArray<Layer>;
}): JSX.Element {
  if (!props.objects.every((object) => 'paths' in object)) {
    return (
      <p role="note" style={noteStyle}>
        Bulk Cut depth is available when every selected artwork uses vector contours and compatible
        fixed-depth CNC operations.
      </p>
    );
  }
  const roles = props.operations.map(cncFixedDepthRole);
  if (roles.some((role) => role === null)) {
    return (
      <p role="note" style={noteStyle}>
        Bulk Cut depth is unavailable for this selection. Normal V-carve calculates depth from
        geometry; a V-carve flat floor uses its own Floor depth. Depth per pass stays unchanged.
      </p>
    );
  }
  const role = roles[0];
  if (role === undefined || role === null || roles.some((candidate) => candidate !== role)) {
    return (
      <p role="note" style={noteStyle}>
        Bulk depth is unavailable because Cut depth and inlay Insert depth have different meanings.
        Inspect those operations separately or use one shared operation.
      </p>
    );
  }
  const operationIds = props.operations.map((operation) => operation.id).sort();
  return (
    <CompatibleCncSelectionDepthField
      key={operationIds.join(':')}
      operations={props.operations}
      operationIds={operationIds}
      role={role}
    />
  );
}

function CompatibleCncSelectionDepthField(props: {
  readonly operations: ReadonlyArray<Layer>;
  readonly operationIds: ReadonlyArray<string>;
  readonly role: CncFixedDepthRole;
}): JSX.Element {
  const setDepth = useStore((state) => state.setCncDepthForOperations);
  const depths = props.operations.map(
    (operation) => (operation.cnc ?? DEFAULT_CNC_LAYER_SETTINGS).depthMm,
  );
  const commonDepth = depths.every((depth) => depth === depths[0]) ? (depths[0] ?? null) : null;
  const label = props.role === 'insert' ? 'Insert depth' : 'Cut depth';
  const debounced = useDebouncedCommit<number | null>({
    value: commonDepth,
    format: (value) => (value === null ? '' : String(value)),
    parse: (input) => {
      const parsed = Number.parseFloat(input);
      if (!Number.isFinite(parsed)) return null;
      return Math.max(CNC_BULK_DEPTH_MIN_MM, Math.min(CNC_BULK_DEPTH_MAX_MM, parsed));
    },
    commit: (depthMm) => {
      if (depthMm !== null) setDepth(props.operationIds, depthMm);
    },
  });
  return (
    <>
      <Row label={label}>
        <input
          type="number"
          min={CNC_BULK_DEPTH_MIN_MM}
          max={CNC_BULK_DEPTH_MAX_MM}
          step={0.5}
          value={debounced.displayValue}
          placeholder="Mixed"
          onChange={debounced.onChange}
          onBlur={debounced.onBlur}
          style={inputStyle}
          aria-label={`${label} for selected operations`}
          title={`Set one ${label.toLocaleLowerCase()} across the selected independent operations`}
        />
        <span style={unitStyle}>mm</span>
      </Row>
      <p role="note" style={noteStyle}>
        Changes only {label} across {props.operationIds.length} independent operations. Bit, feeds,
        Depth per pass, and other settings stay separate.
      </p>
    </>
  );
}

const noteStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--lf-text-muted)',
  fontSize: 11,
};
