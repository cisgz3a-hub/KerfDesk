// Fixtures, reference routes, the independent containment oracle and the
// measurement helpers of the path-order math audit (audit-path-order-math.mjs),
// kept apart so each file stays within the repository size policy.
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Fixtures

export function segment(points, closed = false) {
  return { closed, polyline: points.map(([x, y]) => ({ x, y })) };
}

export function square(x, y, side) {
  return segment(
    [
      [x, y],
      [x + side, y],
      [x + side, y + side],
      [x, y + side],
      [x, y],
    ],
    true,
  );
}

export function translate(seg, dx, dy) {
  return { ...seg, polyline: seg.polyline.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
}

export function cutGroup(layerId, segments) {
  return {
    kind: 'cut',
    layerId,
    color: '#000',
    power: 50,
    speed: 1200,
    passes: 1,
    airAssist: false,
    segments,
  };
}

export function gridSquares(cols, rows, pitch, side) {
  const out = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) out.push(square(c * pitch, r * pitch, side));
  return out;
}

export function randomSquares(count, side, width, height, seed) {
  const random = generator(seed);
  return Array.from({ length: count }, () =>
    square(
      round(5 + random() * (width - side - 10)),
      round(5 + random() * (height - side - 10)),
      side,
    ),
  );
}

export function clusteredSquares(count, clusters, side, seed) {
  const random = generator(seed);
  const centres = Array.from({ length: clusters }, (_, i) => ({
    x: 60 + (i % 2) * 240,
    y: 60 + Math.floor(i / 2) * 160,
  }));
  return Array.from({ length: count }, (_, i) => {
    const c = centres[i % clusters];
    return square(round(c.x + (random() - 0.5) * 60), round(c.y + (random() - 0.5) * 60), side);
  });
}

export function partsGrid({ cols, rows, pitch, outer, hole, holes }) {
  const parts = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = 10 + c * pitch;
      const y = 10 + r * pitch;
      const part = { outer: square(x, y, outer), holes: [] };
      for (let h = 0; h < holes; h++) {
        part.holes.push(square(x + 5 + h * (outer - hole - 10), y + outer / 2 - hole / 2, hole));
      }
      parts.push(part);
    }
  }
  return parts;
}

// ---------------------------------------------------------------------------
// Candidate routes

export function partMajorRoute(parts, start) {
  const remaining = new Set(parts.map((_, i) => i));
  let cursor = start;
  const order = [];
  while (remaining.size > 0) {
    let best = -1;
    let bestDistance = Infinity;
    for (const index of remaining) {
      const d = distance(cursor, parts[index].outer.polyline[0]);
      if (d < bestDistance) {
        bestDistance = d;
        best = index;
      }
    }
    remaining.delete(best);
    order.push(best);
    cursor = parts[best].outer.polyline[0];
  }
  const route = [];
  cursor = start;
  for (const index of order) {
    const part = parts[index];
    const holes = nearestNeighbourClosed(part.holes, cursor);
    route.push(...holes, part.outer);
    cursor = part.outer.polyline.at(-1);
  }
  return route;
}

export function nearestNeighbourClosed(segments, start) {
  const remaining = new Set(segments.map((_, i) => i));
  let cursor = start;
  const out = [];
  while (remaining.size > 0) {
    let best = -1;
    let bestDistance = Infinity;
    for (const index of remaining) {
      const d = distance(cursor, segments[index].polyline[0]);
      if (d < bestDistance) {
        bestDistance = d;
        best = index;
      }
    }
    remaining.delete(best);
    out.push(segments[best]);
    cursor = segments[best].polyline.at(-1);
  }
  return out;
}

// 2-opt and Or-opt on a path with a fixed start, for closed contours whose
// entry and exit coincide (so reversing a sub-sequence changes no geometry).
// `scoreReturn` adds the final hop back to `start`, as the emitted park does.
export function improveClosedTour(segments, start, scoreReturn = false) {
  assert.ok(segments.every((s) => s.closed));
  const pts = segments.map((s) => s.polyline[0]);
  let order = segments.map((_, i) => i);
  const cost = (o) => {
    let total = distance(start, pts[o[0]]);
    for (let i = 1; i < o.length; i++) total += distance(pts[o[i - 1]], pts[o[i]]);
    return scoreReturn ? total + distance(pts[o[o.length - 1]], start) : total;
  };
  let best = cost(order);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const next = [
          ...order.slice(0, i),
          ...order.slice(i, j + 1).reverse(),
          ...order.slice(j + 1),
        ];
        const c = cost(next);
        if (c < best - 1e-9) {
          order = next;
          best = c;
          improved = true;
        }
      }
    }
    for (let len = 1; len <= 3; len++) {
      for (let i = 0; i + len <= order.length; i++) {
        const chunk = order.slice(i, i + len);
        const rest = [...order.slice(0, i), ...order.slice(i + len)];
        for (let k = 0; k <= rest.length; k++) {
          if (k === i) continue;
          const next = [...rest.slice(0, k), ...chunk, ...rest.slice(k)];
          const c = cost(next);
          if (c < best - 1e-9) {
            order = next;
            best = c;
            improved = true;
          }
        }
      }
    }
  }
  return order.map((i) => segments[i]);
}

