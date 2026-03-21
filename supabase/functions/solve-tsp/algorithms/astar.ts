import type { SolveTSPRequest, TSPSolution } from "../utils/types.ts";
import { calculateWeatherAwareTime, calculatePathMetrics } from "../utils/weather.ts";

type SearchFrame = {
  iter: number;
  expanded: {
    city: number;
    visitedCount: number;
    g: number;
    h: number;
    f: number;
    path: number[];
  };
  open_top: Array<{ city: number; visitedCount: number; g: number; f: number }>;
  open_size: number;
  closed_size: number;
};

type StateKey = string;

interface AStarState {
  city: number;
  visitedMask: bigint;
  visitedCount: number;
  g: number;
  f: number;
  path: number[];
}

function keyOf(mask: bigint, city: number): StateKey {
  return `${mask.toString(16)}|${city}`;
}

function bit(mask: bigint, i: number): bigint {
  return 1n << BigInt(i);
}

function optimisticLegCostMinutes(uIdx: number, vIdx: number, cities: any[], roadSegments: any[]): number {
  // Lower-bound: ignore adverse weather (assume factor=1.0), use provided road segment if exists,
  // otherwise haversine with optimistic speed.
  const u = cities[uIdx];
  const v = cities[vIdx];
  const seg = roadSegments?.find?.((s: any) => s.start_city_id === u.city_id && s.end_city_id === v.city_id);
  const distance = seg?.distance ?? haversineKm(u.latitude, u.longitude, v.latitude, v.longitude);
  const speed = Math.max(80, seg?.speed_limit ?? 120); // optimistic
  return (distance / speed) * 60;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildHeuristic(cities: any[], roadSegments: any[]) {
  const n = cities.length;
  const minToAny: number[] = Array(n).fill(Infinity);
  let globalMin = Infinity;

  for (let u = 0; u < n; u++) {
    for (let v = 0; v < n; v++) {
      if (u === v) continue;
      const c = optimisticLegCostMinutes(u, v, cities, roadSegments);
      if (c < minToAny[u]) minToAny[u] = c;
      if (c < globalMin) globalMin = c;
    }
  }

  if (!Number.isFinite(globalMin)) globalMin = 0;

  // Admissible (very weak) lower bound:
  // remaining steps * globalMin plus a minimal outgoing edge from current.
  return (city: number, remaining: number) => {
    const out = Number.isFinite(minToAny[city]) ? minToAny[city] : 0;
    return out + Math.max(0, remaining - 1) * globalMin;
  };
}

export async function solveAStar(request: SolveTSPRequest): Promise<TSPSolution> {
  const { cities, time_windows, weather_data, road_segments } = request;
  const n = cities.length;
  
  if (n > 30) {
    throw new Error("A*算法推荐使用30个城市以内的中等规模问题");
  }

  const fullMask = (1n << BigInt(n)) - 1n;
  const h = buildHeuristic(cities, road_segments);

  // To keep runtime bounded for n≈20-30, we use a best-first search with pruning limits.
  const MAX_EXPANSIONS = n <= 15 ? 200_000 : 300_000;
  const BEAM_WIDTH = n <= 15 ? 50_000 : 15_000;
  const TOPK = 80;

  const open: AStarState[] = [];
  const closed = new Set<StateKey>();
  const gScore = new Map<StateKey, number>();
  const process: SearchFrame[] = [];

  const startMask = bit(0n, 0);
  const startKey = keyOf(startMask, 0);
  const start: AStarState = {
    city: 0,
    visitedMask: startMask,
    visitedCount: 1,
    g: 0,
    f: h(0, n),
    path: [0],
  };
  open.push(start);
  gScore.set(startKey, 0);

  let expansions = 0;
  let bestComplete: { path: number[]; cost: number } | null = null;

  while (open.length > 0) {
    open.sort((a, b) => a.f - b.f);
    const current = open.shift()!;
    const k = keyOf(current.visitedMask, current.city);
    if (closed.has(k)) continue;
    closed.add(k);

    expansions++;

    // record a frame (throttle to keep payload reasonable)
    if (expansions <= 2000 || expansions % 50 === 0) {
      const remaining = n - current.visitedCount;
      const hh = h(current.city, remaining);
      process.push({
        iter: expansions,
        expanded: {
          city: current.city,
          visitedCount: current.visitedCount,
          g: current.g,
          h: hh,
          f: current.g + hh,
          path: current.path,
        },
        open_top: open.slice(0, TOPK).map(s => ({ city: s.city, visitedCount: s.visitedCount, g: s.g, f: s.f })),
        open_size: open.length,
        closed_size: closed.size,
      });
    }

    if (current.visitedMask === fullMask) {
      const returnCost = calculateWeatherAwareTime(
        current.city, 0, current.g, cities, road_segments, weather_data
      ).cost;
      const totalCost = current.g + returnCost;
      const bestPath = [...current.path, 0];

      if (!bestComplete || totalCost < bestComplete.cost) {
        bestComplete = { path: bestPath, cost: totalCost };
      }

      // Keep searching a bit for better, but we can early stop when open is already worse.
      if (open.length === 0 || open[0].f >= totalCost) {
        break;
      }
      continue;
    }

    if (expansions >= MAX_EXPANSIONS) break;

    // Expand neighbors
    for (let next = 0; next < n; next++) {
      if (next === current.city) continue;
      if ((current.visitedMask & bit(0n, next)) !== 0n) continue;

      const leg = calculateWeatherAwareTime(
        current.city, next, current.g, cities, road_segments, weather_data
      ).cost;
      const g2 = current.g + leg;

      const mask2 = current.visitedMask | bit(0n, next);
      const key2 = keyOf(mask2, next);

      const prevG = gScore.get(key2);
      if (prevG != null && g2 >= prevG) continue;
      gScore.set(key2, g2);

      const remaining = n - (current.visitedCount + 1);
      const h2 = h(next, remaining);
      const f2 = g2 + h2;

      // If we already found a complete solution, prune states that can't beat it (optimistically).
      if (bestComplete && f2 >= bestComplete.cost) continue;

      open.push({
        city: next,
        visitedMask: mask2,
        visitedCount: current.visitedCount + 1,
        g: g2,
        f: f2,
        path: [...current.path, next],
      });
    }

    // Beam width pruning: keep only best f states.
    if (open.length > BEAM_WIDTH) {
      open.sort((a, b) => a.f - b.f);
      open.length = BEAM_WIDTH;
    }
  }

  if (!bestComplete) {
    throw new Error("A*算法未找到可行解（已达到搜索上限）");
  }

  const bestPath = bestComplete.path;
  const { totalTime, reliability, nodes } = calculatePathMetrics(
    bestPath, cities, time_windows, weather_data, road_segments
  );

  return {
    best_path: bestPath,
    total_cost: bestComplete.cost,
    total_time: totalTime,
    reliability,
    exec_time: 0,
    nodes,
    process_data: { search_process: process, meta: { expansions, beam_width: BEAM_WIDTH, max_expansions: MAX_EXPANSIONS } },
  };
}
