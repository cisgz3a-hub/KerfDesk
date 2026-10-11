import { z } from 'zod';
import { MAX_REGISTRATION_JIG_ANCESTORS } from '../../core/scene/registration-jig-identity';

// Object IDs in old projects were not length bounded. Keep those references
// readable; newly allocated IDs fit the existing 200-character side-ID schema.
const id = z.string().min(1);
const schema = z
  .object({
    objectId: id,
    boxId: id,
    ancestors: z
      .array(z.object({ sourceId: id, kind: z.enum(['copy', 'part']) }).strict())
      .max(MAX_REGISTRATION_JIG_ANCESTORS),
  })
  .strict();

export function validateRegistrationJigIdentity(value: unknown, path: string): string | null {
  if (value === undefined) return null;
  return schema.safeParse(value).success ? null : `missing or invalid \`${path}\``;
}
