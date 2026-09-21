import { describe, expect, it } from 'vitest';
import { prepareOutputRequestForTest } from '../../__fixtures__/output-preparation-request';
import { DEFAULT_OUTPUT_SCOPE } from '../../core/scene';
import { prepareOutput, type PrepareOutputOptions } from '../../io/gcode';
import { resolveJobPlacement, runtimeCoordinatePreparationOptions } from '../job-placement';
import { prepareStartJob } from '../laser/start-job-readiness';
import {
  estimateLiveJob,
  estimateLiveJobFromPrepared,
  estimateLiveJobSnapshot,
  estimateLiveJobUnbounded,
} from '../laser/live-job-estimate';
import {
  buildPreviewToolpath,
  buildPreviewToolpathFromPrepared,
  buildPreviewToolpathSnapshot,
} from './draw-preview';
import { prepareLargeJob, prepareLargeJobAsync } from './large-job-preparation';
import { coordinateEntryMachine, coordinateEntryProject } from './runtime-coordinate.test-support';

describe('runtime coordinate inputs across preparation consumers', () => {
  it.each(['absolute', 'user-origin', 'current-position'] as const)(
    '%s gives no-snapshot worker Start the same bytes and Frame bounds as direct Start',
    async (startFrom) => {
      const project = coordinateEntryProject();
      const machine = coordinateEntryMachine(project, startFrom === 'absolute');
      const controllerSettings = machine.controllerSettings ?? null;
      const placement = { startFrom, anchor: 'front-left' } as const;
      const direct = prepareStartJob(
        project,
        controllerSettings,
        machine,
        placement,
        DEFAULT_OUTPUT_SCOPE,
        undefined,
        false,
      );
      const worker = await prepareOutputRequestForTest({
        kind: 'start',
        project,
        machine,
        controllerSettings,
        jobPlacement: placement,
        outputScope: DEFAULT_OUTPUT_SCOPE,
        requireFrame: false,
      });
      if (!direct.ok || worker.kind !== 'start' || !worker.result.ok)
        throw new Error('Start fixture did not prepare');
      expect(worker.result.gcode).toBe(direct.gcode);
      expect(worker.result.prepared.job).toEqual(direct.prepared.job);
      expect(worker.result.prepared.jobOriginOffset).toEqual(direct.prepared.jobOriginOffset);
      expect(worker.result.metrics.frameMotionBounds).toEqual(direct.metrics.frameMotionBounds);
      if (startFrom === 'absolute') {
        expect(direct.prepared.jobOriginOffset).toEqual({ x: -400, y: -400 });
        expect(direct.gcode).toContain('X-395.000 Y-20.000');
      } else if (startFrom === 'user-origin') {
        expect(direct.gcode).toContain('X-5.000 Y0.000');
      }
    },
  );

  it.each(['absolute', 'user-origin'] as const)(
    '%s preserves the physical envelope and placement through Preview and ETA entry points',
    async (startFrom) => {
      const project = coordinateEntryProject();
      const machine = coordinateEntryMachine(project, startFrom === 'absolute');
      const placement = resolveJobPlacement({ startFrom, anchor: 'front-left' }, machine);
      if (!placement.ok) throw new Error('Placement fixture');
      const options: PrepareOutputOptions = {
        ...runtimeCoordinatePreparationOptions(project.device, placement, machine),
        ...(placement.jobOrigin === undefined ? {} : { jobOrigin: placement.jobOrigin }),
      };
      const prepared = prepareOutput(project, options);
      if (!prepared.ok) throw new Error('Prepare fixture');
      const expectedPreview = buildPreviewToolpathFromPrepared(
        project,
        prepared,
        placement.jobOrigin,
        { executablePlan: true },
      );
      const expectedEstimate = estimateLiveJobFromPrepared(prepared, placement.jobOrigin);
      const snapshot = {
        clock: () => new Date('2026-09-22T00:00:00Z'),
        renderVariableText: async () => {
          throw new Error('No variable text');
        },
      };
      expect(buildPreviewToolpath(project, options)).toEqual(expectedPreview);
      expect(await buildPreviewToolpathSnapshot(project, { ...options, ...snapshot })).toEqual(
        expectedPreview,
      );
      expect(estimateLiveJob(project, DEFAULT_OUTPUT_SCOPE, placement.jobOrigin, options)).toEqual(
        expectedEstimate,
      );
      expect(
        estimateLiveJobUnbounded(project, DEFAULT_OUTPUT_SCOPE, placement.jobOrigin, options),
      ).toEqual(expectedEstimate);
      expect(
        await estimateLiveJobSnapshot(
          project,
          DEFAULT_OUTPUT_SCOPE,
          snapshot.clock,
          snapshot.renderVariableText,
          undefined,
          placement.jobOrigin,
          options,
        ),
      ).toEqual(expectedEstimate);
      const large = prepareLargeJob(project, options);
      const asynchronous = await prepareLargeJobAsync(project, options, async (source, request) =>
        prepareOutput(source, request),
      );
      expect(large.estimate).toEqual(expectedEstimate);
      expect(large.jobOriginOffset).toEqual(prepared.jobOriginOffset);
      expect(asynchronous).toEqual(large);
      const unknown = prepareLargeJob(project, { ...options, contourEntryBounds: null });
      expect(unknown.estimate).not.toEqual(large.estimate);
    },
  );
});
