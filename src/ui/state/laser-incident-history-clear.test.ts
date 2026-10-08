import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CAPTURE_IDLE,
  beginCaptureTest,
  captureConsoleRaw,
  captureController,
  clearCapturedIncidents,
  connectCaptureController,
  endCaptureTest,
  renderCaptureConsole,
} from '../../__fixtures__/controller-incident-capture';
import {
  SAFETY_NOTICE,
  incidentHistory,
  seedIncidentHistory,
} from '../../__fixtures__/controller-incidents';
import { useLaserStore } from './laser-store';
import { inboundTranscriptEntry } from './laser-transcript';
import {
  bufferTranscriptEntry,
  publishTranscriptPatch,
  type TranscriptBufferRefs,
} from './laser-transcript-buffer';

beforeEach(beginCaptureTest);
afterEach(endCaptureTest);

function seedLiveError(controller: ReturnType<typeof captureController>) {
  controller.connection.emitLine('error:20');
  const error = useLaserStore.getState().transcript.find((entry) => entry.raw === 'error:20');
  expect(error).toBeDefined();
  if (error === undefined) throw new Error('The live controller error was not published.');
  // Isolate clearing from the separate capture defect: this exact live entry
  // is still in the rolling transcript when its retained copy is cleared.
  seedIncidentHistory([error], {
    safetyNotice: SAFETY_NOTICE,
    frameVerification: { boundsSignature: 'D1 reviewed job', wco: null, workOriginActive: false },
  });
  return error;
}

function controllerFacts() {
  const state = useLaserStore.getState();
  return {
    connection: state.connection,
    qualification: state.controllerQualification,
    settings: state.controllerSettings,
    observation: state.statusObservation,
    controllerSessionEpoch: state.controllerSessionEpoch,
    controllerOperation: state.controllerOperation,
    streamer: state.streamer,
    streamerEpoch: state.streamerEpoch,
    pendingUntrackedAcks: state.pendingUntrackedAcks,
    pendingTransportWrites: state.pendingTransportWrites ?? 0,
    safetyNotice: state.safetyNotice,
    frame: state.frameVerification,
    lastError: state.lastError,
  };
}

describe('D1 explicit incident clear while raw history remains', () => {
  it('removes a still-live incident from the merged console while retaining benign rows and controller evidence', async () => {
    const controller = captureController({ statusReply: () => CAPTURE_IDLE });
    await connectCaptureController(controller.connection);
    useLaserStore.getState().clearTranscript();
    controller.connection.emitLine('[MSG:Ready]');
    controller.connection.emitLine(CAPTURE_IDLE);
    await useLaserStore.getState().sendConsoleCommand('G4 P0');
    const error = seedLiveError(controller);
    // The error consumes the real command's terminal ACK. Add a second real
    // reservation so Clear also proves it cannot settle or reset ACK ownership.
    controller.connection.emitLine(CAPTURE_IDLE);
    await useLaserStore.getState().sendConsoleCommand('G4 P0');
    seedIncidentHistory([error], {
      safetyNotice: SAFETY_NOTICE,
      frameVerification: { boundsSignature: 'D1 reviewed job', wco: null, workOriginActive: false },
    });
    const benign = useLaserStore.getState().transcript.filter((entry) => entry.id !== error.id);
    const before = controllerFacts();
    const wireBefore = [...controller.writes];
    expect(before.pendingUntrackedAcks).toBe(1);
    await renderCaptureConsole();
    expect(captureConsoleRaw()).toContain(error.raw);

    await act(async () => clearCapturedIncidents());

    expect(captureConsoleRaw()).not.toContain(error.raw);
    expect(incidentHistory()).toEqual([]);
    expect(useLaserStore.getState().transcript).toEqual(expect.arrayContaining(benign));
    expect(captureConsoleRaw()).toEqual(expect.arrayContaining(benign.map((entry) => entry.raw)));
    expect(controllerFacts()).toEqual(before);
    expect(controller.writes).toEqual(wireBefore);
    await act(async () => controller.connection.emitLine('ok'));
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    expect(incidentHistory()).toEqual([]);
    expect(captureConsoleRaw()).not.toContain(error.raw);
  });

  it('publishing a subsequent job-ACK batch cannot rearchive the old still-live incident', async () => {
    const controller = captureController();
    await connectCaptureController(controller.connection);
    useLaserStore.getState().clearTranscript();
    const error = seedLiveError(controller);
    const refs: TranscriptBufferRefs = {};
    bufferTranscriptEntry(
      refs,
      inboundTranscriptEntry(error.id + 1, error.at + 1, 'ok', undefined, 'grbl-v1.1', 'job'),
      'ok',
    );
    clearCapturedIncidents();
    useLaserStore.setState((state) => publishTranscriptPatch(refs, state));
    expect(
      useLaserStore
        .getState()
        .transcript.some((entry) => entry.kind === 'ok' && entry.source === 'job'),
    ).toBe(true);
    expect(incidentHistory()).toEqual([]);
    expect(useLaserStore.getState().safetyNotice).toEqual(SAFETY_NOTICE);
    expect(useLaserStore.getState().frameVerification?.boundsSignature).toBe('D1 reviewed job');
    await renderCaptureConsole();
    expect(captureConsoleRaw()).not.toContain(error.raw);
    expect(captureConsoleRaw()).toContain('ok');
  });

  it('a later live incident with the same raw text is retained and visible with its new identity', async () => {
    const controller = captureController();
    await connectCaptureController(controller.connection);
    useLaserStore.getState().clearTranscript();
    const old = seedLiveError(controller);
    clearCapturedIncidents();
    controller.connection.emitLine('error:20');
    const next = useLaserStore
      .getState()
      .transcript.filter((entry) => entry.raw === old.raw)
      .at(-1);
    expect(next?.id).toBeGreaterThan(old.id);
    expect(incidentHistory()).toEqual([next]);
    await renderCaptureConsole();
    expect(captureConsoleRaw().filter((raw) => raw === old.raw)).toHaveLength(1);
  });

  it('control: ordinary Clear drops benign rolling rows without acknowledging SafetyNotice or altering Frame/ACK state', async () => {
    const controller = captureController();
    await connectCaptureController(controller.connection);
    controller.connection.emitLine('[MSG:Ready]');
    useLaserStore.setState({
      safetyNotice: SAFETY_NOTICE,
      frameVerification: { boundsSignature: 'D1 reviewed job', wco: null, workOriginActive: false },
    });
    const before = controllerFacts();
    useLaserStore.getState().clearTranscript();
    expect(useLaserStore.getState().transcript).toEqual([]);
    expect(controllerFacts()).toEqual(before);
    expect(incidentHistory()).toEqual([]);
  });
});
