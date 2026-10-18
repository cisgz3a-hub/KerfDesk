// The ADR-244 supersede quiet window for the preparation worker client. After a
// supersede, dispatch waits until the window has passed with no further
// supersede, so a burst of edits costs one worker restart.
//
// Preview and ETA hooks abort their own preparation in the effect cleanup
// before an edit's new request arrives, which leaves nothing in flight to
// supersede. The window therefore also remembers a cancelled project for one
// window length: a request for a DIFFERENT project in that time is the next
// edit of the same burst and re-arms the window.
export class PreparationQuietWindow<P extends object> {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cancelled: { readonly project: P; readonly timer: ReturnType<typeof setTimeout> } | null =
    null;

  constructor(
    private readonly windowMs: number,
    private readonly onElapsed: () => void,
  ) {}

  get armed(): boolean {
    return this.timer !== null;
  }

  arm(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.onElapsed();
    }, this.windowMs);
  }

  clear(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  rememberCancelled(project: P): void {
    this.forgetCancelled();
    const timer = setTimeout(() => {
      if (this.cancelled?.timer === timer) this.cancelled = null;
    }, this.windowMs);
    this.cancelled = { project, timer };
  }

  /** Re-arm once when a request for `project` follows another project's cancellation. */
  armForBurst(project: P): void {
    if (this.cancelled === null || this.cancelled.project === project) return;
    this.forgetCancelled();
    this.arm();
  }

  reset(): void {
    this.clear();
    this.forgetCancelled();
  }

  private forgetCancelled(): void {
    if (this.cancelled === null) return;
    clearTimeout(this.cancelled.timer);
    this.cancelled = null;
  }
}
