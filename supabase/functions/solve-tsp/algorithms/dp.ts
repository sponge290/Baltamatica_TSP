import type { SolveTSPRequest, TSPSolution } from "../utils/types.ts";
import { calculateWeatherAwareTime, isTimeWindowValid, calculatePathMetrics } from "../utils/weather.ts";

export async function solveDP(request: SolveTSPRequest): Promise<TSPSolution> {
  const { cities, time_windows, weather_data, road_segments } = request;
  const n = cities.length;
  
  if (n > 15) {
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

async function solveDPApprox(request: SolveTSPRequest): Promise<TSPSolution> {
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

  const visited = new Set<number>([0]);
  const path: number[] = [0];
  let current = 0;
  let currentTime = 0;
  let totalCost = 0;

  // Keep a compact numeric table so frontend DP process chart can still animate.
  // Row index behaves like pseudo-state id; first column stores best-so-far cost.
  const dpTable: number[][] = [[0]];

  while (visited.size < n) {
    let bestNext = -1;
    let bestCost = Number.POSITIVE_INFINITY;
    let bestTravel = 0;

    for (let v = 0; v < n; v++) {
      if (visited.has(v) || v === current) continue;
      const leg = calculateWeatherAwareTime(current, v, currentTime, cities, road_segments, weather_data);
      if (!isTimeWindowValid(v, currentTime + leg.travelTime, time_windows)) continue;
      if (leg.cost < bestCost) {
        bestCost = leg.cost;
        bestNext = v;
        bestTravel = leg.travelTime;
      }
    }

    if (bestNext === -1) {
      // If time windows block everything, ignore time-window filter for robustness.
      for (let v = 0; v < n; v++) {
        if (visited.has(v) || v === current) continue;
        const leg = calculateWeatherAwareTime(current, v, currentTime, cities, road_segments, weather_data);
        if (leg.cost < bestCost) {
          bestCost = leg.cost;
          bestNext = v;
          bestTravel = leg.travelTime;
        }
      }
    }

    if (bestNext === -1) break;

    visited.add(bestNext);
    path.push(bestNext);
    totalCost += bestCost;
    currentTime += bestTravel;
    current = bestNext;
    dpTable.push([totalCost]);
  }

  const back = calculateWeatherAwareTime(current, 0, currentTime, cities, road_segments, weather_data);
  totalCost += back.cost;
  path.push(0);
  dpTable.push([totalCost]);

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
      dp_table: dpTable,
      meta: { mode: "approx_greedy", reason: "n_gt_15_or_exact_no_solution", city_count: n }
    }
  };
}
