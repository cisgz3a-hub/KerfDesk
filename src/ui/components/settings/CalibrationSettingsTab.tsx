/**
 * @copyright (c) 2025 LaserForge. All rights reserved.
 */
import React from 'react';
import type { DeviceProfile } from '../../../core/devices/DeviceProfile';
import { ScanningOffsetDialog } from '../ScanningOffsetDialog';
import { interpolateOffset } from '../../../core/plan/ScanningOffset';

export interface CalibrationSettingsTabProps {
  activeProfile: DeviceProfile | null;
  onUpdateProfile: (updates: Partial<DeviceProfile>) => void;
}

export function CalibrationSettingsTab(props: CalibrationSettingsTabProps) {
  const { activeProfile, onUpdateProfile } = props;
  const [dialogOpen, setDialogOpen] = React.useState(false);

  if (!activeProfile) {
    return React.createElement('div', { style: { color: '#888', fontSize: 13 } },
      'No active device profile.');
  }

  const table = activeProfile.scanningOffsets ?? [];
  const hasCalibration = table.length > 0;

  const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, marginBottom: 8 };
  const hintStyle: React.CSSProperties = { fontSize: 11, color: '#888', marginBottom: 10, lineHeight: 1.5 };
  const tableStyle: React.CSSProperties = {
    width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 16,
  };
  const thStyle: React.CSSProperties = {
    textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid #252540',
    color: '#888', fontWeight: 500, fontSize: 11,
  };
  const tdStyle: React.CSSProperties = {
    padding: '6px 10px', borderBottom: '1px solid #1a1a2e',
  };
  const referenceSpeeds = [1500, 3000, 6000, 9000, 12000];

  return React.createElement('div', null,
    React.createElement('h3', { style: { marginTop: 0, fontSize: 15 } }, 'Scanning Offset Calibration'),
    React.createElement('p', { style: hintStyle },
      'Compensates for laser firing latency at fast raster speeds. ',
      'Without calibration, bidirectional scan lines appear offset from each other. ',
      'Calibrate by burning test patterns at known speeds, measuring the gap between opposing lines, ',
      'and entering half that distance with the sign that aligns the passes.',
    ),

    hasCalibration
      ? React.createElement('table', { style: tableStyle },
          React.createElement('thead', null,
            React.createElement('tr', null,
              React.createElement('th', { style: thStyle }, 'Speed (mm/min)'),
              React.createElement('th', { style: thStyle }, 'Offset (mm)'),
            ),
          ),
          React.createElement('tbody', null,
            ...table.map((point, idx) =>
              React.createElement('tr', { key: idx },
                React.createElement('td', { style: tdStyle }, point.speedMmPerMin.toFixed(0)),
                React.createElement('td', { style: tdStyle }, point.offsetMm.toFixed(3)),
              ),
            ),
          ),
        )
      : React.createElement('div', {
          style: {
            padding: 12, background: '#0f1a2a', border: '1px solid #1a3a4a',
            borderRadius: 4, fontSize: 12, color: '#a0c0e0', marginBottom: 16,
          },
        }, 'No calibration data. Raster offset correction is inactive.'),

    hasCalibration && React.createElement('div', null,
      React.createElement('div', { style: labelStyle }, 'Interpolated values'),
      React.createElement('table', { style: tableStyle },
        React.createElement('thead', null,
          React.createElement('tr', null,
            React.createElement('th', { style: thStyle }, 'Speed (mm/min)'),
            React.createElement('th', { style: thStyle }, 'Computed offset (mm)'),
          ),
        ),
        React.createElement('tbody', null,
          ...referenceSpeeds.map(speed =>
            React.createElement('tr', { key: speed },
              React.createElement('td', { style: tdStyle }, speed.toString()),
              React.createElement('td', { style: tdStyle }, interpolateOffset(table, speed).toFixed(4)),
            ),
          ),
        ),
      ),
    ),

    React.createElement('button', {
      onClick: () => setDialogOpen(true),
      style: {
        padding: '8px 16px', background: 'rgb(0,212,255)', border: 'none',
        borderRadius: 4, color: '#0a0a14', fontSize: 12, fontWeight: 600, cursor: 'pointer',
      },
    }, hasCalibration ? 'Edit calibration...' : 'Calibrate scanning offsets...'),

    React.createElement(ScanningOffsetDialog, {
      open: dialogOpen,
      onClose: () => setDialogOpen(false),
      currentTable: table,
      onSave: (newTable) => {
        onUpdateProfile({ scanningOffsets: newTable.length > 0 ? newTable : undefined });
      },
    }),
  );
}
