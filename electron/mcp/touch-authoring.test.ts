// @vitest-environment node
import { expect, it } from 'vitest';
import { validateCommand } from '../../src/ui/remote-control/validation';
import {
  mcpInputSchemas,
  MCP_WRITE_COMMANDS,
  MCP_CONTROL_COMMANDS,
  mcpCommandScope,
} from './input-schemas.js';
import { mcpOutputSchemas } from './output-schemas.js';
import { mcpToolAnnotations } from './tool-info.js';

const admission = { expectedRevision: 'live-1', requestId: '12345678-1234-4234-8234-123456789abc' };
const ellipse = { ...admission, xMm: -10, yMm: 20, widthMm: 30, heightMm: 40 };
const polyline = {
  ...admission,
  pointsMm: [
    { xMm: -10, yMm: 20 },
    { xMm: 30, yMm: 40 },
  ],
  closed: false,
};

it.each(['add_ellipse', 'add_polyline'] as const)(
  'requires only explicit edit scope for %s',
  (command) => {
    expect(MCP_WRITE_COMMANDS.has(command)).toBe(true);
    expect(MCP_CONTROL_COMMANDS.has(command)).toBe(false);
    expect(mcpCommandScope(command)).toBe('edit');
    expect(mcpToolAnnotations(command)).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  },
);

it('preserves the same bounded detached renderer and portable input contract', () => {
  const large = {
    ...polyline,
    pointsMm: Array.from({ length: 512 }, (_, index) => ({ xMm: index / 2, yMm: index % 2 })),
  };
  for (const [command, args] of [
    ['add_ellipse', ellipse],
    ['add_polyline', large],
  ] as const) {
    expect(mcpInputSchemas[command].parse(args)).toEqual(args);
    expect(validateCommand(command, args)).toEqual({ command, args });
  }
});

const invalid: Array<['add_ellipse' | 'add_polyline', unknown]> = [
  ['add_ellipse', { ...ellipse, widthMm: 0 }],
  ['add_ellipse', { ...ellipse, heightMm: -1 }],
  ['add_ellipse', { ...ellipse, xMm: Infinity }],
  ['add_ellipse', { ...ellipse, yMm: NaN }],
  ['add_ellipse', { ...ellipse, widthMm: 100001 }],
  ['add_ellipse', { ...ellipse, xMm: -100001 }],
  ['add_ellipse', { ...ellipse, toolPath: 'private' }],
  ['add_polyline', { ...polyline, closed: 'true' }],
  ['add_polyline', { ...polyline, pointsMm: null }],
  ['add_polyline', { ...polyline, pointsMm: [] }],
  ['add_polyline', { ...polyline, pointsMm: [{ xMm: 1, yMm: 2 }] }],
  [
    'add_polyline',
    { ...polyline, pointsMm: Array.from({ length: 513 }, (_, xMm) => ({ xMm, yMm: 0 })) },
  ],
  [
    'add_polyline',
    {
      ...polyline,
      pointsMm: [
        { xMm: 1, yMm: 2 },
        { xMm: 1, yMm: 2 },
      ],
    },
  ],
  ['add_polyline', { ...polyline, closed: true }],
  [
    'add_polyline',
    { ...polyline, closed: true, pointsMm: [...polyline.pointsMm, polyline.pointsMm[0]] },
  ],
  ...[
    { xMm: 100001, yMm: 0 },
    { xMm: 0, yMm: NaN },
    { xMm: 1, yMm: 2, laserPower: 100 },
    { xMm: 1 },
  ].map(
    (point) =>
      ['add_polyline', { ...polyline, pointsMm: [polyline.pointsMm[0], point] }] as [
        'add_polyline',
        unknown,
      ],
  ),
  ['add_polyline', { ...polyline, expectedRevision: '' }],
  ['add_polyline', { ...polyline, requestId: 'not-a-uuid' }],
];
it.each(invalid)(
  'rejects the same malformed %s input at portable and renderer boundaries %#',
  (command, args) => {
    expect(mcpInputSchemas[command].safeParse(args).success).toBe(false);
    expect(() => validateCommand(command, args)).toThrow();
  },
);

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6foAAAAASUVORK5CYII=';
const preview = {
  revision: 'live-1',
  status: 'ready',
  preview: { mimeType: 'image/png', data: png, widthPx: 1, heightPx: 1 },
};
it('keeps legacy preview output valid and copies only optional bounded whole-image viewport fields', () => {
  const schema = mcpOutputSchemas.get_workspace_preview;
  expect(schema.parse(preview)).toEqual(preview);
  const viewport = { xMm: -16, yMm: -32, widthMm: 232, heightMm: 232 };
  expect(schema.parse({ ...preview, viewport: { ...viewport, path: 'private' } })).toEqual({
    ...preview,
    viewport,
  });
  expect(schema.safeParse({ ...preview, viewport: { ...viewport, widthMm: 0 } }).success).toBe(
    false,
  );
  expect(schema.safeParse({ ...preview, viewport: { ...viewport, xMm: NaN } }).success).toBe(false);
  expect(schema.safeParse({ ...preview, viewport: { ...viewport, xMm: 199999 } }).success).toBe(
    false,
  );
  expect(schema.safeParse({ ...preview, viewport: { ...viewport, widthMm: 200001 } }).success).toBe(
    false,
  );
  expect(schema.safeParse({ revision: 'live-1', status: 'disabled', viewport }).success).toBe(
    false,
  );
});

it('strips private capability and item metadata while preserving public touch hints', () => {
  const workspace = {
    revision: 'live-1',
    mode: 'laser',
    name: 'Current workspace',
    dirty: false,
    selection: [],
    artwork: [
      { id: 'art-1', type: 'shape', visible: false, editable: false, privatePath: 'private' },
    ],
    operations: [],
    totalArtwork: 1,
    totalOperations: 0,
    truncated: false,
    capabilities: { touchEditing: true, licenceKey: 'private' },
  };
  const output = mcpOutputSchemas.get_workspace.parse(workspace);
  expect(output.capabilities).toEqual({ touchEditing: true });
  expect(output.artwork[0]).toEqual({
    id: 'art-1',
    type: 'shape',
    visible: false,
    editable: false,
  });
  expect(JSON.stringify(output)).not.toContain('private');
});
