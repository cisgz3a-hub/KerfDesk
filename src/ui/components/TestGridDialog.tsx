import React, { useEffect } from 'react';
import {
  generateTestGrid,
  computeGridWidth,
  computeGridHeight,
  DEFAULT_TEST_GRID,
  type TestGridOptions,
} from '../../core/tools/TestGridGenerator';

export interface TestGridDialogProps {
  open: boolean;
  onClose: () => void;
  onGenerate: (gcode: string, bounds: { width: number; height: number }) => void;
  defaultMaxSpindle: number;
  defaultBedWidth: number;
  defaultBedHeight: number;
}

export function TestGridDialog(props: TestGridDialogProps) {
  const { open, onClose, onGenerate, defaultMaxSpindle, defaultBedWidth, defaultBedHeight } = props;

  const [opts, setOpts] = React.useState<TestGridOptions>({
    ...DEFAULT_TEST_GRID,
    maxSpindle: defaultMaxSpindle || 1000,
  });
  const [powersStr, setPowersStr] = React.useState(() => DEFAULT_TEST_GRID.powers.join(', '));
  const [speedsStr, setSpeedsStr] = React.useState(() => DEFAULT_TEST_GRID.speeds.join(', '));

  useEffect(() => {
    if (!open) return;
    setOpts(o => ({ ...o, maxSpindle: defaultMaxSpindle || 1000 }));
  }, [open, defaultMaxSpindle]);

  if (!open) return null;

  const parseList = (s: string): number[] =>
    s.split(',').map(x => parseFloat(x.trim())).filter(x => Number.isFinite(x) && x >= 0);

  const parsedPowers = parseList(powersStr);
  const parsedSpeeds = parseList(speedsStr);

  const effectiveOpts: TestGridOptions = {
    ...opts,
    powers: parsedPowers.length > 0 ? parsedPowers : opts.powers,
    speeds: parsedSpeeds.length > 0 ? parsedSpeeds : opts.speeds,
  };

  const width = computeGridWidth(effectiveOpts);
  const height = computeGridHeight(effectiveOpts);
  const fits =
    width + effectiveOpts.originX <= defaultBedWidth &&
    height + effectiveOpts.originY <= defaultBedHeight;

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    color: '#888',
    marginBottom: 2,
    marginTop: 8,
  };
  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '6px 10px',
    background: '#0a0a14',
    border: '1px solid #252540',
    borderRadius: 4,
    color: '#e0e0ec',
    fontSize: 12,
    outline: 'none',
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: '#1a1a2e',
          border: '1px solid #252540',
          borderRadius: 8,
          padding: 24,
          width: 480,
          maxHeight: '90vh',
          overflowY: 'auto',
          color: '#e0e0ec',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Test Grid Generator</h2>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>
          Burns a grid varying power (rows) and speed (columns). Burn on your material, pick the best
          cell, read off the values.
        </div>

        <div style={labelStyle}>{`Power values (S): comma-separated, max ${opts.maxSpindle}`}</div>
        <input
          type="text"
          value={powersStr}
          style={inputStyle}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPowersStr(e.target.value)}
        />

        <div style={labelStyle}>Speed values (mm/min): comma-separated</div>
        <input
          type="text"
          value={speedsStr}
          style={inputStyle}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSpeedsStr(e.target.value)}
        />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <div style={labelStyle}>{`Cell size: ${opts.cellSizeMm} mm`}</div>
            <input
              type="range"
              min={4}
              max={30}
              step={1}
              value={opts.cellSizeMm}
              style={{ width: '100%' }}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setOpts(o => ({ ...o, cellSizeMm: parseFloat(e.target.value) }))
              }
            />
          </div>
          <div>
            <div style={labelStyle}>{`Cell gap: ${opts.cellGapMm} mm`}</div>
            <input
              type="range"
              min={0}
              max={10}
              step={0.5}
              value={opts.cellGapMm}
              style={{ width: '100%' }}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setOpts(o => ({ ...o, cellGapMm: parseFloat(e.target.value) }))
              }
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <div style={labelStyle}>{`Line interval: ${opts.lineIntervalMm} mm`}</div>
            <input
              type="range"
              min={0.05}
              max={1.0}
              step={0.05}
              value={opts.lineIntervalMm}
              style={{ width: '100%' }}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setOpts(o => ({ ...o, lineIntervalMm: parseFloat(e.target.value) }))
              }
            />
          </div>
          <div>
            <div style={labelStyle}>{`Passes: ${opts.passes}`}</div>
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={opts.passes}
              style={{ width: '100%' }}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setOpts(o => ({ ...o, passes: parseInt(e.target.value, 10) }))
              }
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <div style={labelStyle}>Origin X (mm)</div>
            <input
              type="number"
              value={opts.originX}
              style={inputStyle}
              min={0}
              max={defaultBedWidth}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setOpts(o => ({ ...o, originX: parseFloat(e.target.value) || 0 }))
              }
            />
          </div>
          <div>
            <div style={labelStyle}>Origin Y (mm)</div>
            <input
              type="number"
              value={opts.originY}
              style={inputStyle}
              min={0}
              max={defaultBedHeight}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setOpts(o => ({ ...o, originY: parseFloat(e.target.value) || 0 }))
              }
            />
          </div>
        </div>

        <label
          style={{
            ...labelStyle,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <input
            type="checkbox"
            checked={opts.includeLabels}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setOpts(o => ({ ...o, includeLabels: e.target.checked }))
            }
          />
          Include power/speed number labels
        </label>

        <div
          style={{
            marginTop: 12,
            padding: 10,
            background: fits ? '#0f2a1a' : '#2a0f0f',
            border: `1px solid ${fits ? '#2dd4a0' : '#ff4466'}`,
            borderRadius: 4,
            fontSize: 12,
          }}
        >
          {fits
            ? `Grid size: ${width.toFixed(1)} × ${height.toFixed(1)} mm — fits in ${defaultBedWidth}×${defaultBedHeight} bed`
            : `Grid size: ${width.toFixed(1)} × ${height.toFixed(1)} mm — EXCEEDS bed (${defaultBedWidth}×${defaultBedHeight}). Reduce values or move origin.`}
        </div>

        <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '6px 14px',
              background: '#252540',
              border: '1px solid #333355',
              borderRadius: 4,
              color: '#e0e0ec',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              const gcode = generateTestGrid(effectiveOpts);
              onGenerate(gcode, { width, height });
              onClose();
            }}
            disabled={!fits || parsedPowers.length === 0 || parsedSpeeds.length === 0}
            style={{
              padding: '6px 14px',
              background: fits ? 'rgb(0,212,255)' : '#333',
              border: 'none',
              borderRadius: 4,
              color: '#0a0a14',
              fontSize: 12,
              fontWeight: 600,
              cursor: fits ? 'pointer' : 'not-allowed',
              opacity: fits ? 1 : 0.5,
            }}
          >
            Generate G-code
          </button>
        </div>
      </div>
    </div>
  );
}
