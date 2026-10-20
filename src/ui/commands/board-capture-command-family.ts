// board-capture-command-family — the single Tools-menu / toolbar command for
// Place Board (ADR-124): a toggle that opens or closes Place Board mode, whose
// page takes the main canvas's place (ADR-636). Every capture, placement and
// burn action lives on that page itself (BoardCapturePanel).

import { enabled, type AppCommand, type AppCommandContext } from './command-types';

export function placeBoardCommand(ctx: AppCommandContext): AppCommand {
  return {
    ...enabled(
      'tools.place-board',
      'tools',
      'Place Board',
      ctx.boardCapturePanelOpen
        ? 'Leave Place Board and return to the main canvas'
        : 'Open Place Board: capture a board, place the artwork and burn it, with the machine panel beside it',
      ctx.toggleBoardCapturePanel,
    ),
    active: ctx.boardCapturePanelOpen,
  };
}