export function exhaustiveClosedTour(segments, start, scoreReturn = false) {
  const pts = segments.map((s) => s.polyline[0]);
  let best = null;
  let bestCost = Infinity;
  const visit = (order, remaining, cursor, travelled) => {
    if (travelled >= bestCost) return;
    if (remaining.length === 0) {
      const total = scoreReturn ? travelled + distance(cursor, start) : travelled;
      if (total < bestCost) {
        best = order;
        bestCost = total;
      }
      return;
    }
    for (const i of remaining) {
      visit(
        [...order, i],
        remaining.filter((r) => r !== i),
        pts[i],
        travelled + distance(cursor, pts[i]),
      );
    }
  };
  visit(
    [],
    segments.map((_, i) => i),
    start,
    0,
  );
  return best.map((i) => segments[i]);
}

export function chainGroups(job, start, refine) {
  let cursor = start;
  const groups = job.groups.map((group, index) => {
    const greedy = nearestNeighbourClosed(group.segments, cursor);
    const segments = refine
      ? improveClosedTour(greedy, cursor, index === job.groups.length - 1)
      : greedy;
    cursor = segments.at(-1).polyline.at(-1);
    return { ...group, segments };
  });
  return { ...job, groups };
}

// ---------------------------------------------------------------------------
// Independent oracle: ray-casting point-in-polygon on vertex 0 plus bounds
// containment, never the production containment module.

export function assertPrecedence(segments) {
  const position = new Map(segments.map((s, i) => [s, i]));
  for (const container of segments) {
    if (!container.closed) continue;
    const box = bounds(container.polyline);
    for (const inner of segments) {
      if (inner === container) continue;
      const innerBox = bounds(inner.polyline);
      if (!boxContains(box, innerBox) || boxContains(innerBox, box)) continue;
      if (!pointInPolygon(inner.polyline[0], container.polyline)) continue;
      assert.ok(
        position.get(inner) < position.get(container),
        'Candidate route cuts a container before a contour inside it',
      );
    }
  }
}

export function pointInPolygon(p, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

// ---------------------------------------------------------------------------
// Measurement helpers

export function canonicalSegment(seg) {
  const pts = seg.polyline;
  if (seg.closed) {
    const ring = pts.slice(0, -1).map((p) => `${p.x},${p.y}`);
    const rotations = ring.map((_, i) => [...ring.slice(i), ...ring.slice(0, i)].join(';'));
    return `closed:${rotations.sort()[0]}`;
  }
  const forward = pts.map((p) => `${p.x},${p.y}`).join(';');
  const backward = [...pts]
    .reverse()
    .map((p) => `${p.x},${p.y}`)
    .join(';');
  return `open:${forward < backward ? forward : backward}`;
}

// Every emitted burn move as an undirected endpoint pair with its feed and
// power words, sorted: the same burn in another order or direction compares
// equal, a changed burn does not.
export function burnMoves(program) {
  let cursor = { x: 0, y: 0 };
  const moves = [];
  for (const line of program.split('\n')) {
    if (!/^G[01] /.test(line)) continue;
    const next = {
      x: Number(/X(-?[\d.]+)/.exec(line)?.[1] ?? cursor.x),
      y: Number(/Y(-?[\d.]+)/.exec(line)?.[1] ?? cursor.y),
    };
    if (line.startsWith('G1 ')) {
      const words = line.replace(/[XY]-?[\d.]+\s?/g, '').trim();
      const a = `${cursor.x},${cursor.y}`;
      const b = `${next.x},${next.y}`;
      moves.push(`${a < b ? `${a}|${b}` : `${b}|${a}`} ${words}`);
    }
    cursor = next;
  }
  return moves.sort();
}

export function strip(measured) {
  return Object.fromEntries(Object.entries(measured).filter(([key]) => key !== 'burnLines'));
}

export function rapidDistance(program) {
  let cursor = { x: 0, y: 0 };
  let total = 0;
  for (const line of program.split('\n')) {
    if (!/^G[01] /.test(line)) continue;
    const next = {
      x: Number(/X(-?[\d.]+)/.exec(line)?.[1] ?? cursor.x),
      y: Number(/Y(-?[\d.]+)/.exec(line)?.[1] ?? cursor.y),
    };
    if (line.startsWith('G0 ')) total += Math.hypot(next.x - cursor.x, next.y - cursor.y);
    cursor = next;
  }
  return total;
}

export function routeTravel(segments, start) {
  let cursor = start;
  let total = 0;
  for (const seg of segments) {
    total += distance(cursor, seg.polyline[0]);
    cursor = seg.polyline.at(-1);
  }
  return total;
}

// Trapezoidal rapid: below v^2/a the head never reaches full speed, so short
// hops cost far more per millimetre than long ones.
export function rapidTimeTable(vMmPerSec, aMmPerSec2) {
  const threshold = (vMmPerSec * vMmPerSec) / aMmPerSec2;
  return [1, 2, 5, 10, 20, 50, 100, 300].map((d) => {
    const seconds =
      d < threshold ? 2 * Math.sqrt(d / aMmPerSec2) : d / vMmPerSec + vMmPerSec / aMmPerSec2;
    return { hopMm: d, seconds: round(seconds), msPerMm: round((seconds * 1000) / d) };
  });
}

export function bounds(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

export function boxContains(outer, inner) {
  return (
    outer.minX <= inner.minX &&
    outer.minY <= inner.minY &&
    outer.maxX >= inner.maxX &&
    outer.maxY >= inner.maxY
  );
}

export function maxY(seg) {
  return bounds(seg.polyline).maxY;
}

export function minX(seg) {
  return bounds(seg.polyline).minX;
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function percent(current, candidate) {
  return current === 0 ? 0 : round(100 * (1 - candidate / current));
}

export function round(value) {
  return Math.round(value * 1000) / 1000;
}

export function generator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
