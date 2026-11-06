export type Positioned<T> = { item: T; lane: number; lanes: number };

/**
 * Verteilt zeitlich überlappende Termine auf nebeneinanderliegende Spuren (wie Outlook/Google).
 * Gibt je Termin die Spur und die Spurenzahl seiner Überlappungsgruppe zurück.
 */
export function assignLanes<T>(items: T[], range: (item: T) => [number, number]): Positioned<T>[] {
  const sorted = [...items].sort((a, b) => range(a)[0] - range(b)[0] || range(a)[1] - range(b)[1]);
  const result: Positioned<T>[] = [];
  let cluster: Positioned<T>[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    const lanes = Math.max(1, laneEnds.length);
    cluster.forEach((p) => (p.lanes = lanes));
    result.push(...cluster);
    cluster = [];
    laneEnds = [];
    clusterEnd = -Infinity;
  };

  for (const item of sorted) {
    const [start, end] = range(item);
    if (start >= clusterEnd) flush();
    let lane = laneEnds.findIndex((e) => e <= start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }
    clusterEnd = Math.max(clusterEnd, end);
    cluster.push({ item, lane, lanes: 1 });
  }
  flush();
  return result;
}
