/** Applied before cell escaping and again to the complete local support report. */
export function redactSupportReportText(text: string): string {
  return text.replace(/\bKD\d+\.[\w-]+\.[\w-]+/g, 'KD1.[licence key removed]');
}
