-- 天气感知型TSP求解系统数据库初始化脚本
-- 适配PostgreSQL 15+

-- 启用扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- 1. 城市表
CREATE TABLE IF NOT EXISTS cities (
    city_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    population INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. 时间窗口表
CREATE TABLE IF NOT EXISTS time_windows (
    window_id SERIAL PRIMARY KEY,
    city_id INTEGER REFERENCES cities(city_id),
    start_time INTEGER NOT NULL,  -- 分钟
    end_time INTEGER NOT NULL,    -- 分钟
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. 气象站表
CREATE TABLE IF NOT EXISTS weather_stations (
    station_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    city_id INTEGER REFERENCES cities(city_id),
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    elevation INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. 天气观测表
CREATE TABLE IF NOT EXISTS weather_observations (
    observation_id SERIAL PRIMARY KEY,
    station_id INTEGER REFERENCES weather_stations(station_id),
    city_id INTEGER REFERENCES cities(city_id),
    observation_time TIMESTAMP NOT NULL,
    temperature DOUBLE PRECISION,  -- 摄氏度
    humidity INTEGER,              -- 百分比
    wind_speed DOUBLE PRECISION,   -- 米/秒
    condition VARCHAR(50),         -- 天气状况：sunny, rain, snow, fog
    visibility DOUBLE PRECISION,   -- 公里
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. 路段表
CREATE TABLE IF NOT EXISTS road_segments (
    segment_id SERIAL PRIMARY KEY,
    start_city_id INTEGER REFERENCES cities(city_id),
    end_city_id INTEGER REFERENCES cities(city_id),
    distance DOUBLE PRECISION NOT NULL,  -- 公里
    speed_limit INTEGER NOT NULL,        -- 公里/小时
    road_type VARCHAR(50),               -- 道路类型：highway, expressway, local
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. 旅行时间表
CREATE TABLE IF NOT EXISTS travel_times (
    travel_id SERIAL PRIMARY KEY,
    segment_id INTEGER REFERENCES road_segments(segment_id),
    time_of_day INTEGER NOT NULL,  -- 0-23小时
    weather_condition VARCHAR(50),  -- 天气状况
    travel_time DOUBLE PRECISION NOT NULL,  -- 分钟
    reliability DOUBLE PRECISION,  -- 可靠性 0-1
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 7. 预设测试用例表
CREATE TABLE IF NOT EXISTS test_cases (
    case_id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    city_count INTEGER NOT NULL,
    has_time_windows BOOLEAN DEFAULT FALSE,
    has_weather_data BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 8. 路径解表
CREATE TABLE IF NOT EXISTS route_solutions (
    solution_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id VARCHAR(50) REFERENCES test_cases(case_id),
    algorithm VARCHAR(50) NOT NULL,  -- DP, A*, GA
    total_cost DOUBLE PRECISION NOT NULL,
    total_time DOUBLE PRECISION NOT NULL,  -- 分钟
    reliability DOUBLE PRECISION,
    exec_time DOUBLE PRECISION NOT NULL,  -- 毫秒
    route_sequence JSONB NOT NULL,  -- 路径序列
    is_public BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 9. 路径节点表
CREATE TABLE IF NOT EXISTS route_nodes (
    node_id SERIAL PRIMARY KEY,
    solution_id UUID REFERENCES route_solutions(solution_id),
    city_id INTEGER REFERENCES cities(city_id),
    visit_order INTEGER NOT NULL,
    arrival_time DOUBLE PRECISION NOT NULL,  -- 分钟
    departure_time DOUBLE PRECISION NOT NULL,  -- 分钟
    weather_condition VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_cities_location ON cities USING gist (ST_MakePoint(longitude, latitude));
CREATE INDEX IF NOT EXISTS idx_weather_observations_time ON weather_observations USING brin (observation_time);
CREATE INDEX IF NOT EXISTS idx_route_solutions_case ON route_solutions(case_id);
CREATE INDEX IF NOT EXISTS idx_route_nodes_solution ON route_nodes(solution_id);

-- 启用行级安全策略
ALTER TABLE route_solutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_nodes ENABLE ROW LEVEL SECURITY;

-- 创建行级安全策略
CREATE POLICY "Users can view their own solutions" ON route_solutions
    FOR SELECT USING (is_public = true);

CREATE POLICY "Users can insert their own solutions" ON route_solutions
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can update their own solutions" ON route_solutions
    FOR UPDATE USING (true);

CREATE POLICY "Users can delete their own solutions" ON route_solutions
    FOR DELETE USING (true);

CREATE POLICY "Users can view nodes of public solutions" ON route_nodes
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM route_solutions 
            WHERE route_solutions.solution_id = route_nodes.solution_id 
            AND route_solutions.is_public = true
        )
    );

-- 插入示例数据
INSERT INTO cities (name, latitude, longitude, population) VALUES
('北京', 39.9042, 116.4074, 21540000),
('上海', 31.2304, 121.4737, 24240000),
('广州', 23.1291, 113.2644, 15300000),
('深圳', 22.5431, 114.0579, 13030000),
('成都', 30.5728, 104.0668, 16330000)
ON CONFLICT DO NOTHING;

INSERT INTO road_segments (start_city_id, end_city_id, distance, speed_limit, road_type) VALUES
(1, 2, 1318, 120, 'highway'),
(2, 3, 1433, 120, 'highway'),
(3, 4, 108, 100, 'expressway'),
(4, 5, 1412, 120, 'highway'),
(5, 1, 1814, 120, 'highway')
ON CONFLICT DO NOTHING;

INSERT INTO test_cases (case_id, name, description, city_count, has_time_windows, has_weather_data) VALUES
('case_001', '5城市基础测试', '5个主要城市的基础TSP测试', 5, false, false),
('case_002', '5城市天气测试', '包含天气影响的5城市测试', 5, false, true),
('case_003', '5城市时间窗口测试', '包含时间窗口约束的5城市测试', 5, true, false)
ON CONFLICT DO NOTHING;

-- 创建数据库用户
DO
$$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'tsp_user') THEN
        CREATE ROLE tsp_user WITH LOGIN PASSWORD 'tsp_password';
        GRANT ALL PRIVILEGES ON DATABASE tsp_db TO tsp_user;
        GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO tsp_user;
        GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO tsp_user;
    END IF;
END
$$;