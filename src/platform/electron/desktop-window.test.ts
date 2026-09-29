import { describe, expect, it, vi } from 'vitest';
import { createDesktopWindowCommands } from './desktop-window';

const POST = {
  method: 'POST',
  cache: 'no-store',
  credentials: 'same-origin',
  headers: { 'X-KerfDesk-Desktop': '1' },
};

describe('the desktop window commands (ADR-554)', () => {
  it('asks the main process to quit through the close question', async () => {
    const fetchCommand = vi.fn(async () => new Response(null, { status: 204 }));
    await createDesktopWindowCommands(fetchCommand).exit();
    expect(fetchCommand).toHaveBeenCalledExactlyOnceWith('./api/desktop/exit', POST);
  });

  it('asks the main process to open the data folder', async () => {
    const fetchCommand = vi.fn(async () => new Response(null, { status: 204 }));
    await createDesktopWindowCommands(fetchCommand).openDataFolder();
    expect(fetchCommand).toHaveBeenCalledExactlyOnceWith('./api/desktop/data-folder', POST);
  });

  it('names the data folder when the file manager could not open it', async () => {
    const commands = createDesktopWindowCommands(async () =>
      Response.json({ folder: 'C:\\Users\\Maker\\AppData\\Roaming\\laserforge' }, { status: 500 }),
    );
    await expect(commands.openDataFolder()).rejects.toThrow(
      'The data folder could not be opened. It is C:\\Users\\Maker\\AppData\\Roaming\\laserforge',
    );
  });

  it('reports a refused command by its status', async () => {
    const commands = createDesktopWindowCommands(
      async () => new Response('Not Found', { status: 404 }),
    );
    await expect(commands.exit()).rejects.toThrow('KerfDesk could not be closed (404).');
    await expect(commands.openDataFolder()).rejects.toThrow(
      'The data folder could not be opened (404).',
    );
  });
});
