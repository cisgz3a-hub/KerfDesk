import { HOST_SCHEDULING_GAP_MS } from './laser-stream-heartbeat';

/** When the status poll's timer last ran, and when it last resumed after a
 * scheduling gap (a long task, a throttled or hidden tab, system sleep). */
export type StatusPollSchedule = {
  readonly lastTickAt: number;
  readonly resumedAt: number;
};

export type StatusPollScheduleRefs = {
  statusPollSchedule?: StatusPollSchedule | null;
};

/** Called at the top of every poll tick, before any early return: it records
 * that the page ran the poll, not that a query was written. The first tick of
 * a session starts the schedule; only a tick after a gap resumes it, so a
 * deadline armed just after connecting keeps its wall-clock meaning. */
export function recordStatusPollTick(refs: StatusPollScheduleRefs, now: number): void {
  const previous = refs.statusPollSchedule ?? null;
  let resumedAt = Number.NEGATIVE_INFINITY;
  if (previous !== null) {
    resumedAt = now - previous.lastTickAt < HOST_SCHEDULING_GAP_MS ? previous.resumedAt : now;
  }
  refs.statusPollSchedule = { lastTickAt: now, resumedAt };
}

/**
 * How much longer a status-silence deadline armed at `armedAt` must wait.
 *
 * Chrome runs a hidden tab's chained timers once a minute, so the 250 ms poll
 * may send one `?` a minute while a one-off timeout still fires on time. Only
 * time the poll ran on schedule counts as controller silence: while it is not
 * running the deadline keeps waiting, and after it resumes the silence is
 * measured from that tick (ADR-356 Amendment 1). With no poll recorded, the
 * deadline keeps its plain wall-clock meaning.
 */
export function hostAwareSilenceRemainingMs(
  schedule: StatusPollSchedule | null | undefined,
  armedAt: number,
  timeoutMs: number,
  now: number,
): number {
  if (schedule == null) return Math.max(0, armedAt + timeoutMs - now);
  if (now - schedule.lastTickAt >= HOST_SCHEDULING_GAP_MS) return timeoutMs;
  return Math.max(0, Math.max(armedAt, schedule.resumedAt) + timeoutMs - now);
}

/** Arms `request.timer` as a status-silence deadline. In a hidden tab Chrome
 * runs the poll once a minute while this one-off timer still fires on time;
 * that silence is the page's, not the controller's, so the deadline re-checks
 * until it has waited `timeoutMs` of on-schedule polling (ADR-356 Amendment 1). */
export function armSilenceTimer(
  refs: StatusPollScheduleRefs,
  request: { timer: ReturnType<typeof setTimeout>; readonly timeoutMs: number },
  expire: () => void,
): void {
  const armedAt = Date.now();
  const check = (): void => {
    const remaining = hostAwareSilenceRemainingMs(
      refs.statusPollSchedule,
      armedAt,
      request.timeoutMs,
      Date.now(),
    );
    if (remaining > 0) request.timer = setTimeout(check, remaining);
    else expire();
  };
  clearTimeout(request.timer);
  request.timer = setTimeout(check, request.timeoutMs);
}
