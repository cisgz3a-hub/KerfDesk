export interface ToolpathPreviewDecisionInput {
  showToolpathPreview: boolean;
  isJobRunning: boolean;
}

/**
 * T2-6 Phase 3ai: pure toolpath-preview visibility/work decisions.
 * App.tsx still owns preview move storage, async compilation, and alerts.
 */
export function shouldClearToolpathPreview(input: ToolpathPreviewDecisionInput): boolean {
  return !input.showToolpathPreview || input.isJobRunning;
}

export function shouldCompileToolpathPreview(input: ToolpathPreviewDecisionInput): boolean {
  return input.showToolpathPreview && !input.isJobRunning;
}
