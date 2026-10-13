// Read-only software audit: no controller connection, firmware changes, or job execution.
// Run: node scripts/audit-quality-first-timing.mjs
import { createServer } from 'vite';

// Independent rest-to-rest trapezoid/triangle formula, without the app's planner.
function independentAxisSeconds(distanceMm, maxFeedMmPerMin, accelerationMmPerSec2) {
  const velocityMmPerSec = maxFeedMmPerMin / 60;
  const accelerationDistanceMm = velocityMmPerSec ** 2 / accelerationMmPerSec2;
  return distanceMm >= accelerationDistanceMm
    ? distanceMm / velocityMmPerSec + velocityMmPerSec / accelerationMmPerSec2
    : 2 * Math.sqrt(distanceMm / accelerationMmPerSec2);
}

const scalarLimits = {
  accelMmPerSec2: 500,
  junctionDeviationMm: 0.01,
  maxFeedMmPerMin: 10000,
};
const initialPositionMm = { x: 0, y: 0, z: 0 };
const server = await createServer({
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom',
});

try {
  const { buildProgramTimeline } = await server.ssrLoadModule(
    '/src/core/gcode-time/program-timeline.ts',
  );
  const { createStreamer } = await server.ssrLoadModule('/src/core/controllers/grbl/streamer.ts');

  function timeline(gcode, options) {
    const result = buildProgramTimeline(gcode, scalarLimits, { initialPositionMm, ...options });
    if (result.kind !== 'ok') throw new Error(result.reason);
    return result.timeline;
  }

  const axisExamples = [
    { axis: 'Y', distanceMm: 100, axisMaxFeedMmPerMin: 1000, axisAccelerationMmPerSec2: 500 },
    { axis: 'Z', distanceMm: 20, axisMaxFeedMmPerMin: 600, axisAccelerationMmPerSec2: 50 },
  ].map((example) => {
    const gcode = `G21 G90\nG0 ${example.axis}${example.distanceMm}`;
    const current = timeline(gcode, { machineKind: 'cnc' });
    const axisSeconds = independentAxisSeconds(
      example.distanceMm,
      example.axisMaxFeedMmPerMin,
      example.axisAccelerationMmPerSec2,
    );
    return {
      ...example,
      gcode,
      currentScalarEstimateSeconds: current.totalSeconds,
      independentAxisLimitedSeconds: axisSeconds,
      axisToScalarRatio: axisSeconds / current.totalSeconds,
    };
  });

  const gcode = [
    'G21 G90',
    ...Array.from({ length: 1000 }, (_, index) => `G1 X${((index + 1) / 1000).toFixed(3)} F6000`),
  ].join('\n');
  const transport = timeline(gcode, {
    machineKind: 'laser',
    baudRate: 115200,
    plannerBlocks: 15,
  });
  const sendableLineCount = createStreamer(gcode, { streamingMode: 'ping-pong' }).total;
  const assumedWriteToAckSeconds = 0.016;
  const lastLineEarliestDispatchSeconds = (sendableLineCount - 1) * assumedWriteToAckSeconds;

  console.log(
    JSON.stringify(
      {
        scope: 'Software-only hypothetical fixtures; no hardware timings or quality claims.',
        scalarLimits,
        axisExamples,
        pingPongExample: {
          motionLineCount: 1000,
          segmentLengthMm: 0.001,
          sendableLineCount,
          baudRate: 115200,
          plannerBlocks: 15,
          currentMotionSeconds: transport.motionSeconds,
          currentWireSeconds: transport.wireSeconds,
          currentTotalSeconds: transport.totalSeconds,
          assumedWriteToAckSeconds,
          latencyAssumption:
            'Illustrative constant 16 ms from dispatch to ACK, including delivery. Not measured; no ACK overlap in ping-pong.',
          independentLastLineEarliestDispatchSeconds: lastLineEarliestDispatchSeconds,
          interpretation:
            'Last-line dispatch is a lower bound on completion, before its delivery and remaining motion. The ETA has no latency input.',
        },
      },
      null,
      2,
    ),
  );
} finally {
  await server.close();
}
