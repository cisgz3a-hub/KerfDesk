import { z } from 'zod';
import { validateProjectArchive } from './project-archive-shape';
const id = z.string().min(1).max(200);
const schema = z.object({
  activeId: id,
  activeName: id,
  inactive: z.array(z.object({ id, name: id, projectJson: z.string().min(1) })).max(99),
});

export function validateProjectSheets(
  value: unknown,
  validate: (raw: Record<string, unknown>) => string | null,
): string | null {
  if (value === undefined) return null;
  const parsed = schema.safeParse(value);
  if (!parsed.success) return 'Invalid named project sheets';
  const ids = [parsed.data.activeId, ...parsed.data.inactive.map((sheet) => sheet.id)];
  if (new Set(ids).size !== ids.length) return 'Duplicate project sheet identity';
  for (const sheet of parsed.data.inactive) {
    const error = validateProjectArchive(sheet.projectJson, ['sheetBook'], validate);
    if (error !== null) return `Invalid sheet ${sheet.name}: ${error}`;
  }
  return null;
}
