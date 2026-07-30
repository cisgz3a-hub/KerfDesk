import { iterateLines } from '../../core/util';
import {
  createDxfEntityCollector,
  createDxfMetadataCollector,
  type DxfTagCollector,
} from './dxf-document-stream';
import { createDxfTagLineParser, type DxfTagLineParserResult } from './dxf-tag-line-parser';
import type { ParseDxfResult } from './dxf-result';

export type { ParseDxfResult } from './dxf-result';

export function parseDxf(args: {
  readonly dxfText: string;
  readonly id: string;
  readonly source: string;
}): ParseDxfResult {
  const metadataCollector = createDxfMetadataCollector();
  const metadataResult = runLinePass(args.dxfText, metadataCollector);
  if (metadataResult.kind === 'error') return metadataResult;
  const entityCollector = createDxfEntityCollector(metadataCollector.finish(), args);
  const entityResult = runLinePass(args.dxfText, entityCollector);
  return entityResult.kind === 'error' ? entityResult : entityCollector.finish();
}

function runLinePass(text: string, collector: DxfTagCollector<unknown>): DxfTagLineParserResult {
  const parser = createDxfTagLineParser(collector.pushTag);
  for (const line of iterateLines(text)) parser.pushLine(line);
  return parser.finish();
}
