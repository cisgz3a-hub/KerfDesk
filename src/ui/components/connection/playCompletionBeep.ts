/**
 * T1-157: completion-beep extracted from ConnectionPanelMain. Pre-
 * T1-157 this 22-line side-effect function lived in the 2570-line
 * panel; the WebAudio code is encapsulated but the function isn't
 * pure (it touches `window.AudioContext`). Hoisting it to its own
 * 30-line module:
 *
 *   - Lets the panel render-body skip the WebAudio detail
 *   - Documents the beep envelope as a stable surface (the audible
 *     "task done" pattern operators hear at job end)
 *   - Makes it trivial to mock in tests that need to verify a beep
 *     would fire (vs. actually playing audio)
 *
 * Beep envelope:
 *   - 880 Hz sine wave
 *   - First pulse 0.0s → 0.12s, gain 0.15
 *   - Silence 0.12s → 0.20s
 *   - Second pulse 0.20s → 0.32s, gain 0.15
 *   - Stops at 0.40s
 *
 * Two beeps in 400 ms — long enough to register as "done"
 * acoustically, short enough to not be intrusive.
 *
 * `try`/`catch` swallows every error because audio is a nice-to-have
 * — a missing AudioContext (older browser, headless environment,
 * permission denied) must not break the panel.
 */

/**
 * Play the two-pulse completion beep at job end. Silently no-ops
 * when WebAudio is unavailable (no AudioContext, no
 * webkitAudioContext, or any error during oscillator creation).
 */
export function playCompletionBeep(): void {
  try {
    const AC = window.AudioContext
      || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const audioCtx = new AC();
    const oscillator = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    oscillator.connect(gain);
    gain.connect(audioCtx.destination);

    oscillator.frequency.value = 880;
    oscillator.type = 'sine';
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.setValueAtTime(0, audioCtx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime + 0.2);
    gain.gain.setValueAtTime(0, audioCtx.currentTime + 0.32);

    oscillator.start(audioCtx.currentTime);
    oscillator.stop(audioCtx.currentTime + 0.4);
  } catch {
    /* Audio not available */
  }
}
