import React from 'react';
import {
  BUILT_IN_HEADER_TEMPLATES,
  BUILT_IN_FOOTER_TEMPLATES,
  renderTemplate,
  emptyTemplateContext,
} from '../../core/plan/GcodeTemplates';

export interface GcodeTemplateEditorProps {
  open: boolean;
  onClose: () => void;
  initialHeader: string;
  initialFooter: string;
  onSave: (header: string, footer: string) => void;
}

export function GcodeTemplateEditor(props: GcodeTemplateEditorProps) {
  const { open, onClose, initialHeader, initialFooter, onSave } = props;
  const [header, setHeader] = React.useState(initialHeader);
  const [footer, setFooter] = React.useState(initialFooter);

  React.useEffect(() => {
    if (open) {
      setHeader(initialHeader);
      setFooter(initialFooter);
    }
  }, [open, initialHeader, initialFooter]);

  if (!open) return null;

  const previewCtx = {
    ...emptyTemplateContext(),
    jobName: 'MyProject.laserforge',
    bedWidthMm: 300,
    bedHeightMm: 300,
    maxSpeedMmPerMin: 6000,
    totalLines: 12345,
    estimatedTime: '4:32',
    materialName: 'Baltic birch 3mm',
    materialThicknessMm: 3.0,
  };

  const labelStyle: React.CSSProperties = { fontSize: 11, color: '#888', marginBottom: 4 };
  const textareaStyle: React.CSSProperties = {
    width: '100%', minHeight: 140,
    background: '#0a0a14', border: '1px solid #252540',
    borderRadius: 4, color: '#e0e0ec', fontSize: 12,
    fontFamily: 'Menlo, Consolas, monospace',
    padding: 8, outline: 'none', resize: 'vertical',
  };
  const previewStyle: React.CSSProperties = {
    ...textareaStyle, background: '#0f1a15', color: '#a0d0b0', border: '1px solid #1a3a2a',
    minHeight: 100, pointerEvents: 'none',
  };

  return React.createElement('div', {
    style: {
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.6)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    },
  },
  React.createElement('div', {
    style: {
      background: '#1a1a2e', border: '1px solid #252540',
      borderRadius: 8, padding: 24, width: 680, maxHeight: '90vh', overflowY: 'auto',
      color: '#e0e0ec', fontFamily: 'system-ui, sans-serif',
    },
  },
  React.createElement('h2', { style: { marginTop: 0, fontSize: 16 } }, 'G-code Header/Footer Templates'),
  React.createElement('p', { style: { fontSize: 12, color: '#888', lineHeight: 1.5, marginBottom: 16 } },
    'Customize the G-code emitted at the start and end of every job. ',
    'Use {JOB_NAME}, {DATE}, {BED_WIDTH}, {MAX_SPEED}, {MATERIAL_NAME}, {TOTAL_LINES}, ',
    '{ESTIMATED_TIME}, {MATERIAL_THICKNESS} as placeholders.'),

  React.createElement('div', { style: { marginBottom: 16 } },
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 } },
      React.createElement('div', { style: labelStyle }, 'Header'),
      React.createElement('select', {
        value: '',
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
          if (e.target.value && BUILT_IN_HEADER_TEMPLATES[e.target.value]) {
            setHeader(BUILT_IN_HEADER_TEMPLATES[e.target.value]);
          }
        },
        style: {
          background: '#0a0a14', border: '1px solid #252540', color: '#e0e0ec',
          fontSize: 11, padding: '2px 6px', borderRadius: 3,
        },
      },
      React.createElement('option', { value: '' }, 'Load preset...'),
      ...Object.keys(BUILT_IN_HEADER_TEMPLATES).map(name =>
        React.createElement('option', { key: name, value: name }, name),
      )),
    ),
    React.createElement('textarea', {
      value: header, style: textareaStyle,
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setHeader(e.target.value),
      spellCheck: false,
    }),
    React.createElement('div', { style: { ...labelStyle, marginTop: 6 } }, 'Preview with example values:'),
    React.createElement('pre', { style: previewStyle }, renderTemplate(header, previewCtx)),
  ),

  React.createElement('div', { style: { marginBottom: 16 } },
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 } },
      React.createElement('div', { style: labelStyle }, 'Footer'),
      React.createElement('select', {
        value: '',
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
          if (e.target.value && BUILT_IN_FOOTER_TEMPLATES[e.target.value]) {
            setFooter(BUILT_IN_FOOTER_TEMPLATES[e.target.value]);
          }
        },
        style: {
          background: '#0a0a14', border: '1px solid #252540', color: '#e0e0ec',
          fontSize: 11, padding: '2px 6px', borderRadius: 3,
        },
      },
      React.createElement('option', { value: '' }, 'Load preset...'),
      ...Object.keys(BUILT_IN_FOOTER_TEMPLATES).map(name =>
        React.createElement('option', { key: name, value: name }, name),
      )),
    ),
    React.createElement('textarea', {
      value: footer, style: textareaStyle,
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setFooter(e.target.value),
      spellCheck: false,
    }),
    React.createElement('div', { style: { ...labelStyle, marginTop: 6 } }, 'Preview with example values:'),
    React.createElement('pre', { style: previewStyle }, renderTemplate(footer, { ...previewCtx, totalLines: 12345 })),
  ),

  React.createElement('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end' } },
    React.createElement('button', {
      onClick: onClose,
      style: {
        padding: '6px 14px', background: '#252540', border: '1px solid #333355',
        borderRadius: 4, color: '#e0e0ec', fontSize: 12, cursor: 'pointer',
      },
    }, 'Cancel'),
    React.createElement('button', {
      onClick: () => {
        onSave(header, footer);
        onClose();
      },
      style: {
        padding: '6px 14px', background: 'rgb(0,212,255)', border: 'none',
        borderRadius: 4, color: '#0a0a14', fontSize: 12, fontWeight: 600, cursor: 'pointer',
      },
    }, 'Save'),
  ),
  ),
  );
}
