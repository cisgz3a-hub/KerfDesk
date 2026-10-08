import { useState } from 'react';
import {
  surfaceGridCsv,
  type SurfaceGridMeasurement,
  type SurfaceGridRequest,
} from '../../../core/controllers/grbl/surface-grid-probe';
import { usePlatformOptional } from '../../app/platform-context';
import { Dialog, DialogActions } from '../../kit/Dialog';
import { useLaserStore } from '../../state/laser-store';
import { surfaceProbeBlockReason } from '../../state/laser-surface-probe-actions';

const INITIAL = {
  minX: 0,
  minY: 0,
  maxX: 50,
  maxY: 50,
  columns: 3,
  rows: 3,
  seekFeed: 150,
  probeFeed: 25,
  travelFeed: 500,
  maxTravelMm: 10,
};
const FIELDS: ReadonlyArray<{ readonly key: keyof typeof INITIAL; readonly label: string }> = [
  { key: 'minX', label: 'Minimum work X (mm)' },
  { key: 'minY', label: 'Minimum work Y (mm)' },
  { key: 'maxX', label: 'Maximum work X (mm)' },
  { key: 'maxY', label: 'Maximum work Y (mm)' },
  { key: 'columns', label: 'Columns' },
  { key: 'rows', label: 'Rows' },
  { key: 'seekFeed', label: 'Seek feed (mm/min)' },
  { key: 'probeFeed', label: 'Slow contact feed (mm/min)' },
  { key: 'travelFeed', label: 'Travel feed (mm/min)' },
  { key: 'maxTravelMm', label: 'Maximum downward travel (mm)' },
];

