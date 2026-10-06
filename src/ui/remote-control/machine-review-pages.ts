import { RemoteFault } from './fault';
import type { JobReviewModel } from '../laser/job-review/job-review-model';
import type { MachineReview, MachineReviewPageRequest } from './machine-types';

// Keep the duplicated MCP text/structured envelope far below its 256 KiB limit.
export const MACHINE_REVIEW_PAGE_BYTES = 24 * 1024;
const PAGE_FACTS = 60;
type Pagination = NonNullable<MachineReview['pagination']>;
type ReviewFacts = Pick<MachineReview, 'stats' | 'warnings' | 'operations'> & {
  readonly pagination: Pagination;
};
type NativeFact =
  | { readonly kind: 'stat'; readonly stat: JobReviewModel['stats'][number] }
  | { readonly kind: 'warning'; readonly index: number; readonly message: string }
  | {
      readonly kind: 'operation';
      readonly index: number;
      readonly item: JobReviewModel['effectiveOperations'][number];
      readonly summaryOffset: number;
      readonly summary: string | undefined;
    };
type ProjectMessage = (value: string, fallback: string) => string;

/** Pages never change the canonical review, acknowledge it, or dispatch controller work. */
export function machineReviewPage(
  model: JobReviewModel,
  projectMessage: ProjectMessage,
  page?: MachineReviewPageRequest,
): ReviewFacts {
  const pagination = reviewCounts(model, page?.offset ?? 0);
  if (pagination.offset > 0 && pagination.offset >= pagination.totalFacts)
    throw new RemoteFault('invalid_arguments');
  const builder = new ReviewPageBuilder(pagination, projectMessage);
  let cursor = 0;
  for (const fact of nativeFacts(model)) {
    if (cursor++ < pagination.offset) continue;
    if (!builder.add(fact)) break;
  }
  if (builder.included === 0 && pagination.totalFacts > pagination.offset)
    throw new RemoteFault('unavailable');
  const next = pagination.offset + builder.included;
  return {
    ...builder.facts,
    pagination: { ...pagination, nextOffset: next < pagination.totalFacts ? next : null },
  };
}

function reviewCounts(model: JobReviewModel, offset: number): Pagination {
  return {
    offset,
    nextOffset: null,
    totalFacts:
      model.stats.length +
      model.warnings.length +
      model.effectiveOperations.reduce((n, item) => n + Math.max(1, item.summaries.length), 0),
    totalWarnings: model.warnings.length,
    totalOperations: model.effectiveOperations.length,
    totalStats: model.stats.length,
    totalSummaries: model.effectiveOperations.reduce((n, item) => n + item.summaries.length, 0),
  };
}

function* nativeFacts(model: JobReviewModel): Generator<NativeFact> {
  for (const stat of model.stats) yield { kind: 'stat', stat };
  for (const [index, message] of model.warnings.entries())
    yield { kind: 'warning', index, message };
  for (const [index, item] of model.effectiveOperations.entries()) {
    if (item.summaries.length === 0)
      yield { kind: 'operation', index, item, summaryOffset: 0, summary: undefined };
    for (const [summaryOffset, summary] of item.summaries.entries())
      yield { kind: 'operation', index, item, summaryOffset, summary };
  }
}

class ReviewPageBuilder {
  readonly stats: JobReviewModel['stats'][number][] = [];
  readonly warnings: MachineReview['warnings'][number][] = [];
  readonly operations: MachineReview['operations'][number][] = [];
  readonly facts: ReviewFacts;
  included = 0;
  constructor(
    pagination: Pagination,
    private readonly projectMessage: ProjectMessage,
  ) {
    this.facts = {
      stats: this.stats,
      warnings: this.warnings,
      operations: this.operations,
      pagination,
    };
  }
  add(fact: NativeFact): boolean {
    if (this.full(fact)) return false;
    const rollback = this.append(fact);
    // Reserve space for replacing null with a safe-integer nextOffset in the final page.
    if (
      new TextEncoder().encode(JSON.stringify(this.facts)).byteLength >
      MACHINE_REVIEW_PAGE_BYTES - 32
    ) {
      rollback();
      return false;
    }
    this.included++;
    return true;
  }
  private full(fact: NativeFact): boolean {
    if (this.included >= PAGE_FACTS) return true;
    if (fact.kind === 'stat') return this.stats.length >= 16;
    const last = this.operations.at(-1);
    return fact.kind === 'operation' && last?.index === fact.index && last.summaries.length >= 20;
  }
  private append(fact: NativeFact): () => void {
    if (fact.kind === 'operation') return this.appendOperation(fact);
    if (fact.kind === 'warning') {
      this.warnings.push({
        code: `review-${fact.index + 1}`,
        message: this.projectMessage(
          fact.message,
          'Review this artwork-specific warning on the PC.',
        ),
      });
      return () => {
        this.warnings.pop();
      };
    }
    const stat = fact.stat;
    this.stats.push({
      label: this.projectMessage(stat.label, 'Job fact'),
      value: this.projectMessage(stat.value, 'See PC'),
      detail: this.projectMessage(stat.detail, 'Review this fact on the PC.'),
      ...(stat.emphasis === undefined ? {} : { emphasis: stat.emphasis }),
    });
    return () => {
      this.stats.pop();
    };
  }
  private appendOperation(fact: Extract<NativeFact, { readonly kind: 'operation' }>): () => void {
    const previous = this.operations.at(-1);
    const projected =
      fact.summary === undefined
        ? []
        : [this.projectMessage(fact.summary, 'Review this operation summary on the PC.')];
    if (previous?.index === fact.index) {
      this.operations[this.operations.length - 1] = {
        ...previous,
        summaries: [...previous.summaries, ...projected],
      };
      return () => {
        this.operations[this.operations.length - 1] = previous;
      };
    }
    this.operations.push({
      operationId: fact.item.layerId,
      index: fact.index,
      summaryOffset: fact.summaryOffset,
      summaryTotal: fact.item.summaries.length,
      summaries: projected,
    });
    return () => {
      this.operations.pop();
    };
  }
}
