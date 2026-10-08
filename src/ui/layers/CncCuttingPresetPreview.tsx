import type { CncLayerSettings } from '../../core/scene';
import type { CncCuttingContext, CncCuttingPreset } from '../../core/scene/cnc-cutting-preset';
import {
  previewCncCuttingPreset,
  type CncCuttingPresetPreview as Preview,
} from '../../core/cnc/cutting-preset';

export function CncCuttingPresetPreview(props: {
  readonly preset: CncCuttingPreset;
  readonly preview: Preview;
}): JSX.Element {
  const { preset, preview } = props;
  return (
    <>
      <p style={paragraphStyle}>
        {cuttingContextLabel(preset)} Values use mm/min, RPM and millimetres.
      </p>
      <p style={paragraphStyle}>
        Source: {preset.provenance?.kind ?? 'unknown'}
        {preset.provenance?.reference ? `, ${preset.provenance.reference}` : ''}.
      </p>
      <p style={paragraphStyle}>
        Qualification: {preset.qualification?.status ?? 'unverified'}
        {preset.qualification?.notes ? `, ${preset.qualification.notes}` : ''}.
      </p>
      {preview.contextFindings.map((finding) => (
        <p role="note" key={finding} style={paragraphStyle}>
          {finding}
        </p>
      ))}
      {preview.evidenceFindings.map((finding) => (
        <p role="note" key={finding} style={paragraphStyle}>
          {finding}
        </p>
      ))}
      <CuttingDifferences preview={preview} />
    </>
  );
}

export function CncSavedCuttingRecord(props: {
  readonly settings: CncLayerSettings;
  readonly context: CncCuttingContext | null;
}): JSX.Element | null {
  const saved = props.settings.cuttingPreset;
  if (saved === undefined) return null;
  const preview = previewCncCuttingPreset(saved, props.settings, props.context);
  return (
    <details style={recordStyle}>
      <summary title="Review the saved tool, material, machine and cutting values against this job’s overrides.">
        Saved cutting record: {saved.name} · {preview.differences.length} job overrides
      </summary>
      <p style={paragraphStyle}>
        This job retains a snapshot. Library changes and deletion do not change its values.
      </p>
      <CncCuttingPresetPreview preset={saved} preview={preview} />
    </details>
  );
}

function CuttingDifferences(props: { readonly preview: Preview }): JSX.Element {
  if (props.preview.differences.length === 0)
    return <p style={paragraphStyle}>Cutting values match the saved record.</p>;
  return (
    <table aria-label="Cutting value differences" style={tableStyle}>
      <thead>
        <tr>
          <th style={cellStyle}>Setting</th>
          <th style={cellStyle}>Job</th>
          <th style={cellStyle}>Saved</th>
        </tr>
      </thead>
      <tbody>
        {props.preview.differences.map((difference) => (
          <tr key={difference.key}>
            <td style={cellStyle}>{valueLabel(difference.key)}</td>
            <td style={cellStyle}>{difference.current}</td>
            <td style={cellStyle}>{difference.saved}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function valueLabel(key: Preview['differences'][number]['key']): string {
  return {
    feedMmPerMin: 'Feed (mm/min)',
    plungeMmPerMin: 'Plunge (mm/min)',
    spindleRpm: 'Spindle (RPM)',
    depthPerPassMm: 'Depth/pass (mm)',
    stepoverPercent: 'Stepover (%)',
  }[key];
}
function cuttingContextLabel(preset: CncCuttingPreset): string {
  const context = preset.context;
  return context === undefined
    ? 'Unbound cutting record (generic or legacy).'
    : `${context.tool.name} (${context.tool.diameterMm} mm), ${context.materialKey}, ${context.machine.name}.`;
}
const paragraphStyle: React.CSSProperties = { margin: '4px 0', overflowWrap: 'anywhere' };
const recordStyle: React.CSSProperties = { fontSize: 11, margin: '6px 0' };
const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  margin: '6px 0',
};
const cellStyle: React.CSSProperties = { textAlign: 'left', padding: '2px 4px' };
