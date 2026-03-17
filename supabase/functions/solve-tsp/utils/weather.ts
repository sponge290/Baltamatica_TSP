import type { City, WeatherObservation, RoadSegment, RouteNode } from "./types.ts";

export function calculateWeatherAwareTime(
  uIdx: number,
  vIdx: number,
  currentTime: number,
  cities: City[],
  roadSegments: RoadSegment[],
  weatherData: WeatherObservation[]
): { travelTime: number; cost: number; reliability: number } {
  const u = cities[uIdx];
  const v = cities[vIdx];
  
  let segment = roadSegments.find(
    s => s.start_city_id === u.city_id && s.end_city_id === v.city_id
  );
  
  let distance: number;
  let speedLimit: number;
  
  if (!segment) {
    const lat1 = u.latitude * Math.PI / 180;
    const lon1 = u.longitude * Math.PI / 180;
    const lat2 = v.latitude * Math.PI / 180;
    const lon2 = v.longitude * Math.PI / 180;
    const dLat = lat2 - lat1;
    const dLon = lon2 - lon1;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1) * Math.cos(lat2) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    distance = 6371 * c;
    speedLimit = 100;
  } else {
    distance = segment.distance;
    speedLimit = segment.speed_limit;
  }
  
  const baseTime = distance / speedLimit * 60;
  
  let weatherFactor = 1.0;
  if (weatherData && weatherData.length > 0) {
    for (const w of weatherData) {
      if (w.city_id === u.city_id || w.city_id === v.city_id) {
        if (w.weather_condition === 'rain') {
          weatherFactor *= 0.85;
        } else if (w.weather_condition === 'snow') {
          weatherFactor *= 0.7;
        } else if (w.weather_condition === 'fog') {
          weatherFactor *= 0.9;
        }
      }
    }
  }
  
  const travelTime = baseTime / weatherFactor;
  const cost = travelTime;
  const reliability = weatherFactor;
  
  return { travelTime, cost, reliability };
}

export function isTimeWindowValid(
  cityIdx: number,
  arrivalTime: number,
  timeWindows: any[]
): boolean {
  if (!timeWindows || timeWindows.length === 0) {
    return true;
  }
  
  const cityId = cityIdx + 1;
  for (const tw of timeWindows) {
    if (tw.city_id === cityId) {
      if (arrivalTime >= tw.start_time && arrivalTime <= tw.end_time) {
        return true;
      }
    }
  }
  
  return false;
}

export function calculatePathMetrics(
  bestPath: number[],
  cities: City[],
  timeWindows: any[],
  weatherData: WeatherObservation[],
  roadSegments: RoadSegment[]
): { totalTime: number; reliability: number; nodes: RouteNode[] } {
  let totalTime = 0;
  let totalReliability = 0;
  const nodes: RouteNode[] = [];
  
  let currentTime = 0;
  for (let i = 0; i < bestPath.length - 1; i++) {
    const uIdx = bestPath[i];
    const vIdx = bestPath[i + 1];
    
    const { travelTime, cost, reliability } = calculateWeatherAwareTime(
      uIdx, vIdx, currentTime, cities, roadSegments, weatherData
    );
    
    const arrivalTime = currentTime + travelTime;
    
    const node: RouteNode = {
      city_id: cities[vIdx].city_id,
      visit_order: i + 1,
      arrival_time: arrivalTime.toString(),
      departure_time: (arrivalTime + 30).toString(),
      weather_condition: 'sunny'
    };
    nodes.push(node);
    
    totalTime += travelTime;
    totalReliability += reliability;
    currentTime = arrivalTime + 30;
  }
  
  const reliability = totalReliability / (bestPath.length - 1);
  
  return { totalTime, reliability, nodes };
}
