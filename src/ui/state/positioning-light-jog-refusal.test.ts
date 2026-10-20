import { afterEach, describe, expect, it, vi } from 'vitest';
import { consumeControllerCommandResponse } from './laser-interactive-command';
import { harness, originalProject } from '../../__fixtures__/positioning-light-harness';
import { useStore } from './store';

afterEach(() => {
  useStore.setState({ project: originalProject });
});

describe('positioning LED jog refusal containment', () => {
  it.each(
    (['grbl-v1.1', 'grblhal', 'fluidnc'] as const).flatMap((kind) =>
      ['error:20ok', 'error:7002009', 'error:7'].map((response) => ({ kind, response })),
    ),
  )(
    'contains uncertain native jog $kind $response even with cached Idle',
    async ({ kind, response }) => {
      const h = harness(kind);
      h.after((line) => {
        if (line.startsWith('$J=')) h.refuse(line, response);
      });
      await expect(h.actions.centrePositioningLight(40, 45, 1200)).rejects.toThrow(response);
      expect(h.stop).toHaveBeenCalledOnce();
      expect(h.get().controllerOperation).toBeNull();
      expect(h.writes).not.toContain(`${h.mapping.onCommand}\n`);
    },
  );

  it.each(
    (['grbl-v1.1', 'grblhal', 'fluidnc'] as const).flatMap((kind) =>
      [15, 20].map((code) => ({ kind, code })),
    ),
  )('contains reported Jog despite native refusal $kind $code', async ({ kind, code }) => {
    const h = harness(kind);
    h.after((line) => {
      if (!line.startsWith('$J=')) return;
      h.set({ statusReport: { ...h.get().statusReport!, state: 'Jog' } });
      h.refuse(line, `error:${code}`);
    });
    await expect(h.actions.centrePositioningLight(40, 45, 1200)).rejects.toThrow(`error:${code}`);
    expect(h.stop).toHaveBeenCalledOnce();
    expect(h.get().controllerOperation).toBeNull();
    expect(h.writes).not.toContain(`${h.mapping.onCommand}\n`);
  });
  it.each(
    (['grbl-v1.1', 'grblhal', 'fluidnc'] as const).flatMap((kind) =>
      [15, 20].map((code) => ({ kind, code })),
    ),
  )(
    'releases confirmed native refusal $kind $code without reset-based Abort',
    async ({ kind, code }) => {
      const h = harness(kind);
      h.after((line) => {
        if (line.startsWith('$J=')) h.hold(line);
      });
      const pending = h.actions.centrePositioningLight(40, 45, 1200);
      const response = `error:${code}`;
      const failure = expect(pending).rejects.toThrow(response);
      await vi.waitFor(() => expect(h.writes.some((line) => line.startsWith('$J='))).toBe(true));
      consumeControllerCommandResponse(h.refs, h.refs.driver.classifyLine(response), response);
      await failure;
      expect(h.stop).not.toHaveBeenCalled();
      expect(h.get().controllerOperation).toBeNull();
      expect(h.writes).not.toContain(`${h.mapping.onCommand}\n`);
    },
  );

  it('contains a refused Falcon G1 move without applying the native-jog exemption', async () => {
    const h = harness('grbl-v1.1', 'creality-falcon-a1-pro');
    h.after((line) => {
      if (line.startsWith('G1 ')) h.refuse(line, 'error:15');
    });
    await expect(h.actions.centrePositioningLight(40, 45, 1200)).rejects.toThrow('error:15');
    expect(h.stop).toHaveBeenCalledOnce();
    expect(h.writes).not.toContain(`${h.mapping.onCommand}\n`);
  });
});