function useSurfaceProbe(props: { readonly onClose: () => void }) {
  const platform = usePlatformOptional();
  const laser = useLaserStore();
  const [values, setValues] = useState(INITIAL);
  const [prepared, setPrepared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [measurement, setMeasurement] = useState<SurfaceGridMeasurement | null>(null);
  const [message, setMessage] = useState('');
  const blocked = surfaceProbeBlockReason(laser);
  const close = (): void => {
    if (busy)
      setMessage(
        'Measurement is active. Use Abort motion and wait for controller cleanup before closing.',
      );
    else props.onClose();
  };
  const measure = async (): Promise<void> => {
    if (busy || !prepared) return;
    const request: SurfaceGridRequest = { ...values, clearancePrepared: true };
    setBusy(true);
    setMeasurement(null);
    setMessage('Collecting contacts; keep the whole region clear. Abort motion remains available.');
    try {
      const result = await laser.measureSurfaceGrid(request);
      setMeasurement(result.measurement ?? null);
      setMessage(
        result.kind === 'ok'
          ? 'Grid complete and settled. Review the measured coordinates before exporting.'
          : result.reason,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      setPrepared(false);
    }
  };
  const save = async (): Promise<void> => {
    if (measurement === null || platform === null) return;
    const captured = surfaceGridCsv(measurement);
    try {
      const target = await platform.pickFileForSave({
        suggestedName: 'surface-grid.csv',
        extensions: ['.csv'],
      });
      if (target === null) setMessage('Surface export cancelled.');
      else {
        await target.write(captured);
        setMessage('Reviewed surface coordinates saved locally.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };
  return {
    platform,
    laser,
    values,
    setValues,
    prepared,
    setPrepared,
    busy,
    measurement,
    message,
    setMessage,
    blocked,
    close,
    measure,
    save,
  };
}

type SurfaceProbeView = ReturnType<typeof useSurfaceProbe>;

export function SurfaceProbeDialog(props: { readonly onClose: () => void }): JSX.Element {
  const view = useSurfaceProbe(props);
  const { close, prepared, setPrepared, busy, blocked, message, measurement } = view;
  return (
    <Dialog title="Measure surface grid" size="lg" onClose={close}>
      <p>
        Measure a stationary surface with a powered Z axis and a working probe. Raise the tool above
        the entire rectangle first: its current work Z becomes the clearance plane for every XY
        move. Each point uses a fast contact, a 2 mm lift, and a 3 mm slow contact.
      </p>
      <p>
        The cycle keeps the current work offsets, ends in millimetres, absolute positioning and feed
        per minute, and returns Z to the captured clearance height. This records coordinates for
        review and CSV; it does not apply height compensation.
      </p>
      <SurfaceProbeFields view={view} />
      <label>
        <input
          type="checkbox"
          title="Confirm current tool height clears the entire requested surface and the probe is connected."
          checked={prepared}
          disabled={busy}
          onChange={(event) => setPrepared(event.target.checked)}
        />
        Current Z clears the entire region, the probe is connected, and the spindle is off.
      </label>
      {blocked !== null && !busy && <p>{blocked}</p>}
      {message !== '' && <p role="status">{message}</p>}
      {measurement !== null && <SurfaceProbeReview measurement={measurement} />}
      <SurfaceProbeActions view={view} />
    </Dialog>
  );
}

function SurfaceProbeFields({ view }: { readonly view: SurfaceProbeView }): JSX.Element {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
      {FIELDS.map(({ key, label }) => (
        <label key={key}>
          {label}
          <input
            type="number"
            title={label}
            aria-label={label}
            value={view.values[key]}
            disabled={view.busy}
            step={
              ['columns', 'rows', 'seekFeed', 'probeFeed', 'travelFeed'].includes(key) ? 1 : 0.001
            }
            onChange={(event) => {
              view.setValues({ ...view.values, [key]: event.target.valueAsNumber });
              view.setPrepared(false);
            }}
          />
        </label>
      ))}
    </div>
  );
}

function SurfaceProbeActions({ view }: { readonly view: SurfaceProbeView }): JSX.Element {
  const {
    close,
    busy,
    laser,
    setMessage,
    blocked,
    prepared,
    measure,
    measurement,
    platform,
    save,
  } = view;
  return (
    <DialogActions>
      <button type="button" title="Close surface measurement after motion cleanup." onClick={close}>
        Close
      </button>
      <button
        type="button"
        title="Abort the owned controller operation using the normal machine Abort workflow."
        disabled={!busy}
        onClick={() =>
          void laser
            .stopJob()
            .catch((error: unknown) =>
              setMessage(error instanceof Error ? error.message : String(error)),
            )
        }
      >
        Abort motion
      </button>
      <button
        type="button"
        title={blocked ?? 'Collect the reviewed surface grid'}
        disabled={busy || blocked !== null || !prepared}
        onClick={() => void measure()}
      >
        Measure grid
      </button>
      <button
        type="button"
        title="Save the currently reviewed coordinates as a local CSV."
        disabled={busy || measurement === null || platform === null}
        onClick={() => void save()}
      >
        Save reviewed CSV…
      </button>
    </DialogActions>
  );
}

function SurfaceProbeReview({
  measurement,
}: {
  readonly measurement: SurfaceGridMeasurement;
}): JSX.Element {
  const heights = measurement.points.map((point) => point.z);
  const minimum = heights.length === 0 ? null : Math.min(...heights);
  const maximum = heights.length === 0 ? null : Math.max(...heights);
  return (
    <section aria-label="Measured surface review">
      <p>
        {measurement.complete ? 'Complete grid' : 'Partial grid'}: {measurement.points.length}/
        {measurement.request.rows * measurement.request.columns} contacts. {measurement.activeWcs},
        clearance Z {measurement.clearanceZMm.toFixed(3)} mm.{' '}
        {minimum !== null &&
          maximum !== null &&
          `Measured Z range ${minimum.toFixed(4)}–${maximum.toFixed(4)} mm; spread ${(maximum - minimum).toFixed(4)} mm.`}
      </p>
      <table>
        <thead>
          <tr>
            <th>Row</th>
            <th>Column</th>
            <th>Work X (mm)</th>
            <th>Work Y (mm)</th>
            <th>Work Z (mm)</th>
          </tr>
        </thead>
        <tbody>
          {measurement.points.map((point) => (
            <tr key={`${point.row}:${point.column}`}>
              <td>{point.row + 1}</td>
              <td>{point.column + 1}</td>
              <td>{point.x.toFixed(3)}</td>
              <td>{point.y.toFixed(3)}</td>
              <td>{point.z.toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
