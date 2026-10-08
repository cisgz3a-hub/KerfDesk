/** Normalize one download basename without retaining directory components. */
export function safeProgramFilename(value: string): string {
  const last = value.split(/[\\/]/).at(-1) ?? '';
  const basename = safeFilenameCharacters(last).trim().slice(0, 160) || 'job.gcode';
  return /\.(gcode|nc)$/i.test(basename) ? basename : basename + '.gcode';
}

/** The order is part of the name: a later return to the same cutter stays a separate file. */
export function cncToolProgramFilename(base: string, order: number, toolId: string | null): string {
  const stem = safeProgramFilename(base)
    .replace(/\.(gcode|nc)$/i, '')
    .slice(0, 100);
  const tool = (toolId ?? 'default').replace(/[^a-z0-9_-]/gi, '_').slice(0, 40) || 'default';
  return `${stem}-${String(order).padStart(3, '0')}-tool-${tool}.gcode`;
}

function safeFilenameCharacters(value: string): string {
  return value
    .split('')
    .map((character) => (character.charCodeAt(0) < 32 ? '_' : character))
    .join('')
    .replace(/[<>:"|?*]/g, '_');
}
