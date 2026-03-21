import type { SolveTSPRequest, TSPSolution } from "../utils/types.ts";
import { calculateWeatherAwareTime, isTimeWindowValid, calculatePathMetrics } from "../utils/weather.ts";

export async function solveDP(request: SolveTSPRequest): Promise<TSPSolution> {
  const { cities, time_windows, weather_data, road_segments } = request;
  const n = cities.length;
  
  // Exact DP grows exponentially and may hit edge worker limits at n=20 online.
  // Keep exact mode for smaller instances; use high-quality approximation afterwards.
  if (n > 18) {
    return solveDPApprox(request);
  }

  const INF = 1e18;
  const dp: number[][] = Array(2 ** n).fill(0).map(() => Array(n).fill(INF));
  const prev: number[][] = Array(2 ** n).fill(0).map(() => Array(n).fill(-1));
  
  dp[1][0] = 0;

  for (let mask = 1; mask < 2 ** n; mask++) {
    for (let u = 0; u < n; u++) {
      if ((mask & (1 << u)) !== 0 && dp[mask][u] < INF) {
        for (let v = 0; v < n; v++) {
          if ((mask & (1 << v)) === 0) {
            const currentTime = dp[mask][u];
            const { travelTime, cost, reliability } = calculateWeatherAwareTime(
              u, v, currentTime, cities, road_segments, weather_data
            );
            const arrivalTime = currentTime + travelTime;
            
            if (isTimeWindowValid(v, arrivalTime, time_windows)) {
              const newMask = mask | (1 << v);
              if (dp[newMask][v] > dp[mask][u] + cost) {
                dp[newMask][v] = dp[mask][u] + cost;
                prev[newMask][v] = u;
              }
            }
          }
        }
      }
    }
  }

  let fullMask = (1 << n) - 1;
  let minCost = INF;
  let bestIdx = 0;
  
  for (let v = 0; v < n; v++) {
    const returnCost = calculateWeatherAwareTime(v, 0, dp[fullMask][v], cities, road_segments, weather_data).cost;
    if (dp[fullMask][v] + returnCost < minCost) {
      minCost = dp[fullMask][v] + returnCost;
      bestIdx = v;
    }
  }

  if (!Number.isFinite(minCost) || minCost >= INF / 2) {
    return solveDPApprox(request);
  }

  let bestPath: number[] = [];
  let currentMask = fullMask;
  let current = bestIdx;
  
  while (current !== -1) {
    bestPath.unshift(current);
    const next = prev[currentMask][current];
    currentMask = currentMask ^ (1 << current);
    current = next;
  }
  bestPath.push(0);

  const { totalTime, reliability, nodes } = calculatePathMetrics(
    bestPath, cities, time_windows, weather_data, road_segments
  );

  return {
    best_path: bestPath,
    total_cost: minCost,
    total_time: totalTime,
    reliability,
    exec_time: 0,
    nodes,
    process_data: { dp_table: dp }
  };
}

function solveDPApprox(request: SolveTSPRequest): TSPSolution {
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
      process_data: { dp_table: [[0]], meta: { mode: "approx_greedy", reason: "single_city" } }
    };
  }

  const cityOrder = Array.from({ length: n - 1 }, (_, i) => i + 1);
  const startBudget = n > 80 ? 3 : n > 50 ? 5 : 10;
  const twoOptRounds = n > 80 ? 1 : n > 50 ? 2 : 5;
  const startCandidates = cityOrder.slice(0, Math.min(startBudget, cityOrder.length));
  let bestPath: number[] | null = null;
  let bestCost = Number.POSITIVE_INFINITY;
  let bestDpTable: number[][] = [[0]];

  for (const first of startCandidates) {
    const candidate = buildGreedyRouteFromStart(first, n, cities, road_segments, weather_data, time_windows);
    const improved = twoOptImprove(candidate.path, cities, road_segments, weather_data, twoOptRounds);
    const score = evaluatePathCost(improved, cities, road_segments, weather_data);
    if (score < bestCost) {
      bestCost = score;
      bestPath = improved;
      bestDpTable = candidate.dpTable;
    }
  }

  if (!bestPath) {
    bestPath = [0, 0];
    bestCost = 0;
  }

  const { totalTime, reliability, nodes } = calculatePathMetrics(
    bestPath, cities, time_windows, weather_data, road_segments
  );

  return {
    best_path: bestPath,
    total_cost: bestCost,
    total_time: totalTime,
    reliability,
    exec_time: 0,
    nodes,
    process_data: {
      dp_table: bestDpTable,
      meta: {
        mode: "approx_greedy_2opt",
        reason: "n_gt_18_or_exact_no_solution",
        city_count: n,
        start_budget: startBudget,
        two_opt_rounds: twoOptRounds
      }
    }
  };
}

