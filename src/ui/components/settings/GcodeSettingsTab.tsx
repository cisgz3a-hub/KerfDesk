/**
 * @copyright (c) 2025 LaserForge. All rights reserved.
 */
import React from 'react';
import type { DeviceProfile } from '../../../core/devices/DeviceProfile';
import { GcodeTemplateEditor } from '../GcodeTemplateEditor';
import {
  BUILT_IN_HEADER_TEMPLATES,
  BUILT_IN_FOOTER_TEMPLATES,
  renderTemplate,
  emptyTemplateContext,
} from '../../../core/plan/GcodeTemplates';

export interface GcodeSettingsTabProps {
  activeProfile: DeviceProfile | null;
  onUpdateProfile: (updates: Partial<DeviceProfile>) => void;
}

export function GcodeSettingsTab(props: GcodeSettingsTabProps) {
  const { activeProfile, onUpdateProfile } = props;
  const [editorOpen, setEditorOpen] = React.useState(false);

  if (!activeProfile) {
    return React.createElement('div', { style: { color: '#888', fontSize: 13 } },
      'No active device profile. Select or create a profile in the Profiles tab first.');
  }

  const header = activeProfile.gcodeHeaderTemplate ?? BUILT_IN_HEADER_TEMPLATES['GRBL (generic)'];
  const footer = activeProfile.gcodeFooterTemplate ?? BUILT_IN_FOOTER_TEMPLATES['Park at origin'];

  const previewCtx = {
    ...emptyTemplateContext(),
    jobName: 'MyProject.laserforge',
    bedWidthMm: activeProfile.bedWidth ?? 300,
    bedHeightMm: activeProfile.bedHeight ?? 300,
    maxSpeedMmPerMin: 6000,
    totalLines: 12345,
    estimatedTime: '4:32',
    materialName: 'Baltic birch 3mm',
    materialThicknessMm: 3.0,
  };

  const sectionStyle: React.CSSProperties = { marginBottom: 24 };
  const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, marginBottom: 8 };
  const hintStyle: React.CSSProperties = { fontSize: 11, color: '#888', marginBottom: 10, lineHeight: 1.5 };
  const previewStyle: React.CSSProperties = {
    background: '#0a0a14',
    border: '1px solid #252540',
    borderRadius: 4,
    padding: 10,
    fontSize: 11,
    fontFamily: 'Menlo, Consolas, monospace',
    color: '#a0d0b0',
    whiteSpace: 'pre-wrap',
    maxHeight: 140,
    overflowY: 'auto',
  };
  const textAreaStyle: React.CSSProperties = {
    ...previewStyle,
    color: '#e0e0ec',
    width: '100%',
    minHeight: 96,
    resize: 'vertical',
    outline: 'none',
  };

  return React.createElement('div', null,
    React.createElement('h3', { style: { marginTop: 0, fontSize: 15 } }, 'G-code Templates'),
    React.createElement('p', { style: hintStyle },
      'G-code header/footer emitted at the start and end of every job. ',
      'Use variables like {JOB_NAME}, {BED_WIDTH}, {MAX_SPEED} — they are substituted at compile time.',
    ),

    React.createElement('div', { style: sectionStyle },
      React.createElement('div', { style: labelStyle }, 'Header preview'),
      React.createElement('pre', { style: previewStyle }, renderTemplate(header, previewCtx)),
    ),

    React.createElement('div', { style: sectionStyle },
      React.createElement('div', { style: labelStyle }, 'Footer preview'),
      React.createElement('pre', { style: previewStyle }, renderTemplate(footer, { ...previewCtx, totalLines: 12345 })),
    ),

    React.createElement('button', {
      onClick: () => setEditorOpen(true),
      style: {
        padding: '8px 16px', background: 'rgb(0,212,255)', border: 'none',
        borderRadius: 4, color: '#0a0a14', fontSize: 12, fontWeight: 600, cursor: 'pointer',
      },
    }, 'Edit templates...'),

    React.createElement('div', { style: { ...sectionStyle, marginTop: 24 } },
      React.createElement('div', { style: labelStyle }, 'Custom start G-code'),
      React.createElement('textarea', {
        value: activeProfile.startGcode ?? '',
        spellCheck: false,
        style: textAreaStyle,
        onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => onUpdateProfile({ startGcode: e.target.value }),
      }),
    ),

    React.createElement('div', { style: sectionStyle },
      React.createElement('div', { style: labelStyle }, 'Custom end G-code'),
      React.createElement('textarea', {
        value: activeProfile.endGcode ?? '',
        spellCheck: false,
        style: textAreaStyle,
        onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => onUpdateProfile({ endGcode: e.target.value }),
      }),
    ),

    React.createElement(GcodeTemplateEditor, {
      open: editorOpen,
      onClose: () => setEditorOpen(false),
      initialHeader: header,
      initialFooter: footer,
      onSave: (newHeader, newFooter) => {
        onUpdateProfile({
          gcodeHeaderTemplate: newHeader,
          gcodeFooterTemplate: newFooter,
        });
      },
    }),
  );
}
