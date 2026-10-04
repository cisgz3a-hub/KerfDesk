// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  MCP_CONTROL_COMMANDS,
  MCP_WRITE_COMMANDS,
  mcpCommandScope,
  mcpInputSchemas,
} from './input-schemas.js';
import { mcpOutputSchemas } from './output-schemas.js';
import { mcpToolAnnotations } from './tool-info.js';

const admission = {
  expectedRevision: 'current-1',
  requestId: '12345678-1234-4234-8234-123456789abc',
};
const jog = { ...admission, axis: 'x', direction: 1, distanceMm: 1 };
const operation = {
  operationId: admission.requestId,
  kind: 'frame',
  state: 'accepted',
  revision: admission.expectedRevision,
  committed: false,
};

describe('bounded consequential machine tool contract', () => {
  it('keeps control separate from document-edit admission and annotates physical effects', () => {
    for (const command of MCP_CONTROL_COMMANDS) {
      expect(MCP_WRITE_COMMANDS.has(command)).toBe(false);
      expect(mcpCommandScope(command)).toBe('control');
      expect(mcpToolAnnotations(command)).toEqual({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      });
    }
    expect(mcpCommandScope('update_operation')).toBe('edit');
    expect(mcpCommandScope('get_machine_status')).toBe('read');
    expect(mcpCommandScope('get_control_operation')).toBe('read');
  });

  it('refuses arbitrary code, absolute coordinates, malformed IDs and unbounded jog values', () => {
    expect(mcpInputSchemas.jog_machine.safeParse(jog).success).toBe(true);
    for (const extra of [
      { distanceMm: 0 },
      { distanceMm: 101 },
      { direction: 0 },
      { axis: 'a' },
      { feedMmPerMin: 0 },
      { feedMmPerMin: Infinity },
      { gcode: 'M3 S1000' },
      { absoluteX: 100 },
      { requestId: 'not-a-uuid' },
      { expectedRevision: '' },
    ])
      expect(mcpInputSchemas.jog_machine.safeParse({ ...jog, ...extra }).success).toBe(false);
    expect(mcpInputSchemas.start_job.safeParse(admission).success).toBe(false);
    expect(
      mcpInputSchemas.start_job.safeParse({ ...admission, reviewId: admission.requestId }).success,
    ).toBe(true);
    expect(mcpInputSchemas.abort_job.safeParse({ requestId: admission.requestId }).success).toBe(
      true,
    );
    expect(mcpInputSchemas.abort_job.safeParse(admission).success).toBe(false);
  });

  it('projects action receipts without leaking native identities, code or private nested fields', () => {
    const projected = mcpOutputSchemas.frame_job.parse({
      revision: admission.expectedRevision,
      nativePath: 'C:/private/job',
      operation: { ...operation, ownerSecret: 'private', gcode: ['M3'] },
    });
    expect(projected).toEqual({ revision: admission.expectedRevision, operation });
    expect(
      mcpOutputSchemas.frame_job.safeParse({
        revision: 'r',
        operation: { ...operation, state: 'done' },
      }).success,
    ).toBe(false);
    expect(
      mcpOutputSchemas.frame_job.safeParse({
        revision: 'r',
        operation: { ...operation, operationId: 'bad' },
      }).success,
    ).toBe(false);
  });

  it('bounds review disclosure and requires the canonical acknowledgement kind', () => {
    const review = {
      reviewId: admission.requestId,
      revision: admission.expectedRevision,
      mode: 'laser',
      stats: [],
      warnings: [],
      operations: [],
      acknowledgement: { kind: 'laser-verified' },
      frame: { required: true, complete: true },
    };
    const output = {
      revision: admission.expectedRevision,
      operation: { ...operation, kind: 'job', state: 'awaiting_review', review },
    };
    expect(mcpOutputSchemas.review_machine_job.safeParse(output).success).toBe(true);
    const oversized = {
      ...review,
      stats: Array.from({ length: 17 }, () => ({ label: 'x', value: 'x', detail: 'x' })),
    };
    expect(
      mcpOutputSchemas.review_machine_job.safeParse({
        ...output,
        operation: { ...output.operation, review: oversized },
      }).success,
    ).toBe(false);
    expect(
      mcpOutputSchemas.review_machine_job.safeParse({
        ...output,
        operation: {
          ...output.operation,
          review: { ...review, acknowledgement: { kind: 'automatic' } },
        },
      }).success,
    ).toBe(false);
  });
});