function buildGreedyRouteFromStart(
  first: number,
  n: number,
  cities: any[],
  road_segments: any[],
  weather_data: any[],
  time_windows: any[]
): { path: number[]; dpTable: number[][] } {
  const visited = new Set<number>([0, first]);
  const path: number[] = [0, first];
  let current = first;
  let currentTime = calculateWeatherAwareTime(0, first, 0, cities, road_segments, weather_data).travelTime;
  let totalCost = calculateWeatherAwareTime(0, first, 0, cities, road_segments, weather_data).cost;
  const dpTable: number[][] = [[0], [totalCost]];

  while (visited.size < n) {
    let bestNext = -1;
    let legBest = Number.POSITIVE_INFINITY;
    let legTravel = 0;
    for (let v = 1; v < n; v++) {
      if (visited.has(v) || v === current) continue;
      const leg = calculateWeatherAwareTime(current, v, currentTime, cities, road_segments, weather_data);
      const arrival = currentTime + leg.travelTime;
      if (!isTimeWindowValid(v, arrival, time_windows)) continue;
      if (leg.cost < legBest) {
        legBest = leg.cost;
        legTravel = leg.travelTime;
        bestNext = v;
      }
    }
    if (bestNext === -1) {
      for (let v = 1; v < n; v++) {
        if (visited.has(v) || v === current) continue;
        const leg = calculateWeatherAwareTime(current, v, currentTime, cities, road_segments, weather_data);
        if (leg.cost < legBest) {
          legBest = leg.cost;
          legTravel = leg.travelTime;
          bestNext = v;
        }
      }
    }
    if (bestNext === -1) break;
    visited.add(bestNext);
    path.push(bestNext);
    totalCost += legBest;
    currentTime += legTravel;
    current = bestNext;
    dpTable.push([totalCost]);
  }

  const back = calculateWeatherAwareTime(current, 0, currentTime, cities, road_segments, weather_data);
  totalCost += back.cost;
  path.push(0);
  dpTable.push([totalCost]);
  return { path, dpTable };
}

function evaluatePathCost(path: number[], cities: any[], road_segments: any[], weather_data: any[]): number {
  let total = 0;
  let t = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const leg = calculateWeatherAwareTime(path[i], path[i + 1], t, cities, road_segments, weather_data);
    total += leg.cost;
    t += leg.travelTime;
  }
  return total;
}

function twoOptImprove(
  path: number[],
  cities: any[],
  road_segments: any[],
  weather_data: any[],
  maxRounds = 5
): number[] {
  if (path.length <= 5) return path;
  let best = [...path];
  let improved = true;
  let bestCost = evaluatePathCost(best, cities, road_segments, weather_data);
  let rounds = 0;

  while (improved && rounds < maxRounds) {
    improved = false;
    rounds++;
    for (let i = 1; i < best.length - 3; i++) {
      for (let k = i + 1; k < best.length - 2; k++) {
        const cand = best.slice(0, i).concat(best.slice(i, k + 1).reverse(), best.slice(k + 1));
        const c = evaluatePathCost(cand, cities, road_segments, weather_data);
        if (c + 1e-9 < bestCost) {
          best = cand;
          bestCost = c;
          improved = true;
        }
      }
    }
  }
  return best;
}
