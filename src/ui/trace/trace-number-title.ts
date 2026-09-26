// Hover titles for the Refine detail number rows, keyed by row label.
export function traceNumberTitle(label: string): string {
  switch (label) {
    case 'Cutoff':
      return 'Exclude artwork darker than this brightness.';
    case 'Threshold':
      return 'Raise this to include lighter marks; lower it to keep darker ink.';
    case 'Ignore Less Than':
      return 'Remove shapes and holes below this pixel area. Use 0 to keep the smallest gaps.';
    case 'Remove ink specks':
      return 'Remove ink marks below this pixel area; holes stay intact. A value you type, 0 included, is used exactly (0 removes none). Line Art and Smooth show 0 until you type one and judge small marks automatically meanwhile: stipple and small text stay; faint specks, lone specks and dust go, though a dark speck inside a texture may stay.';
    case 'Smoothness':
      return 'Smooth traced edges to reduce jagged vector paths.';
    case 'Optimize':
      return 'Simplify traced paths while preserving shape.';
    case 'Sensitivity':
      return 'Higher values keep fainter detail. Each step of 10 needs one brightness level less contrast.';
    case 'Detail':
      return 'Higher values compare each pixel with a smaller neighbourhood: finer detail, hollower broad shapes.';
    case 'Minimum line':
      return 'Discard closed edge outlines whose perimeter is shorter than this many source-image pixels.';
    default:
      return `Trace ${label.toLowerCase()} setting.`;
  }
}
