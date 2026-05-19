import React from 'react';
import type { ScanningOffsetTable, ScanningOffsetPoint } from '../../core/plan/ScanningOffset';
import { suggestedDefaultTable } from '../../core/plan/ScanningOffset';

export interface ScanningOffsetDialogProps {
  open: boolean;
  onClose: () => void;
  currentTable: ScanningOffsetTable;
  onSave: (table: ScanningOffsetTable) => void;
}

export function ScanningOffsetDialog(props: ScanningOffsetDialogProps) {
  const { open, onClose, currentTable, onSave } = props;
  const [rows, setRows] = React.useState<ScanningOffsetPoint[]>(currentTable);

  React.useEffect(() => {
    if (open) setRows(currentTable.length > 0 ? currentTable : suggestedDefaultTable());
  }, [open, currentTable]);

  if (!open) return null;

  const updateRow = (idx: number, field: 'speedMmPerMin' | 'offsetMm', value: string) => {
    const v = parseFloat(value);
    if (!Number.isFinite(v)) return;
    setRows(r => r.map((row, i) => (i === idx ? { ...row, [field]: v } : row)));
  };

  const addRow = () => setRows(r => [...r, { speedMmPerMin: 0, offsetMm: 0 }]);
  const removeRow = (idx: number) => setRows(r => r.filter((_, i) => i !== idx));

  const labelStyle: React.CSSProperties = { fontSize: 11, color: '#888', marginBottom: 2, marginTop: 8 };
  const inputStyle: React.CSSProperties = {
    width: 100,
    padding: '4px 8px',
    background: '#0a0a14',
    border: '1px solid #252540',
    borderRadius: 4,
    color: '#e0e0ec',
    fontSize: 12,
    outline: 'none',
  };

  return React.createElement(
    'div',
    {
      style: {
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
      },
    },
    React.createElement(
      'div',
      {
        style: {
          background: '#1a1a2e',
          border: '1px solid #252540',
          borderRadius: 8,
          padding: 24,
          width: 520,
          maxHeight: '90vh',
          overflowY: 'auto',
          color: '#e0e0ec',
          fontFamily: 'system-ui, sans-serif',
        },
      },
      React.createElement('h2', { style: { marginTop: 0, fontSize: 16 } }, 'Scanning Offset Calibration'),
      React.createElement(
        'p',
        { style: { fontSize: 12, color: '#888', lineHeight: 1.5 } },
        'At fast raster speeds, laser firing latency shifts the burn in the direction of travel. ',
        'Burn the bidirectional calibration pattern, measure the distance between opposing lines, ',
        'then enter half that measured distance as the correction for each speed. ',
        'Use positive or negative values to align left-to-right and right-to-left passes.',
      ),

      React.createElement(
        'div',
        {
          style: {
            display: 'grid',
            gridTemplateColumns: '1fr 1fr auto',
            gap: 8,
            alignItems: 'center',
            marginTop: 12,
          },
        },
        React.createElement('div', { style: labelStyle }, 'Speed (mm/min)'),
        React.createElement('div', { style: labelStyle }, 'Offset (mm)'),
        React.createElement('div'),
        ...rows.flatMap((row, idx) => [
          React.createElement('input', {
            key: `s-${idx}`,
            type: 'number',
            value: row.speedMmPerMin,
            style: inputStyle,
            min: 0,
            step: 100,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => updateRow(idx, 'speedMmPerMin', e.target.value),
          }),
          React.createElement('input', {
            key: `o-${idx}`,
            type: 'number',
            value: row.offsetMm,
            style: inputStyle,
            step: 0.005,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => updateRow(idx, 'offsetMm', e.target.value),
          }),
          React.createElement(
            'button',
            {
              key: `r-${idx}`,
              onClick: () => removeRow(idx),
              style: {
                padding: '4px 10px',
                background: 'transparent',
                border: '1px solid #333355',
                borderRadius: 4,
                color: '#ff4466',
                fontSize: 12,
                cursor: 'pointer',
              },
            },
            '×',
          ),
        ]),
      ),

      React.createElement(
        'button',
        {
          onClick: addRow,
          style: {
            marginTop: 8,
            padding: '6px 12px',
            background: '#252540',
            border: '1px solid #333355',
            borderRadius: 4,
            color: '#e0e0ec',
            fontSize: 12,
            cursor: 'pointer',
          },
        },
        '+ Add calibration point',
      ),

      React.createElement(
        'div',
        { style: { marginTop: 20, display: 'flex', gap: 8, justifyContent: 'flex-end' } },
        React.createElement(
          'button',
          {
            onClick: () => setRows([]),
            style: {
              padding: '6px 14px',
              background: 'transparent',
              border: '1px solid #333355',
              borderRadius: 4,
              color: '#888',
              fontSize: 12,
              cursor: 'pointer',
            },
          },
          'Clear',
        ),
        React.createElement(
          'button',
          {
            onClick: onClose,
            style: {
              padding: '6px 14px',
              background: '#252540',
              border: '1px solid #333355',
              borderRadius: 4,
              color: '#e0e0ec',
              fontSize: 12,
              cursor: 'pointer',
            },
          },
          'Cancel',
        ),
        React.createElement(
          'button',
          {
            onClick: () => {
              const cleaned = rows
                .filter(r =>
                  Number.isFinite(r.speedMmPerMin)
                  && r.speedMmPerMin > 0
                  && Number.isFinite(r.offsetMm)
                  && Math.abs(r.offsetMm) <= 25,
                )
                .sort((a, b) => a.speedMmPerMin - b.speedMmPerMin);
              onSave(cleaned);
              onClose();
            },
            style: {
              padding: '6px 14px',
              background: 'rgb(0,212,255)',
              border: 'none',
              borderRadius: 4,
              color: '#0a0a14',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            },
          },
          'Save',
        ),
      ),
    ),
  );
}
