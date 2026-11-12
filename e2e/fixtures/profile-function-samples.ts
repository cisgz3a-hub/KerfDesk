// Counts, for each watched function name, the CPU profile samples whose stack
// holds a frame of that name (once per sample, however deep the recursion).
// A Map keys only the names it was given: a plain object answered `name in
// counts` for inherited names too, so a sampled native `toString` counted as
// a watched pass and failed the Abort-promptness guard (code-quality audit C2
// D7-P2-1).

export interface ProfileNode {
  readonly id: number;
  readonly callFrame: { readonly functionName: string };
  readonly children?: readonly number[];
}

export interface CpuProfileSamples {
  readonly nodes: readonly ProfileNode[];
  readonly samples?: readonly number[];
}

export function functionSampleCounts(
  profile: CpuProfileSamples,
  watched: readonly string[],
): Map<string, number> {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map<number, number>();
  for (const node of profile.nodes) {
    for (const child of node.children ?? []) parents.set(child, node.id);
  }
  const counts = new Map(watched.map((name) => [name, 0]));
  for (const sampled of profile.samples ?? []) {
    const seen = new Set<string>();
    for (let at: number | undefined = sampled; at !== undefined; at = parents.get(at)) {
      const name = nodes.get(at)?.callFrame.functionName ?? '';
      if (counts.has(name)) seen.add(name);
    }
    for (const name of seen) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}
