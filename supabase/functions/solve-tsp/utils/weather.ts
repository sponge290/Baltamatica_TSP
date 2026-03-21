import type { City, WeatherObservation, RoadSegment, RouteNode } from "./types.ts";

const roadIndexCache = new WeakMap<RoadSegment[], Map<string, RoadSegment>>();
const weatherIndexCache = new WeakMap<WeatherObservation[], Map<number, WeatherObservation>>();

function roadKey(a: number, b: number): string {
  return `${a}|${b}`;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (x: number) => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const aa = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * (2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa)));
}

function getRoadIndex(roadSegments: RoadSegment[]): Map<string, RoadSegment> {
  const cached = roadIndexCache.get(roadSegments);
  if (cached) return cached;

  const idx = new Map<string, RoadSegment>();
  for (const seg of roadSegments || []) {
    idx.set(roadKey(seg.start_city_id, seg.end_city_id), seg);
  }
  roadIndexCache.set(roadSegments, idx);
  return idx;
}

function getWeatherIndex(weatherData: WeatherObservation[]): Map<number, WeatherObservation> {
  const cached = weatherIndexCache.get(weatherData);
  if (cached) return cached;

  const idx = new Map<number, WeatherObservation>();
  for (const obs of weatherData || []) {
    const cityId = Number(obs.city_id ?? obs.station_id);
    if (!Number.isFinite(cityId)) continue;
    const prev = idx.get(cityId);
    if (!prev) {
      idx.set(cityId, obs);
      continue;
    }
    const prevTs = Date.parse(prev.observation_time || "");
    const curTs = Date.parse(obs.observation_time || "");
    if (Number.isFinite(curTs) && (!Number.isFinite(prevTs) || curTs >= prevTs)) {
      idx.set(cityId, obs);
    }
  }
  weatherIndexCache.set(weatherData, idx);
  return idx;
}

function weatherConditionFactor(condition: string | undefined): number {
  const c = String(condition || "").toLowerCase();
  if (c === "snow") return 0.7;
  if (c === "rain") return 0.85;
  if (c === "fog") return 0.9;
  return 1.0;
}

function observationFactor(obs?: WeatherObservation): number {
  if (!obs) return 1.0;
  const byCondition = weatherConditionFactor(obs.weather_condition);
  // Soft penalties keep reliability stable while still using all weather dimensions.
  const byWind = 1 - Math.min(0.2, Math.max(0, Number(obs.wind_speed || 0)) / 100);
  const byVisibility = Number.isFinite(Number(obs.visibility))
    ? Math.max(0.8, Math.min(1.0, Number(obs.visibility) / 12))
    : 1.0;
  const byPrecip = 1 - Math.min(0.15, Math.max(0, Number(obs.precipitation || 0)) / 20);
  return Math.max(0.55, byCondition * byWind * byVisibility * byPrecip);
}

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

  const roadIndex = getRoadIndex(roadSegments || []);
  const direct = roadIndex.get(roadKey(u.city_id, v.city_id));
  const reverse = roadIndex.get(roadKey(v.city_id, u.city_id));
  const segment = direct || reverse;

  let distance: number;
  let speedLimit: number;

  if (!segment) {
    distance = haversineKm(u.latitude, u.longitude, v.latitude, v.longitude);
    speedLimit = 100;
  } else {
    distance = segment.distance;
    speedLimit = segment.speed_limit;
  }
  
  const baseTime = distance / speedLimit * 60;
  
  const weatherIdx = getWeatherIndex(weatherData || []);
  const wu = weatherIdx.get(u.city_id);
  const wv = weatherIdx.get(v.city_id);
  // Use both endpoints (mean) to avoid over-penalizing by repeated multiplications.
  const weatherFactor = (observationFactor(wu) + observationFactor(wv)) / 2;

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
