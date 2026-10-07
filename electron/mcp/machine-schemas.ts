import { z } from 'zod';

const revision = z.string().min(1).max(200);
const message = z.string().max(2048);
const admission = { expectedRevision: revision, requestId: z.uuid() };
const frame = z.object({ required: z.literal(true), complete: z.boolean() });
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const review = z.object({
  reviewId: z.uuid(),
  revision,
  mode: z.enum(['laser', 'cnc']),
  artworkShared: z.boolean().optional(),
  stats: z
    .array(
      z.object({
        label: message,
        value: message,
        detail: message,
        emphasis: z.literal('text').optional(),
      }),
    )
    .max(16),
  warnings: z.array(z.object({ code: z.string().min(1).max(128), message })).max(200),
  operations: z
    .array(
      z.object({
        operationId: z.string().min(1).max(128),
        summaries: z.array(message).max(20),
        index: count.optional(),
        summaryOffset: count.optional(),
        summaryTotal: count.optional(),
      }),
    )
    .max(200),
  pagination: z
    .object({
      offset: count,
      nextOffset: count.nullable(),
      totalFacts: count,
      totalWarnings: count,
      totalOperations: count,
      totalStats: count,
      totalSummaries: count,
    })
    .optional(),
  acknowledgement: z.object({
    kind: z.enum(['laser-verified', 'laser-unverified', 'cnc']),
    prompt: message.optional(),
  }),
  frame,
});

/** Bounded machine commands; no arbitrary console, G-code, homing or file exchange. */
export const mcpMachineInputSchemas = {
  get_machine_status: z.strictObject({}),
  get_control_operation: z.strictObject({
    operationId: z.uuid(),
    reviewPage: z.strictObject({ reviewId: z.uuid(), offset: count }).optional(),
  }),
  jog_machine: z.strictObject({
    ...admission,
    axis: z.enum(['x', 'y', 'z']),
    direction: z.union([z.literal(-1), z.literal(1)]),
    distanceMm: z.number().min(0.01).max(100),
    feedMmPerMin: z.number().min(1).max(100_000).optional(),
  }),
  frame_job: z.strictObject(admission),
  review_machine_job: z.strictObject(admission),
  start_job: z.strictObject({ ...admission, reviewId: z.uuid() }),
  abort_job: z.strictObject({ requestId: z.uuid() }),
} as const;

export const mcpControlOperationSchema = z.object({
  operationId: z.uuid(),
  kind: z.enum(['jog', 'frame', 'job', 'abort']),
  state: z.enum([
    'accepted',
    'preparing',
    'awaiting_review',
    'starting',
    'running',
    'completed',
    'cancelled',
    'failed',
    'unknown',
  ]),
  revision,
  committed: z.boolean().nullable(),
  message: message.optional(),
  review: review.optional(),
});
const operationResult = z.object({ revision, operation: mcpControlOperationSchema });
const coordinate = z.number().min(-100_000).max(100_000);
const availability = z.object({ available: z.boolean(), reason: message.optional() });

/** Projected factual status; native addresses, controller settings and G-code stay private. */
export const mcpMachineOutputSchemas = {
  get_machine_status: z.object({
    revision,
    permissions: z.object({ canControl: z.boolean() }),
    mode: z.enum(['laser', 'cnc']),
    connection: z.enum(['connected', 'disconnected', 'connecting']),
    controllerState: z.string().max(128).nullable(),
    position: z
      .object({
        space: z.literal('work'),
        wcs: z.enum(['G54', 'G55', 'G56', 'G57', 'G58', 'G59']).optional(),
        xMm: coordinate,
        yMm: coordinate,
        zMm: coordinate.optional(),
      })
      .optional(),
    availability: z.object({
      jog: availability,
      frame: availability,
      review: availability,
      start: availability,
      abort: availability,
    }),
    jog: z.object({
      xySupported: z.boolean(),
      zSupported: z.boolean(),
      maxFeedMmPerMin: z.number().positive().max(100_000),
    }),
    frame,
    job: z.object({
      active: z.boolean(),
      state: z.enum(['idle', 'starting', 'running', 'paused', 'tool_change', 'unknown']),
      progressPercent: z.number().min(0).max(100).optional(),
    }),
    motion: z.object({ kind: z.enum(['idle', 'jog', 'frame', 'unknown']) }),
    operation: mcpControlOperationSchema.optional(),
  }),
  get_control_operation: operationResult,
  jog_machine: operationResult,
  frame_job: operationResult,
  review_machine_job: operationResult,
  start_job: operationResult,
  abort_job: operationResult,
} as const;
