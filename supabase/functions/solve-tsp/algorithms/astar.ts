import type { SolveTSPRequest, TSPSolution } from "../utils/types.ts";
import { calculateWeatherAwareTime, calculatePathMetrics } from "../utils/weather.ts";
import { solveDP } from "./dp.ts";

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

type CompletionResult = { path: number[]; cost: number } | null;

function popMinByF(open: AStarState[]): AStarState | null {
  if (open.length === 0) return null;
  let minIdx = 0;
  let minF = open[0].f;
  for (let i = 1; i < open.length; i++) {
    if (open[i].f < minF) {
      minF = open[i].f;
      minIdx = i;
    }
  }
  const picked = open[minIdx];
  const last = open.pop()!;
  if (minIdx < open.length) open[minIdx] = last;
  return picked;
}

function topKByF(open: AStarState[], k: number): AStarState[] {
  if (open.length <= k) return [...open].sort((a, b) => a.f - b.f);
  return [...open].sort((a, b) => a.f - b.f).slice(0, k);
}

function completeGreedyFromState(
  state: AStarState,
  cities: any[],
  road_segments: any[],
  weather_data: any[],
  h: (city: number, remaining: number) => number
): CompletionResult {
  const n = cities.length;
  const visited = new Set<number>(state.path);
  const path = [...state.path];
  let current = state.city;
  let g = state.g;

  while (visited.size < n) {
    let bestNext = -1;
    let bestF = Number.POSITIVE_INFINITY;
    let bestLeg = Number.POSITIVE_INFINITY;
    for (let next = 0; next < n; next++) {
      if (visited.has(next) || next === current) continue;
      const leg = calculateWeatherAwareTime(current, next, g, cities, road_segments, weather_data).cost;
      const remaining = n - (visited.size + 1);
      const f = g + leg + h(next, remaining);
      if (f < bestF) {
        bestF = f;
        bestLeg = leg;
        bestNext = next;
      }
    }
    if (bestNext < 0 || !Number.isFinite(bestLeg)) return null;
    g += bestLeg;
    current = bestNext;
    visited.add(bestNext);
    path.push(bestNext);
  }

  const back = calculateWeatherAwareTime(current, 0, g, cities, road_segments, weather_data).cost;
  if (!Number.isFinite(back)) return null;
  return { path: [...path, 0], cost: g + back };
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
  try {
    const { cities, time_windows, weather_data, road_segments } = request;
    const n = cities.length;
    if (n <= 1) {
      return {
        best_path: [0, 0],
        total_cost: 0,
        total_time: 0,
        reliability: 1,
        exec_time: 0,
        nodes: [],
        process_data: { search_process: [], meta: { mode: "trivial_single_city" } },
      };
    }

    // For larger cases, use deterministic fallback immediately to avoid runtime spikes.
    if (n > 50) {
      return greedyAStarFallback(request);
    }

    const fullMask = (1n << BigInt(n)) - 1n;
    const h = buildHeuristic(cities, road_segments);

    // Keep A* best-first core, but reduce sort overhead for stability on n≈20~50.
    // Edge runtime has strict worker limits; keep A* phase short and deterministic,
    // then rely on fallback completion to guarantee response.
    const MAX_EXPANSIONS = n <= 20 ? 160_000 : 70_000;
    const BEAM_WIDTH = n <= 20 ? 12_000 : 4_000;
    const TIME_BUDGET_MS = n <= 20 ? 1800 : 1200;
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
    let bestFrontierState: AStarState | null = null;
    const startedAt = Date.now();
    let stopReason: "completed" | "time_budget" | "expansion_budget" | "open_exhausted" = "open_exhausted";

    while (open.length > 0) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        stopReason = "time_budget";
        break;
      }
      const current = popMinByF(open);
      if (!current) break;
      const k = keyOf(current.visitedMask, current.city);
      if (closed.has(k)) continue;
      closed.add(k);

      expansions++;

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
          open_top: topKByF(open, TOPK).map((s) => ({
            city: s.city,
            visitedCount: s.visitedCount,
            g: s.g,
            f: s.f
          })),
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
        stopReason = "completed";

        continue;
      }

      if (!bestFrontierState || current.f < bestFrontierState.f) {
        bestFrontierState = current;
      }

      if (expansions >= MAX_EXPANSIONS) {
        stopReason = "expansion_budget";
        break;
      }

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

      if (open.length > BEAM_WIDTH) {
        open.sort((a, b) => a.f - b.f);
        open.length = BEAM_WIDTH;
      }
    }

    if (!bestComplete && bestFrontierState) {
      const completed = completeGreedyFromState(bestFrontierState, cities, road_segments, weather_data, h);
      if (completed) bestComplete = completed;
    }

    if (!bestComplete) {
      if (n <= 20) {
        try {
          const dpSol = await solveDP(request);
          return {
            ...dpSol,
            process_data: {
              ...(dpSol.process_data ?? {}),
              meta: {
                ...(dpSol.process_data?.meta ?? {}),
                mode: "astar_fallback_to_dp",
                reason: stopReason,
              },
            },
          };
        } catch {
          // If DP fallback unexpectedly fails, continue to greedy fallback.
        }
      }
      return greedyAStarFallback(request);
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
      process_data: {
        search_process: process,
        meta: {
          mode: "astar",
          expansions,
          beam_width: BEAM_WIDTH,
          max_expansions: MAX_EXPANSIONS,
          time_budget_ms: TIME_BUDGET_MS,
          stop_reason: stopReason,
        }
      },
    };
  } catch {
    // Never fail hard for A*: keep service resilient and return a deterministic route.
    return greedyAStarFallback(request);
  }
}

function greedyAStarFallback(request: SolveTSPRequest): TSPSolution {
  const { cities, time_windows, weather_data, road_segments } = request;
  const n = cities.length;
  const h = buildHeuristic(cities, road_segments);
  const visited = new Set<number>([0]);
  const path: number[] = [0];
  const process: SearchFrame[] = [];
  let current = 0;
  let g = 0;
  let iter = 0;

  while (visited.size < n) {
    iter++;
    let bestNext = -1;
    let bestLeg = Number.POSITIVE_INFINITY;
    let bestF = Number.POSITIVE_INFINITY;

    for (let next = 0; next < n; next++) {
      if (visited.has(next) || next === current) continue;
      const leg = calculateWeatherAwareTime(current, next, g, cities, road_segments, weather_data).cost;
      const remaining = n - (visited.size + 1);
      const f = g + leg + h(next, remaining);
      if (f < bestF) {
        bestF = f;
        bestLeg = leg;
        bestNext = next;
      }
    }

    if (bestNext === -1) break;

    g += bestLeg;
    visited.add(bestNext);
    current = bestNext;
    path.push(bestNext);

    process.push({
      iter,
      expanded: {
        city: current,
        visitedCount: visited.size,
        g,
        h: h(current, n - visited.size),
        f: g + h(current, n - visited.size),
        path: [...path],
      },
      open_top: [],
      open_size: Math.max(0, n - visited.size),
      closed_size: visited.size,
    });
  }

  const ret = calculateWeatherAwareTime(current, 0, g, cities, road_segments, weather_data).cost;
  const totalCost = g + ret;
  path.push(0);

  const { totalTime, reliability, nodes } = calculatePathMetrics(
    path, cities, time_windows, weather_data, road_segments
  );

  return {
    best_path: path,
    total_cost: totalCost,
    total_time: totalTime,
    reliability,
    exec_time: 0,
    nodes,
    process_data: {
      search_process: process,
      meta: { mode: "fallback_greedy_astar", reason: "search_limit_or_large_scale", city_count: n },
    },
  };
}
