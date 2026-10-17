// Preview and ETA hooks abort their own preparation in the effect cleanup
// before an edit's new request arrives, so nothing is left in flight for the
// client to supersede. Remembering the cancelled project for one quiet window
// lets a request for a DIFFERENT project in that window wait out the same
// ADR-244 supersede debounce: a burst of edits still costs one restart.
export class PreparationCancelledBurst<P extends object> {
  private current: { readonly project: P; readonly timer: ReturnType<typeof setTimeout> } | null =
    null;

  constructor(private readonly windowMs: number) {}

  remember(project: P): void {
    this.forget();
    const timer = setTimeout(() => {
      if (this.current?.timer === timer) this.current = null;
    }, this.windowMs);
    this.current = { project, timer };
  }

  /** True while a request for `project` continues a burst that cancelled other work. */
  continuesBurst(project: P): boolean {
    return this.current !== null && this.current.project !== project;
  }

  forget(): void {
    if (this.current === null) return;
    clearTimeout(this.current.timer);
    this.current = null;
  }
}
