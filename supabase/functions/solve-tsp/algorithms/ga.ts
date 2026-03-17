import type { SolveTSPRequest, TSPSolution } from "../utils/types.ts";
import { calculateWeatherAwareTime, calculatePathMetrics, isTimeWindowValid } from "../utils/weather.ts";

function calculatePathCost(
  path: number[],
  cities: any[],
  roadSegments: any[],
  weatherData: any[],
  timeWindows: any[]
): number {
  let cost = 0;
  let currentTime = 0;
  
  for (let i = 0; i < path.length - 1; i++) {
    const u = path[i];
    const v = path[i + 1];
    
    const { travelTime, c } = calculateWeatherAwareTime(
      u, v, currentTime, cities, roadSegments, weatherData
    );
    
    const arrivalTime = currentTime + travelTime;
    
    if (!isTimeWindowValid(v, arrivalTime, timeWindows)) {
      cost += 10000;
    }
    
    cost += c;
    currentTime = arrivalTime + 30;
  }
  
  return cost;
}

function rouletteWheelSelection(fitness: number[]): number {
  const totalFitness = fitness.reduce((sum, f) => sum + 1 / f, 0);
  const r = Math.random() * totalFitness;
  let cumulative = 0;
  
  for (let i = 0; i < fitness.length; i++) {
    cumulative += 1 / fitness[i];
    if (cumulative >= r) {
      return i;
    }
  }
  
  return fitness.length - 1;
}

function crossover(parent1: number[], parent2: number[]): [number[], number[]] {
  const n = parent1.length;
  const point1 = Math.floor(Math.random() * (n - 1));
  const point2 = point1 + Math.floor(Math.random() * (n - point1));
  
  const child1 = Array(n).fill(-1);
  const child2 = Array(n).fill(-1);
  
  for (let i = point1; i <= point2; i++) {
    child1[i] = parent1[i];
    child2[i] = parent2[i];
  }
  
  let idx1 = 0;
  let idx2 = 0;
  
  for (let i = 0; i < n; i++) {
    if (!child1.includes(parent2[i])) {
      while (child1[idx1] !== -1) idx1++;
      child1[idx1] = parent2[i];
    }
    
    if (!child2.includes(parent1[i])) {
      while (child2[idx2] !== -1) idx2++;
      child2[idx2] = parent1[i];
    }
  }
  
  return [child1, child2];
}

function mutate(individual: number[]): number[] {
  const n = individual.length;
  const pos1 = Math.floor(Math.random() * n);
  let pos2 = Math.floor(Math.random() * n);
  while (pos2 === pos1) {
    pos2 = Math.floor(Math.random() * n);
  }
  
  const mutated = [...individual];
  [mutated[pos1], mutated[pos2]] = [mutated[pos2], mutated[pos1]];
  return mutated;
}

export async function solveGA(request: SolveTSPRequest): Promise<TSPSolution> {
  const { cities, time_windows, weather_data, road_segments, params } = request;
  const n = cities.length;
  
  const popSize = params?.pop_size || 50;
  const maxGen = params?.max_generations || 100;
  const mutationRate = params?.mutation_rate || 0.1;
  const crossoverRate = params?.crossover_rate || 0.8;
  
  let population: number[][] = [];
  for (let i = 0; i < popSize; i++) {
    const individual = Array.from({ length: n }, (_, i) => i);
    for (let j = n - 1; j > 0; j--) {
      const k = Math.floor(Math.random() * (j + 1));
      [individual[j], individual[k]] = [individual[k], individual[j]];
    }
    population.push(individual);
  }
  
  let bestFitness = Infinity;
  let bestIndividual: number[] = [];
  const iterationProcess: [number, number, number][] = [];
  
  for (let gen = 0; gen < maxGen; gen++) {
    const fitness: number[] = [];
    for (let i = 0; i < popSize; i++) {
      const path = [...population[i], population[i][0]];
      fitness[i] = calculatePathCost(path, cities, road_segments, weather_data, time_windows);
    }
    
    const minFit = Math.min(...fitness);
    const minIdx = fitness.indexOf(minFit);
    if (minFit < bestFitness) {
      bestFitness = minFit;
      bestIndividual = [...population[minIdx]];
    }
    
    const meanFit = fitness.reduce((a, b) => a + b, 0) / fitness.length;
    iterationProcess.push([gen + 1, bestFitness, meanFit]);
    
    const newPopulation: number[][] = [];
    for (let i = 0; i < popSize; i++) {
      const selected = rouletteWheelSelection(fitness);
      newPopulation.push([...population[selected]]);
    }
    
    for (let i = 0; i < popSize; i += 2) {
      if (Math.random() < crossoverRate && i + 1 < popSize) {
        const [child1, child2] = crossover(newPopulation[i], newPopulation[i + 1]);
        newPopulation[i] = child1;
        newPopulation[i + 1] = child2;
      }
    }
    
    for (let i = 0; i < popSize; i++) {
      if (Math.random() < mutationRate) {
        newPopulation[i] = mutate(newPopulation[i]);
      }
    }
    
    population = newPopulation;
  }
  
  const bestPath = [...bestIndividual, bestIndividual[0]];
  const { totalTime, reliability, nodes } = calculatePathMetrics(
    bestPath, cities, time_windows, weather_data, road_segments
  );
  
  return {
    best_path: bestPath,
    total_cost: bestFitness,
    total_time: totalTime,
    reliability,
    exec_time: 0,
    nodes,
    process_data: { iteration_process: iterationProcess }
  };
}
