// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { MCP_CONTROL_COMMANDS, mcpInputSchemas, type KerfDeskMcpCommand } from './input-schemas.js';
import { mcpOutputSchemas } from './output-schemas.js';
import { mcpToolInfo } from './tool-info.js';

const admission = {
  expectedRevision: 'revision-1',
  requestId: '12345678-1234-4234-8234-123456789abc',
};
const commands = [
  'get_board',
  'set_board_photo',
  'place_on_board',
  'capture_board_point',
  'finish_board',
] as const satisfies ReadonlyArray<KerfDeskMcpCommand>;

describe('Place Board MCP contract', () => {
  it('registers input, output and tool information for every board command', () => {
    for (const command of commands) {
      expect(mcpInputSchemas[command]).toBeDefined();
      expect(mcpOutputSchemas[command]).toBeDefined();
      expect(mcpToolInfo[command].description).not.toBe('');
    }
  });

  it('parses valid board tool inputs', () => {
    expect(mcpInputSchemas.get_board.safeParse({}).success).toBe(true);
    expect(
      mcpInputSchemas.set_board_photo.safeParse({
        ...admission,
        mimeType: 'image/png',
        dataBase64: 'iVBORw0KGgo=',
      }).success,
    ).toBe(true);
    expect(
      mcpInputSchemas.place_on_board.safeParse({
        ...admission,
        artworkIds: ['art-1'],
        action: 'array',
        rows: 2,
        cols: 3,
      }).success,
    ).toBe(true);
    expect(mcpInputSchemas.capture_board_point.safeParse(admission).success).toBe(true);
    expect(mcpInputSchemas.finish_board.safeParse(admission).success).toBe(true);
  });

  it('rejects invalid photo and array inputs', () => {
    expect(
      mcpInputSchemas.set_board_photo.safeParse({
        ...admission,
        mimeType: 'image/webp',
        dataBase64: 'AAAA',
      }).success,
    ).toBe(false);
    expect(
      mcpInputSchemas.place_on_board.safeParse({
        ...admission,
        artworkIds: ['art-1', 'art-2'],
        action: 'array',
      }).success,
    ).toBe(false);
  });

  it('classifies capture and finish as control tools', () => {
    expect(MCP_CONTROL_COMMANDS.has('capture_board_point')).toBe(true);
    expect(MCP_CONTROL_COMMANDS.has('finish_board')).toBe(true);
    expect(MCP_CONTROL_COMMANDS.has('set_board_photo')).toBe(false);
  });
});
