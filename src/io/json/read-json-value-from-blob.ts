import { JsonValueAssembler } from './json-value-assembler';
import { JsonTokenizer } from './json-tokenizer';

export class StreamedJsonSyntaxError extends Error {
  public constructor(error: unknown) {
    super(error instanceof Error ? error.message : String(error), { cause: error });
    this.name = 'StreamedJsonSyntaxError';
  }
}

/**
 * Parses one JSON value directly from Blob bytes without first retaining a whole
 * decoded source string. The parsed value and any single string/number token still
 * scale with input content.
 */
export async function readJsonValueFromBlob(blob: Blob): Promise<unknown> {
  const decoder = new TextDecoder();
  const assembler = new JsonValueAssembler();
  const tokenizer = new JsonTokenizer();
  tokenizer.onToken = (token) => assembler.write(token);

  const reader = blob.stream().getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      writeJson(tokenizer, decoder.decode(value, { stream: true }));
    }
    writeJson(tokenizer, decoder.decode());
    try {
      tokenizer.end();
      assembler.end();
    } catch (error) {
      throw new StreamedJsonSyntaxError(error);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  return assembler.value();
}

function writeJson(tokenizer: JsonTokenizer, text: string): void {
  if (text.length === 0) return;
  try {
    tokenizer.write(text);
  } catch (error) {
    throw new StreamedJsonSyntaxError(error);
  }
}
