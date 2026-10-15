import { z } from 'zod';
import { type KerfDeskMcpCommand, MCP_MAX_ITEMS } from './input-schemas.js';
import { mcpMachineOutputSchemas } from './machine-schemas.js';
import { mcpDesignOutputSchemas } from './design-schemas.js';
import {
  MCP_TEXT_FIELDS,
  mcpAuthoringOutputSchemas,
  mcpHistorySchema,
  mcpPermissionsSchema,
  mcpTouchCapabilitiesSchema,
} from './authoring-schemas.js';

const id = z.string().min(1).max(128);
const label = z.string().max(512);
const revision = z.string().min(1).max(200);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const mode = z.enum(['laser', 'cnc']);
const coordinate = z.number().min(-100_000).max(100_000);
const dimension = z.number().nonnegative().max(100_000);
const bounds = z.object({
  xMm: coordinate,
  yMm: coordinate,
  widthMm: dimension,
  heightMm: dimension,
});
const operationValues = {
  powerPercent: z.number().min(0).max(100).optional(),
  speedMmPerMin: z.number().positive().max(100_000).optional(),
  passes: z.number().int().min(1).max(1000).optional(),
};

export const mcpWriteResultSchema = z.object({
  revision,
  changedArtworkIds: z.array(id).max(MCP_MAX_ITEMS).optional(),
  selection: z.array(id).max(MCP_MAX_ITEMS).optional(),
  operationId: id.optional(),
  changedFields: z
    .array(
      z.enum([
        'powerPercent',
        'speedMmPerMin',
        'passes',
        'enabled',
        'name',
        'mode',
        'minPowerPercent',
        'airAssist',
        'fillIntervalMm',
        'fillAngleDeg',
        'fillBidirectional',
        'fillCrossHatch',
        'linesPerMm',
        'negativeImage',
        'cnc',
        ...MCP_TEXT_FIELDS,
      ]),
    )
    .max(24)
    .optional(),
  history: mcpHistorySchema.optional(),
  message: z.string().max(2048).optional(),
});

/** Deliberately projected objects: Zod strips unknown fields at every nesting level. */
export const mcpOutputSchemas = {
  get_workspace: z.object({
    revision,
    mode,
    name: label,
    dirty: z.boolean(),
    selection: z.array(id).max(MCP_MAX_ITEMS),
    totalSelected: count.optional(),
    selectionTruncated: z.boolean().optional(),
    artwork: z
      .array(
        z.object({
          id,
          type: label,
          name: label.optional(),
          bounds: bounds.optional(),
          transformBounds: bounds.optional(),
          operationId: id.optional(),
          visible: z.boolean().optional(),
          editable: z.boolean().optional(),
        }),
      )
      .max(MCP_MAX_ITEMS),
    operations: z
      .array(
        z.object({
          id,
          type: label,
          name: label.optional(),
          enabled: z.boolean(),
          ...operationValues,
          color: z
            .string()
            .regex(/^#[0-9a-f]{6}$/)
            .optional(),
          minPowerPercent: z.number().min(0).max(100).optional(),
          airAssist: z.boolean().optional(),
          fillIntervalMm: z.number().positive().max(100).optional(),
          fillAngleDeg: z.number().min(-360).max(360).optional(),
          fillBidirectional: z.boolean().optional(),
          fillCrossHatch: z.boolean().optional(),
          linesPerMm: z.number().positive().max(1000).optional(),
          negativeImage: z.boolean().optional(),
          artworkCount: count.optional(),
          cnc: z
            .object({
              cutType: label,
              toolId: id.optional(),
              depthMm: z.number().nonnegative().max(1000).optional(),
              depthPerPassMm: z.number().nonnegative().max(1000).optional(),
              feedMmPerMin: z.number().nonnegative().max(100_000).optional(),
              plungeMmPerMin: z.number().nonnegative().max(100_000).optional(),
              spindleRpm: z.number().nonnegative().max(1_000_000).optional(),
              stepoverPercent: z.number().nonnegative().max(1000).optional(),
              pocketStrategy: label.optional(),
            })
            .optional(),
        }),
      )
      .max(MCP_MAX_ITEMS),
    totalArtwork: count,
    totalOperations: count,
    truncated: z.boolean(),
    history: mcpHistorySchema.optional(),
    permissions: mcpPermissionsSchema.optional(),
    capabilities: mcpTouchCapabilitiesSchema.optional(),
    saved: z.object({ hasFile: z.boolean() }).optional(),
  }),
  get_machine: z.object({
    revision,
    machine: z.object({
      id,
      name: label,
      controller: label.optional(),
      mode,
      bedWidthMm: dimension,
      bedHeightMm: dimension,
      units: z.string().max(16).optional(),
      maxFeedMmPerMin: z.number().positive().max(100_000).optional(),
      spindleMaxRpm: z.number().nonnegative().max(1_000_000).optional(),
      safeZMm: coordinate.optional(),
    }),
  }),
  get_app_status: z.object({
    revision,
    app: z.object({ name: label, version: z.string().max(128), platform: z.literal('desktop') }),
    edition: z.object({
      mode: z.enum(['free', 'pro', 'trial', 'preview']),
      trialEndsAt: z.union([z.string().max(128), z.number().nonnegative().finite()]).optional(),
      updateEligible: z.boolean().optional(),
    }),
    updates: z.object({
      available: z.boolean(),
      version: z.string().max(128).optional(),
      highlights: z.array(z.string().max(2048)).max(20).optional(),
    }),
  }),
  list_material_recipes: z.object({
    revision,
    recipes: z
      .array(
        z.object({
          id,
          name: label,
          machineName: label.optional(),
          materialName: label.optional(),
          ...operationValues,
          notes: z.string().max(2048).optional(),
        }),
      )
      .max(MCP_MAX_ITEMS),
    total: count,
    truncated: z.boolean(),
  }),
  review_job: z.object({
    revision,
    status: z.enum(['ready', 'unavailable', 'preparing']),
    mode,
    message: z.string().max(2048).optional(),
    summary: z
      .object({
        artworkCount: count,
        operationCount: count,
        estimatedSeconds: z.number().nonnegative().finite().optional(),
        bounds: bounds.optional(),
      })
      .optional(),
    warnings: z
      .array(
        z.object({
          code: z.string().min(1).max(128),
          message: z.string().max(2048),
          severity: z.enum(['info', 'warning', 'error']).optional(),
          operationId: id.optional(),
        }),
      )
      .max(MCP_MAX_ITEMS),
    frame: z.object({ required: z.literal(true), complete: z.boolean() }),
  }),
  set_selection: mcpWriteResultSchema,
  add_text: mcpWriteResultSchema,
  add_rectangle: mcpWriteResultSchema,
  add_ellipse: mcpWriteResultSchema,
  add_polyline: mcpWriteResultSchema,
  transform_artwork: mcpWriteResultSchema,
  update_operation: mcpWriteResultSchema,
  update_text: mcpWriteResultSchema,
  arrange_artwork: mcpWriteResultSchema,
  undo: mcpWriteResultSchema,
  redo: mcpWriteResultSchema,
  ...mcpAuthoringOutputSchemas,
  ...mcpDesignOutputSchemas,
  ...mcpMachineOutputSchemas,
} as const;

export type KerfDeskMcpResult<C extends KerfDeskMcpCommand> = z.output<
  (typeof mcpOutputSchemas)[C]
>;
