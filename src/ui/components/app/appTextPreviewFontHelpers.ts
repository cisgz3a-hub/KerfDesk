export interface TextPreviewFontLoadInput {
  showTextDialog: boolean;
  textBold: boolean;
  textFont: string;
  textInput: string;
  textItalic: boolean;
  textSize: number;
}

export interface TextPreviewFontLoadRequest {
  fontSpec: string;
  sample: string;
}

/**
 * T2-6 Phase 3aj: pure text-preview font-load request formatting.
 * App.tsx still owns browser font availability checks and document.fonts.load.
 */
export function buildTextPreviewFontLoadRequest(
  input: TextPreviewFontLoadInput,
): TextPreviewFontLoadRequest | null {
  if (!input.showTextDialog) return null;

  const fontSizePx = Math.min(input.textSize * 2, 48);
  const stylePrefix = input.textItalic ? 'italic ' : '';
  const weightPrefix = input.textBold ? 'bold ' : '';

  return {
    fontSpec: `${stylePrefix}${weightPrefix}${fontSizePx}px "${input.textFont}"`,
    sample: input.textInput || 'Preview',
  };
}
