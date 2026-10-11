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

const axis = z.enum(['x', 'y', 'z']);
const direction = z.union([z.literal(-1), z.literal(1)]);

/** Bounded machine commands; no arbitrary console, G-code, laser firing or file exchange. */
export const mcpMachineInputSchemas = {
  get_machine_status: z.strictObject({}),
  get_control_operation: z.strictObject({
    operationId: z.uuid(),
    reviewPage: z.strictObject({ reviewId: z.uuid(), offset: count }).optional(),
  }),
  jog_machine: z.strictObject({
    ...admission,
    axis,
    direction,
    distanceMm: z.number().min(0.01).max(100),
    feedMmPerMin: z.number().min(1).max(100_000).optional(),
  }),
  frame_job: z.strictObject(admission),
  review_machine_job: z.strictObject(admission),
  start_job: z.strictObject({ ...admission, reviewId: z.uuid() }),
  abort_job: z.strictObject({ requestId: z.uuid() }),
  connect_machine: z.strictObject(admission),
  disconnect_machine: z.strictObject(admission),
  home_machine: z.strictObject(admission),
  set_work_origin: z.strictObject({ ...admission, axes: z.enum(['xy', 'z']) }),
  pause_job: z.strictObject({ requestId: z.uuid() }),
  resume_job: z.strictObject({ requestId: z.uuid() }),
  jog_hold_start: z.strictObject({
    ...admission,
    axis,
    direction,
    feedMmPerMin: z.number().min(1).max(100_000).optional(),
  }),
  jog_hold_stop: z.strictObject({ requestId: z.uuid(), operationId: z.uuid() }),
  get_camera_snapshot: z.strictObject({}),
} as const;

export const MCP_CONTROL_OPERATION_KINDS = [
  'jog',
  'frame',
  'job',
  'abort',
  'connect',
  'disconnect',
  'home',
  'origin',
  'pause',
  'resume',
  'hold',
] as const;

export const mcpControlOperationSchema = z.object({
  operationId: z.uuid(),
  kind: z.enum(MCP_CONTROL_OPERATION_KINDS),
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
      connect: availability.optional(),
      disconnect: availability.optional(),
      home: availability.optional(),
      origin: availability.optional(),
      pause: availability.optional(),
      resume: availability.optional(),
      hold: availability.optional(),
    }),
    jog: z.object({
      xySupported: z.boolean(),
      zSupported: z.boolean(),
      maxFeedMmPerMin: z.number().positive().max(100_000),
      holdSupported: z.boolean().optional(),
    }),
    frame,
    job: z.object({
      active: z.boolean(),
      state: z.enum(['idle', 'starting', 'running', 'paused', 'tool_change', 'unknown']),
      progressPercent: z.number().min(0).max(100).optional(),
      elapsedSeconds: z.number().nonnegative().max(31_536_000).optional(),
      remainingSeconds: z.number().nonnegative().max(31_536_000).optional(),
    }),
    homing: z.enum(['confirmed', 'required', 'not_supported', 'unknown']).optional(),
    camera: z.object({ available: z.boolean() }).optional(),
    machineSeq: count.optional(),
    motion: z.object({ kind: z.enum(['idle', 'jog', 'frame', 'unknown']) }),
    operation: mcpControlOperationSchema.optional(),
  }),
  get_control_operation: operationResult,
  jog_machine: operationResult,
  frame_job: operationResult,
  review_machine_job: operationResult,
  start_job: operationResult,
  abort_job: operationResult,
  connect_machine: operationResult,
  disconnect_machine: operationResult,
  home_machine: operationResult,
  set_work_origin: operationResult,
  pause_job: operationResult,
  resume_job: operationResult,
  jog_hold_start: operationResult,
  jog_hold_stop: operationResult,
  get_camera_snapshot: z
    .object({
      revision,
      status: z.enum(['ready', 'disabled', 'unavailable']),
      message: message.optional(),
      image: z
        .object({
          mimeType: z.literal('image/jpeg'),
          data: z
            .string()
            .min(4)
            .max(240_000)
            .regex(/^\/9j\/[A-Za-z0-9+/]*={0,2}$/)
            .refine((value) => value.length % 4 === 0),
          widthPx: z.number().int().positive().max(1280),
          heightPx: z.number().int().positive().max(1280),
        })
        .optional(),
    })
    .refine((value) => (value.status === 'ready') === (value.image !== undefined)),
} as const;
