-- Supabase数据库初始化脚本
-- 天气感知型TSP求解系统

-- 1. 启用扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;

-- 2. 创建城市表
CREATE TABLE IF NOT EXISTS cities (
    city_id INT PRIMARY KEY,
    city_name VARCHAR(100) NOT NULL,
    latitude FLOAT NOT NULL,
    longitude FLOAT NOT NULL,
    min_visits INT DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. 创建时间窗口表
CREATE TABLE IF NOT EXISTS time_windows (
    window_id SERIAL PRIMARY KEY,
    city_id INT REFERENCES cities(city_id) ON DELETE CASCADE,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    priority INT DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. 创建气象站表
CREATE TABLE IF NOT EXISTS weather_stations (
    station_id INT PRIMARY KEY,
    station_name VARCHAR(100) NOT NULL,
    latitude FLOAT NOT NULL,
    longitude FLOAT NOT NULL,
    elevation FLOAT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 5. 创建天气观测表
CREATE TABLE IF NOT EXISTS weather_observations (
    observation_id SERIAL PRIMARY KEY,
    station_id INT REFERENCES weather_stations(station_id) ON DELETE CASCADE,
    observation_time TIMESTAMPTZ NOT NULL,
    temperature FLOAT NULL,
    precipitation FLOAT NULL,
    wind_speed FLOAT NULL,
    wind_direction FLOAT NULL,
    humidity FLOAT NULL,
    visibility FLOAT NULL,
    weather_condition VARCHAR(50) NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 6. 创建路段表
CREATE TABLE IF NOT EXISTS road_segments (
    segment_id INT PRIMARY KEY,
    start_city_id INT REFERENCES cities(city_id) ON DELETE CASCADE,
    end_city_id INT REFERENCES cities(city_id) ON DELETE CASCADE,
    distance FLOAT NOT NULL,
    road_type VARCHAR(50) NULL,
    speed_limit FLOAT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 7. 创建旅行时间表
CREATE TABLE IF NOT EXISTS travel_times (
    travel_time_id SERIAL PRIMARY KEY,
    segment_id INT REFERENCES road_segments(segment_id) ON DELETE CASCADE,
    time_slot TIMESTAMPTZ NOT NULL,
    base_time FLOAT NOT NULL,
    weather_factor FLOAT NOT NULL,
    adjusted_time FLOAT NOT NULL,
    confidence FLOAT DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 8. 创建预设测试用例表
CREATE TABLE IF NOT EXISTS test_cases (
    case_id SERIAL PRIMARY KEY,
    case_name VARCHAR(100) NOT NULL,
    case_scale VARCHAR(20) NOT NULL,
    city_ids INT[] NOT NULL,
    description TEXT NULL,
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 9. 创建路径解表
CREATE TABLE IF NOT EXISTS route_solutions (
    solution_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id INT REFERENCES test_cases(case_id),
    algorithm VARCHAR(50) NOT NULL,
    total_cost FLOAT NOT NULL,
    total_time FLOAT NOT NULL,
    reliability FLOAT NULL,
    exec_time FLOAT NOT NULL,
    route_sequence INT[] NOT NULL,
    user_id UUID DEFAULT auth.uid(),
    is_public BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 10. 创建路径节点表
CREATE TABLE IF NOT EXISTS route_nodes (
    node_id SERIAL PRIMARY KEY,
    solution_id UUID REFERENCES route_solutions(solution_id) ON DELETE CASCADE,
    city_id INT REFERENCES cities(city_id),
    visit_order INT NOT NULL,
    arrival_time TIMESTAMPTZ NOT NULL,
    departure_time TIMESTAMPTZ NOT NULL,
    weather_condition VARCHAR(50) NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 11. 创建索引
-- 空间索引
CREATE INDEX IF NOT EXISTS cities_geo_idx ON cities USING gist(ST_MakePoint(longitude, latitude));
CREATE INDEX IF NOT EXISTS weather_stations_geo_idx ON weather_stations USING gist(ST_MakePoint(longitude, latitude));

-- 时间索引
CREATE INDEX IF NOT EXISTS weather_observations_time_idx ON weather_observations USING brin(observation_time);
CREATE INDEX IF NOT EXISTS travel_times_time_idx ON travel_times USING brin(time_slot);

-- 外键索引
CREATE INDEX IF NOT EXISTS time_windows_city_idx ON time_windows(city_id);
CREATE INDEX IF NOT EXISTS weather_observations_station_idx ON weather_observations(station_id);
CREATE INDEX IF NOT EXISTS road_segments_start_idx ON road_segments(start_city_id);
CREATE INDEX IF NOT EXISTS road_segments_end_idx ON road_segments(end_city_id);
CREATE INDEX IF NOT EXISTS travel_times_segment_idx ON travel_times(segment_id);
CREATE INDEX IF NOT EXISTS route_solutions_case_idx ON route_solutions(case_id);
CREATE INDEX IF NOT EXISTS route_nodes_solution_idx ON route_nodes(solution_id);
CREATE INDEX IF NOT EXISTS route_nodes_city_idx ON route_nodes(city_id);

-- 12. 启用行级安全策略(RLS)
-- 为所有表启用RLS
ALTER TABLE cities ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE weather_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE weather_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE road_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE travel_times ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_solutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_nodes ENABLE ROW LEVEL SECURITY;

-- 13. 配置RLS策略
-- 基础数据表：所有用户可读取，仅管理员可修改
CREATE POLICY "Allow public read access to cities" ON cities
    FOR SELECT USING (true);

CREATE POLICY "Allow public read access to time_windows" ON time_windows
    FOR SELECT USING (true);

CREATE POLICY "Allow public read access to weather_stations" ON weather_stations
    FOR SELECT USING (true);

CREATE POLICY "Allow public read access to weather_observations" ON weather_observations
    FOR SELECT USING (true);

CREATE POLICY "Allow public read access to road_segments" ON road_segments
    FOR SELECT USING (true);

CREATE POLICY "Allow public read access to travel_times" ON travel_times
    FOR SELECT USING (true);

CREATE POLICY "Allow public read access to test_cases" ON test_cases
    FOR SELECT USING (true);

-- 路径解表：用户仅可创建、修改、删除自己的记录，公开记录所有人可读取
CREATE POLICY "Users can create their own solutions" ON route_solutions
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own solutions" ON route_solutions
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own solutions" ON route_solutions
    FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can read their own solutions and public solutions" ON route_solutions
    FOR SELECT USING (auth.uid() = user_id OR is_public = true);

-- 路径节点表：继承父表权限
CREATE POLICY "Users can read nodes for their own solutions and public solutions" ON route_nodes
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM route_solutions 
            WHERE route_solutions.solution_id = route_nodes.solution_id 
            AND (route_solutions.user_id = auth.uid() OR route_solutions.is_public = true)
        )
    );

CREATE POLICY "Users can insert nodes for their own solutions" ON route_nodes
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM route_solutions 
            WHERE route_solutions.solution_id = route_nodes.solution_id 
            AND route_solutions.user_id = auth.uid()
        )
    );

-- 14. 插入预设测试用例
INSERT INTO test_cases (case_name, case_scale, city_ids, description, is_default)
VALUES 
    ('小规模验证用例', 'small', '{1,2,3,4,5}', '5个城市的小规模测试用例，适用于所有算法验证', true),
    ('中规模标准用例', 'medium', '{1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20}', '20个城市的中规模测试用例，适用于A*和遗传算法', false),
    ('大规模业务用例', 'large', '{1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50}', '50个城市的大规模测试用例，推荐使用遗传算法', false),
    ('极限性能用例', 'extreme', '{1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100}', '100个城市的极限性能测试用例，仅推荐使用遗传算法', false)
ON CONFLICT DO NOTHING;

-- 15. 插入示例城市数据
INSERT INTO cities (city_id, city_name, latitude, longitude, min_visits)
VALUES
    (1, '北京', 39.9042, 116.4074, 1),
    (2, '上海', 31.2304, 121.4737, 1),
    (3, '广州', 23.1291, 113.2644, 1),
    (4, '深圳', 22.5431, 114.0579, 1),
    (5, '成都', 30.5728, 104.0668, 1),
    (6, '杭州', 30.2741, 120.1551, 1),
    (7, '武汉', 30.5928, 114.3055, 1),
    (8, '西安', 34.3416, 108.9398, 1),
    (9, '重庆', 29.4316, 106.9123, 1),
    (10, '南京', 32.0603, 118.7969, 1),
    (11, '天津', 39.0842, 117.2009, 1),
    (12, '苏州', 31.2989, 120.5853, 1),
    (13, '郑州', 34.7466, 113.6253, 1),
    (14, '长沙', 28.2278, 112.9388, 1),
    (15, '沈阳', 41.8057, 123.4315, 1),
    (16, '青岛', 36.0611, 120.3826, 1),
    (17, '宁波', 29.8683, 121.5440, 1),
    (18, '东莞', 23.0475, 113.7627, 1),
    (19, '佛山', 23.0208, 113.1224, 1),
    (20, '济南', 36.6512, 117.1201, 1)
ON CONFLICT DO NOTHING;

-- 16. 插入示例路段数据
INSERT INTO road_segments (segment_id, start_city_id, end_city_id, distance, road_type, speed_limit)
VALUES
    (1, 1, 2, 1318, '高速', 120),
    (2, 2, 3, 1433, '高速', 120),
    (3, 3, 4, 108, '高速', 100),
    (4, 4, 5, 1412, '高速', 120),
    (5, 5, 1, 1814, '高速', 120),
    (6, 1, 3, 2120, '高速', 120),
    (7, 2, 4, 1541, '高速', 120),
    (8, 3, 5, 1600, '高速', 120),
    (9, 4, 1, 2150, '高速', 120),
    (10, 5, 2, 1650, '高速', 120)
ON CONFLICT DO NOTHING;