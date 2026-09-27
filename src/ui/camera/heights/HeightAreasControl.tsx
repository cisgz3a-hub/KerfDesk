// HeightAreasControl — the Camera panel's list of height areas (ADR-441
// Amendment 2). The material height corrects the whole picture to one surface;
// an area gives one part of the bed, such as a box standing on the sheet, its
// own height, so that object's top lines up on the canvas and traces where it
// really is. Each area can be traced on its own at a finer density.

import { useState } from 'react';
import { clipAreaToBed, type SurfaceHeightArea } from '../../../core/camera/model/height-areas';
import { combinedBBox, type Project } from '../../../core/scene';
import { useStore } from '../../state';
import { useCameraStore, type HeightAreaPatch } from '../../state/camera-store';
import { useTraceFromCamera } from '../use-trace-from-camera';
import { newHeightArea } from './new-height-area';

export function HeightAreasControl(): JSX.Element {
  const areas = useCameraStore((s) => s.heightAreas);
  const addHeightArea = useCameraStore((s) => s.addHeightArea);
  const [focusId, setFocusId] = useState<string | null>(null);

  const add = (): void => {
    const { project, selectedObjectId, additionalSelectedIds } = useStore.getState();
    const area = newHeightArea({
      id: crypto.randomUUID(),
      selectionBounds: combinedBBox(
        selectedObjects(project, selectedObjectId, additionalSelectedIds),
      ),
      surfaceHeightMm: useCameraStore.getState().surfaceHeightMm,
      bedWidthMm: project.device.bedWidth,
      bedHeightMm: project.device.bedHeight,
    });
    if (area === null) return;
    addHeightArea(area);
    setFocusId(area.id);
  };

  return (
    <div style={sectionStyle}>
      <div style={headerStyle}>
        <span>Object heights</span>
        <button
          type="button"
          className="lf-btn"
          onClick={add}
          title="Give part of the bed its own height. With objects selected, the area goes around them; otherwise it starts in the middle of the bed."
        >
          Add height area
        </button>
      </div>
      {areas.length === 0 ? (
        <div style={hintStyle}>
          Something taller than the material, such as a box? Select it, or the artwork on it, and
          add a height area so its top lines up too.
        </div>
      ) : null}
      {areas.map((area, index) => (
        <HeightAreaRow key={area.id} area={area} index={index} autoFocus={area.id === focusId} />
      ))}
    </div>
  );
}

function HeightAreaRow(props: {
  readonly area: SurfaceHeightArea;
  readonly index: number;
  readonly autoFocus: boolean;
}): JSX.Element {
  const { area } = props;
  const name = `Area ${props.index + 1}`;
  const update = useCameraStore((s) => s.updateHeightArea);
  const remove = useCameraStore((s) => s.removeHeightArea);
  const bedWidth = useStore((s) => s.project.device.bedWidth);
  const bedHeight = useStore((s) => s.project.device.bedHeight);
  const tracing = useTraceFromCamera();
  const set = (patch: HeightAreaPatch): void => update(area.id, patch);
  return (
    <div style={rowStyle} data-testid="camera-height-area">
      <div style={lineStyle}>
        <strong>{name}</strong>
        <NumberField
          label="Height"
          ariaLabel={`${name} height above bed`}
          value={area.surfaceHeightMm}
          onChange={(value) => set({ surfaceHeightMm: value })}
          autoFocus={props.autoFocus}
        />
        <span style={spacerStyle} />
        <button
          type="button"
          className="lf-btn"
          disabled={!tracing.available}
          onClick={() => void tracing.trace(clipAreaToBed(area, bedWidth, bedHeight) ?? area)}
          title="Capture the camera and trace only this area, at twice the detail of a whole-bed trace."
        >
          Trace area
        </button>
        <button
          type="button"
          className="lf-btn"
          onClick={() => remove(area.id)}
          title="Remove this height area; the camera picture there goes back to the material height."
        >
          Remove
        </button>
      </div>
      <div style={lineStyle}>
        <NumberField
          label="X"
          ariaLabel={`${name} left edge`}
          value={area.x}
          onChange={(x) => set({ x })}
        />
        <NumberField
          label="Y"
          ariaLabel={`${name} top edge`}
          value={area.y}
          onChange={(y) => set({ y })}
        />
        <NumberField
          label="W"
          ariaLabel={`${name} width`}
          value={area.width}
          onChange={(width) => set({ width })}
        />
        <NumberField
          label="D"
          ariaLabel={`${name} depth along Y`}
          value={area.height}
          onChange={(height) => set({ height })}
        />
      </div>
    </div>
  );
}

function NumberField(props: {
  readonly label: string;
  readonly ariaLabel: string;
  readonly value: number;
  readonly onChange: (value: number) => void;
  readonly autoFocus?: boolean;
}): JSX.Element {
  return (
    <label style={fieldStyle}>
      {props.label}
      <input
        type="number"
        step={0.1}
        value={round(props.value)}
        aria-label={props.ariaLabel}
        title={props.ariaLabel}
        autoFocus={props.autoFocus}
        onChange={(event) => props.onChange(Number(event.currentTarget.value))}
        style={inputStyle}
      />
      mm
    </label>
  );
}

// Selection bounds come from transformed geometry; a tenth of a millimetre is
// all a camera placement can use.
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function selectedObjects(
  project: Project,
  primary: string | null,
  additional: ReadonlySet<string>,
) {
  const ids = new Set([...(primary === null ? [] : [primary]), ...additional]);
  return project.scene.objects.filter((object) => ids.has(object.id));
}

const sectionStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
};
const hintStyle: React.CSSProperties = { fontSize: 12, color: 'var(--lf-text-faint)' };
const rowStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid var(--lf-border)',
  fontSize: 12,
};
const lineStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
};
const spacerStyle: React.CSSProperties = { flex: 1 };
const fieldStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 4 };
const inputStyle: React.CSSProperties = { width: 64 };
