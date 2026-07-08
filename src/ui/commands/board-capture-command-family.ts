// board-capture-command-family — the single Tools-menu / toolbar command for
// Capture Board Corners (ADR-124): a toggle that opens or closes the floating
// board-capture panel. Every capture action (jog to a corner, set origin, draw
// the outline, place artwork) lives in the panel itself (BoardCapturePanel).

import { enabled, type AppCommand, type AppCommandContext } from './command-types';

export function placeBoardCommand(ctx: AppCommandContext): AppCommand {
  return {
    ...enabled(
      'tools.place-board',
      'tools',
      'Place Board',
      ctx.boardCapturePanelOpen
        ? 'Close the board-capture panel'
        : 'Open the board-capture panel — jog to each corner of a placed board to draw it on the canvas',
      ctx.toggleBoardCapturePanel,
    ),
    active: ctx.boardCapturePanelOpen,
  };
}
