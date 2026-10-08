// Diagnostic exports are deliberately allowlisted. This is a second layer for
// free-form controller text, not a promise to recognise every possible secret.
export const DIAGNOSTIC_TEXT_LIMIT = 512;

export function redactDiagnosticText(value: string): string | null {
  if (
    /\b(?:password|passwd|secret|token|api[_ -]?key|access[_ -]?key|private[_ -]?key|authorization|bearer|cookie|credential|licen[cs]e[_ -]?key|serial(?:[_ -]?(?:number|no))?|s\/n|ssid|hostname|device[_ -]?id|machine[_ -]?id)\b/i.test(
      value,
    )
  ) {
    return null;
  }
  return value
    .replace(/(?:https?|wss?|rtsp|file):\/\/[^\s<>"']+/gi, '[redacted URL]')
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\r\n<>"']+/g, '[redacted path]')
    .replace(/\/(?:Users|home|tmp|var|mnt|Volumes)\/[^\r\n<>"']+/g, '[redacted path]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[redacted address]')
    .replace(/\b(?:[a-f\d]{2}[:-]){5}[a-f\d]{2}\b/gi, '[redacted identifier]')
    .replace(/\b[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}\b/gi, '[redacted identifier]')
    .replace(/\b[A-Za-z0-9+/=_-]{48,}\b/g, '[redacted long identifier]')
    .slice(0, DIAGNOSTIC_TEXT_LIMIT);
}
