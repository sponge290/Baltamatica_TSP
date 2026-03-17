export interface City {
  city_id: number;
  city_name: string;
  latitude: number;
  longitude: number;
  min_visits: number;
}

export interface TimeWindow {
  window_id: number;
  city_id: number;
  start_time: string;
  end_time: string;
  priority: number;
}

export interface WeatherObservation {
  observation_id: number;
  station_id: number;
  observation_time: string;
  temperature: number;
  precipitation: number;
  wind_speed: number;
  visibility: number;
  weather_condition: string;
}

export interface RoadSegment {
  segment_id: number;
  start_city_id: number;
  end_city_id: number;
  distance: number;
  road_type: string;
  speed_limit: number;
}

export interface TSPSolution {
  best_path: number[];
  total_cost: number;
  total_time: number;
  reliability: number;
  exec_time: number;
  nodes: RouteNode[];
  process_data?: any;
}

export interface RouteNode {
  city_id: number;
  visit_order: number;
  arrival_time: string;
  departure_time: string;
  weather_condition: string;
}

export interface SolveTSPRequest {
  case_id: number;
  algorithm: 'DP' | 'A*' | 'GA';
  cities: City[];
  time_windows: TimeWindow[];
  weather_data: WeatherObservation[];
  road_segments: RoadSegment[];
  params?: {
    pop_size?: number;
    max_generations?: number;
    mutation_rate?: number;
    crossover_rate?: number;
  };
}
