import { describe, expect, it } from 'vitest';
import { startMotionOperation, takeNextMotionLine } from './laser-motion-operation';

describe('motion-operation immutable identity', () => {
  it('allocates a unique symbol for each new operation', () => {
    const first = startMotionOperation('jog');
    const second = startMotionOperation('jog');

    expect(typeof first.operationId).toBe('symbol');
    expect(second.operationId).not.toBe(first.operationId);
  });

  it('carries the same owner through queued motion phases', () => {
    const initial = startMotionOperation('frame', ['G0 X1\n']);
    const next = takeNextMotionLine(initial);

    expect(next?.operation.operationId).toBe(initial.operationId);
  });
});
