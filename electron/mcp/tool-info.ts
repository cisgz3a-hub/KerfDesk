import { type ToolAnnotations } from '@modelcontextprotocol/server';
import { type KerfDeskMcpCommand } from './input-schemas.js';

export const mcpToolInfo: Record<KerfDeskMcpCommand, { title: string; description: string }> = {
  get_workspace: {
    title: 'Read the live workspace',
    description:
      'Read the current unsaved desktop workspace, revision, selection and bounded artwork/operation summaries.',
  },
  get_machine: {
    title: 'Read the selected machine',
    description:
      'Read the selected machine geometry and public capabilities. No connection addresses or credentials are returned.',
  },
  get_app_status: {
    title: 'Read desktop status',
    description:
      'Read app, edition and available-update summaries. Licence keys, purchase records and device identities are excluded.',
  },
  list_material_recipes: {
    title: 'List saved material recipes',
    description:
      'List bounded user-saved recipes. Settings are user records, not universal material recommendations or hardware qualification.',
  },
  review_job: {
    title: 'Review the current job',
    description:
      'Read current job-review warnings and Frame completion. This tool never frames, starts, streams or operates a machine.',
  },
  set_selection: {
    title: 'Select existing artwork',
    description:
      'Select existing artwork IDs, or clear with an empty array. Requires the current expectedRevision and a UUID requestId.',
  },
  add_text: {
    title: 'Add text artwork',
    description:
      'Add text with the bundled regular default font in a Laser workspace, in millimetres. widthMm is a maximum layout width: overflowing text shrinks uniformly and keeps its aspect ratio. Requires expectedRevision and UUID requestId; the desktop owns admission and Undo.',
  },
  add_rectangle: {
    title: 'Add rectangle artwork',
    description:
      'Add a rectangle in a Laser workspace, in millimetres. Requires expectedRevision and UUID requestId; the desktop owns admission and Undo.',
  },
  transform_artwork: {
    title: 'Transform existing artwork',
    description:
      'Move relatively, resize grouped bounds, or rotate around the grouped centre. Requires expectedRevision and UUID requestId; the desktop owns admission and Undo.',
  },
  update_operation: {
    title: 'Edit an existing laser operation',
    description:
      'Edit only powerPercent, speedMmPerMin, passes or enabled on an existing ordinary laser operation. Requires operationId, expectedRevision and UUID requestId; Pro-specific fields are refused.',
  },
};

export function mcpToolAnnotations(command: KerfDeskMcpCommand): ToolAnnotations {
  const readOnly = [
    'get_workspace',
    'get_machine',
    'get_app_status',
    'list_material_recipes',
    'review_job',
  ].includes(command);
  return {
    readOnlyHint: readOnly,
    destructiveHint: command === 'transform_artwork' || command === 'update_operation',
    idempotentHint: readOnly,
    openWorldHint: false,
  };
}
