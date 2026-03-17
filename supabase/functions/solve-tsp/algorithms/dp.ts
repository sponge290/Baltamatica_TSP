import type { SolveTSPRequest, TSPSolution } from "../utils/types.ts";
import { calculateWeatherAwareTime, isTimeWindowValid, calculatePathMetrics } from "../utils/weather.ts";

export async function solveDP(request: SolveTSPRequest): Promise<TSPSolution> {
  const { cities, time_windows, weather_data, road_segments } = request;
  const n = cities.length;
  
  if (n > 15) {
    throw new Error("动态规划仅支持15个城市以内的小规模问题");
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
