// Words for one found piece in the Camera panel (ADR-442): its size and
// angle as measured, how the design will move and turn to land on it, and
// anything the operator should look at before placing.

import type { DetectedPiece } from '../../../core/camera/pieces/find-pieces';
import type { ArrayPlacement } from '../../../core/scene';

// Pieces this much longer or wider than the design's own piece are flagged.
const SIZE_DIFFERENCE_MM = 3;

export function pieceSizeLabel(piece: DetectedPiece): string {
  const { rect } = piece;
  if (piece.shape === 'round') return `⌀ ${mm(rect.length)} mm`;
  return `${mm(rect.length)} × ${mm(rect.width)} mm at ${mm(rect.axisDeg)}°`;
}

export function pieceMoveLabel(placement: ArrayPlacement): string {
  const move = `moves ${signed(placement.dx)}, ${signed(placement.dy)} mm`;
  return placement.rotationDeg === 0 ? move : `${move}, turns ${mm(placement.rotationDeg)}°`;
}

export function pieceNotes(piece: DetectedPiece, sample: DetectedPiece | null): string[] {
  const notes: string[] = [];
  if (piece === sample) notes.push('Your design is on this piece.');
  if (piece.partial) notes.push('Partly out of the camera’s view, so its centre may be off.');
  if (sample !== null && piece !== sample && differsInSize(piece, sample)) {
    notes.push('Not the same size as the piece your design is on.');
  }
  return notes;
}

function differsInSize(a: DetectedPiece, b: DetectedPiece): boolean {
  return (
    a.shape !== b.shape ||
    Math.abs(a.rect.length - b.rect.length) > SIZE_DIFFERENCE_MM ||
    Math.abs(a.rect.width - b.rect.width) > SIZE_DIFFERENCE_MM
  );
}

function mm(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

function signed(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return rounded >= 0 ? `+${Math.abs(rounded).toFixed(1)}` : rounded.toFixed(1);
}
