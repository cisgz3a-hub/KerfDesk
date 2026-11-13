import { useState } from 'react';
import { joinOpenVectorPaths } from '../../core/geometry/vector-path-join';
import type { Project } from '../../core/scene';
import { useStore } from '../state';
import { vectorRepairSources } from '../state/vector-repair-sources';

/** Repairs use the established geometry engine and its undo action after a separate preview. */
export function useTemplateVectorRepair() {
  const project = useStore((state) => state.project);
  const selected = useStore((state) => state.selectedObjectId);
  const additional = useStore((state) => state.additionalSelectedIds);
  const join = useStore((state) => state.joinSelectedPaths);
  const [tolerance, setTolerance] = useState('0.1');
  const [reviewed, setReviewed] = useState<{
    readonly project: Project;
    readonly key: string;
    readonly tolerance: number;
    readonly joins: number;
    readonly closures: number;
  } | null>(null);
  const [status, setStatus] = useState('');
  const ids = [...new Set([...(selected === null ? [] : [selected]), ...additional])];
  const key = ids.sort().join('|');
  const review = (): void => {
    // The same sources as the Join store action (ADR-350 Amendment 2).
    const sources = vectorRepairSources(project.scene, ids);
    if (sources === null || sources.kept.length === 0) {
      setStatus(sources?.notice || 'Select unlocked ordinary vector artwork for the join repair.');
      setReviewed(null);
      return;
    }
    const result = joinOpenVectorPaths(sources.kept, project.scene.layers, Number(tolerance));
    if (result.kind === 'error') {
      setStatus(result.error.message);
      setReviewed(null);
      return;
    }
    setReviewed({
      project,
      key,
      tolerance: Number(tolerance),
      joins: result.value.joins,
      closures: result.value.closures,
    });
    setStatus(
      'Repair preview: ' +
        result.value.joins +
        ' joins; ' +
        result.value.closures +
        ' closures. Artwork changes only after Apply path repair.' +
        (sources.notice === '' ? '' : ` ${sources.notice}`),
    );
  };
  const current =
    reviewed !== null &&
    reviewed.project === project &&
    reviewed.key === key &&
    reviewed.tolerance === Number(tolerance);
  const apply = (): void => {
    if (current && reviewed !== null) {
      setStatus(
        join(reviewed.tolerance)
          ? 'Applied path repair. Undo restores the artwork. Review template matches again.'
          : 'The paths could not be joined.',
      );
      setReviewed(null);
    }
  };
  return {
    tolerance,
    setTolerance,
    status,
    current,
    canReview: ids.length > 0,
    canApply: current && (reviewed?.joins ?? 0) + (reviewed?.closures ?? 0) > 0,
    review,
    apply,
  };
}
