// What the Open and Save dialogs call a file type ("Save as type: …").
//
// Every picker used to say "Files", so a beginner saving a project could not
// tell from the dialog that it was a KerfDesk project to keep (UX audit
// U1-P3-6). The name comes from the extensions the caller already passes, so
// no caller changes.

const TYPE_NAMES: ReadonlyArray<readonly [ReadonlyArray<string>, string]> = [
  [['.lf2'], 'KerfDesk project'],
  [['.lf2template'], 'KerfDesk project template'],
  [['.lbrn', '.lbrn2'], 'LightBurn project'],
  [['.svg'], 'SVG drawing'],
  [['.dxf'], 'DXF drawing'],
  [['.pdf'], 'PDF document'],
  [['.gcode', '.nc', '.gc', '.ngc', '.tap', '.cnc'], 'G-code'],
  [['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp', '.tif', '.tiff'], 'Image'],
  [['.lfmachine.json'], 'KerfDesk machine profile'],
  [['.lbdev', '.lbzip'], 'LightBurn device'],
  [['.lfml.json'], 'KerfDesk material library'],
  [['.clb'], 'LightBurn material library'],
  [['.lfart'], 'KerfDesk artwork'],
  [['.lfrelief'], 'KerfDesk relief component'],
  [['.rd'], 'Ruida file'],
  [['.stl'], 'STL model'],
  [['.csv'], 'CSV table'],
  [['.txt'], 'Text file'],
  [['.html'], 'Web page'],
  [['.json'], 'JSON file'],
];

function typeName(extension: string): string {
  const lower = extension.toLowerCase();
  for (const [extensions, name] of TYPE_NAMES) {
    if (extensions.includes(lower)) return name;
  }
  return `${lower.replace(/^\./, '').toUpperCase()} file`;
}

/** The dialog's type name for a list of extensions: one or two kinds by name,
 * a longer mix as "Supported files". */
export function pickerTypeDescription(extensions: ReadonlyArray<string>): string {
  const names = [...new Set(extensions.map(typeName))];
  if (names.length === 0 || names.length > 2) return 'Supported files';
  return names.join(' or ');
}
