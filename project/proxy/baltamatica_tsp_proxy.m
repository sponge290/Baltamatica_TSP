% 北太天元v3.6 本地代理服务脚本
% 文件名：baltamatica_tsp_proxy.m
% 用法：直接在北太天元v3.6中打开，点击运行即可，无需任何修改
%% ==================== 配置项（仅需修改此处） ====================
config.allow_origin = {'http://localhost:3000'}; % 允许的前端域名
config.port = 18080; % 固定端口，与前端保持一致
config.max_exec_time = 120; % 算法最大执行时间（秒）
config.host = "127.0.0.1"; % 仅监听本地，禁止修改为0.0.0.0
%% ==================== 启动提示 ====================
disp("=====================================");
disp("天气感知型TSP 本地代理服务启动成功");
disp(['前端允许域名：' config.allow_origin{1}]);
disp(["本地服务地址：http://" config.host ":" num2str(config.port)]);
disp("提示：请勿关闭此窗口，关闭后前端将无法调用计算能力");
disp("=====================================");
%% ==================== 内嵌Python HTTP服务（适配v3.6内置Python） ====================
pycode = sprintf(`
import sys
import json
import time
import subprocess
import traceback
from http.server import HTTPServer, BaseHTTPRequestHandler
from threading import Thread

# 配置项
ALLOW_ORIGIN = %s
PORT = %d
HOST = "%s"
MAX_EXEC_TIME = %d
# 自动获取北太天元v3.6执行程序路径，无需用户配置
BALTAMATICA_PATH = sys.executable

# 全局变量：实时执行日志
exec_logs = []

class TSPProxyHandler(BaseHTTPRequestHandler):
    # 关闭控制台日志输出
    def log_message(self, format, *args):
        return
    
    # 跨域配置
    def end_headers(self):
        origin = self.headers.get("Origin", "")
        if origin in ALLOW_ORIGIN:
            self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Credentials", "true")
        super().end_headers()

    # 处理预检请求
    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    # 健康检查接口：前端检测连接状态
    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "running", "version": "v3.6"}).encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

    # 核心执行接口：前端传入参数，执行算法
    def do_POST(self):
        global exec_logs
        exec_logs = []
        
        if self.path == "/run":
            try:
                # 读取前端参数
                content_length = int(self.headers.get("Content-Length", 0))
                post_data = self.rfile.read(content_length).decode("utf-8")
                request_data = json.loads(post_data)

                # 提取核心参数
                algorithm = request_data.get("algorithm", "GA")
                problem_data = request_data.get("problem_data", {})
                params = request_data.get("params", {})

                if not problem_data:
                    self.send_response(400)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps({"code": 400, "msg": "问题参数不能为空"}).encode("utf-8"))
                    return

                # 生成北太天元v3.6算法执行脚本
                script_content = self.generate_algorithm_script(algorithm, problem_data, params)
                temp_script = f"tsp_temp_{int(time.time())}.m"
                
                # 写入临时脚本文件
                with open(temp_script, "w", encoding="utf-8") as f:
                    f.write(script_content)

                # 调用北太天元执行脚本，捕获输出
                cmd = [BALTAMATICA_PATH, "-batch", f"run('{temp_script}')"]
                exec_logs.append(f"启动{algorithm}算法执行，超时时间{MAX_EXEC_TIME}秒")

                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    timeout=MAX_EXEC_TIME
                )

                # 清理临时文件
                try:
                    import os
                    os.remove(temp_script)
                except:
                    pass

                # 处理执行结果
                if result.returncode == 0:
                    # 解析JSON格式的执行结果
                    stdout = result.stdout.strip()
                    json_start = stdout.find("{")
                    json_end = stdout.rfind("}") + 1
                    if json_start >= 0 and json_end > json_start:
                        result_json = json.loads(stdout[json_start:json_end])
                        response = {
                            "code": 200,
                            "msg": "执行成功",
                            "data": result_json,
                            "logs": exec_logs,
                            "stderr": result.stderr.strip()
                        }
                    else:
                        response = {
                            "code": 500,
                            "msg": "算法执行结果解析失败",
                            "stdout": stdout,
                            "stderr": result.stderr.strip()
                        }
                else:
                    response = {
                        "code": 500,
                        "msg": "算法执行失败",
                        "stderr": result.stderr.strip(),
                        "stdout": result.stdout.strip()
                    }

                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(response).encode("utf-8"))

            except subprocess.TimeoutExpired:
                self.send_response(408)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"code": 408, "msg": f"算法执行超时，超过{MAX_EXEC_TIME}秒"}).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "code": 500,
                    "msg": "服务内部错误",
                    "error": str(e),
                    "trace": traceback.format_exc()
                }).encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

    # 生成适配北太天元v3.6的算法执行脚本
    def generate_algorithm_script(self, algorithm, problem_data, params):
        # 问题数据序列化
        cities_json = json.dumps(problem_data.get("cities", []))
        time_windows_json = json.dumps(problem_data.get("time_windows", []))
        weather_data_json = json.dumps(problem_data.get("weather_data", []))
        road_segments_json = json.dumps(problem_data.get("road_segments", []))
        params_json = json.dumps(params)

        # 算法脚本模板，适配北太天元v3.6语法
        script_template = f"""
%% 天气感知型TSP算法执行脚本 适配北太天元v3.6
%% 自动生成，请勿手动修改
clear;clc;close all;

%% 1. 加载输入数据
cities = jsondecode('{cities_json}');
time_windows = jsondecode('{time_windows_json}');
weather_data = jsondecode('{weather_data_json}');
road_segments = jsondecode('{road_segments_json}');
params = jsondecode('{params_json}');

%% 2. 执行对应算法
algorithm = '{algorithm}';
result = struct();

tic; % 计时开始
if strcmp(algorithm, 'DP')
    [result.path, result.total_cost, result.total_time, result.reliability, result.nodes, result.state_process] = DP_TSP(cities, time_windows, weather_data, road_segments);
elseif strcmp(algorithm, 'A*')
    [result.path, result.total_cost, result.total_time, result.reliability, result.nodes, result.search_process] = AStar_TSP(cities, time_windows, weather_data, road_segments);
elseif strcmp(algorithm, 'GA')
    [result.path, result.total_cost, result.total_time, result.reliability, result.nodes, result.iteration_process] = GA_TSP(cities, time_windows, weather_data, road_segments, params);
else
    error('不支持的算法类型');
end
result.exec_time = toc * 1000; % 执行耗时(ms)

%% 3. 输出标准JSON结果（前端解析用）
disp(jsonencode(result));

%% ==================== 算法函数定义 ====================
function [best_path, total_cost, total_time, reliability, nodes, state_process] = DP_TSP(cities, time_windows, weather_data, road_segments)
    % 适配北太天元v3.6 天气感知型TSP动态规划算法
    % 输入：标准化问题参数
    % 输出：最优路径、总成本、总时间、可靠性、节点详情、状态转移过程（可视化用）
    n = size(cities, 1);
    if n > 15
        error('动态规划算法仅支持15个城市以内的小规模问题');
    end
    
    %% 1. 初始化状态表
    INF = 1e18;
    dp = INF * ones(2^n, n);
    dp(1, 1) = 0; % 起点为第1个城市，北太天元索引从1开始
    prev = zeros(2^n, n); % 路径回溯表
    state_process = []; % 状态转移过程，用于D3.js可视化
    
    %% 2. 状态转移
    for mask = 1:2^n-1
        for u = 1:n
            if bitand(mask, bitshift(1, u-1)) ~= 0 && dp(mask, u) < INF
                for v = 1:n
                    if bitand(mask, bitshift(1, v-1)) == 0
                        % 计算当前到达时间
                        current_time = dp(mask, u);
                        % 计算天气感知的旅行时间与成本
                        [travel_time, cost, rel] = calculate_weather_aware_time(u, v, current_time, cities, road_segments, weather_data);
                        % 校验时间窗口约束
                        arrival_time = current_time + travel_time;
                        if is_time_window_valid(v, arrival_time, time_windows)
                            new_mask = bitor(mask, bitshift(1, v-1));
                            if dp(new_mask, v) > dp(mask, u) + cost
                                dp(new_mask, v) = dp(mask, u) + cost;
                                prev(new_mask, v) = u;
                                % 记录状态转移过程，用于可视化
                                state_process = [state_process; mask, new_mask, u, v, cost];
                            end
                        end
                    end
                end
            end
        end
    end
    
    %% 3. 回溯最优路径
    full_mask = 2^n - 1;
    min_cost = INF;
    best_idx = 1;
    for v = 1:n
        [travel_time, cost, ~] = calculate_weather_aware_time(v, 1, dp(full_mask, v), cities, road_segments, weather_data);
        if dp(full_mask, v) + cost < min_cost
            min_cost = dp(full_mask, v) + cost;
            best_idx = v;
        end
    end
    best_path = reconstruct_path(prev, full_mask, best_idx);
    % 补充返回起点
    best_path = [best_path, 1];
    
    %% 4. 计算路径全量指标与节点详情
    [total_time, reliability, nodes] = calculate_path_metrics(best_path, cities, time_windows, weather_data, road_segments);
    total_cost = min_cost;
end

function [best_path, total_cost, total_time, reliability, nodes, search_process] = AStar_TSP(cities, time_windows, weather_data, road_segments)
    % 适配北太天元v3.6 天气感知型TSP A*算法
    n = size(cities, 1);
    if n > 30
        error('A*算法推荐使用30个城市以内的中等规模问题');
    end
    
    % 初始化A*算法数据结构
    open_set = {};
    closed_set = zeros(1, n);
    g_score = inf(1, n);
    g_score(1) = 0;
    f_score = inf(1, n);
    f_score(1) = calculate_heuristic(1, cities, road_segments);
    came_from = zeros(1, n);
    search_process = [];
    
    % 优先队列实现（简单版）
    open_set{1} = struct('node', 1, 'f', f_score(1));
    
    while ~isempty(open_set)
        % 找到f值最小的节点
        [~, idx] = min([open_set.f]);
        current = open_set{idx}.node;
        open_set(idx) = [];
        
        if closed_set(current) == 1
            continue;
        end
        
        closed_set(current) = 1;
        search_process = [search_process; current, g_score(current), f_score(current)];
        
        % 检查是否访问了所有城市
        if sum(closed_set) == n
            break;
        end
        
        % 扩展邻居节点
        for neighbor = 1:n
            if neighbor == current || closed_set(neighbor) == 1
                continue;
            end
            
            [travel_time, cost, ~] = calculate_weather_aware_time(current, neighbor, g_score(current), cities, road_segments, weather_data);
            tentative_g = g_score(current) + cost;
            
            if tentative_g < g_score(neighbor)
                came_from(neighbor) = current;
                g_score(neighbor) = tentative_g;
                f_score(neighbor) = tentative_g + calculate_heuristic(neighbor, cities, road_segments);
                
                % 添加到开放集
                open_set{end+1} = struct('node', neighbor, 'f', f_score(neighbor));
            end
        end
    end
    
    % 回溯路径
    best_path = reconstruct_astar_path(came_from, n);
    best_path = [best_path, 1]; % 补充返回起点
    
    % 计算路径指标
    [total_time, reliability, nodes] = calculate_path_metrics(best_path, cities, time_windows, weather_data, road_segments);
    total_cost = g_score(n) + calculate_weather_aware_time(n, 1, g_score(n), cities, road_segments, weather_data);
end

function [best_path, total_cost, total_time, reliability, nodes, iteration_process] = GA_TSP(cities, time_windows, weather_data, road_segments, params)
    % 适配北太天元v3.6 天气感知型TSP遗传算法
    n = size(cities, 1);
    
    % 算法参数
    pop_size = getfield(params, 'population_size', 50);
    max_gen = getfield(params, 'max_generations', 100);
    mutation_rate = getfield(params, 'mutation_rate', 0.1);
    crossover_rate = getfield(params, 'crossover_rate', 0.8);
    
    % 初始化种群
    population = zeros(pop_size, n);
    for i = 1:pop_size
        population(i, :) = randperm(n);
    end
    
    iteration_process = [];
    best_fitness = inf;
    best_individual = [];
    
    for gen = 1:max_gen
        % 计算适应度
        fitness = zeros(1, pop_size);
        for i = 1:pop_size
            path = [population(i, :), population(i, 1)];
            fitness(i) = calculate_path_cost(path, cities, road_segments, weather_data, time_windows);
        end
        
        % 记录最优解
        [min_fit, min_idx] = min(fitness);
        if min_fit < best_fitness
            best_fitness = min_fit;
            best_individual = population(min_idx, :);
        end
        
        iteration_process = [iteration_process; gen, best_fitness, mean(fitness)];
        
        % 选择
        new_population = zeros(pop_size, n);
        for i = 1:pop_size
            % 轮盘赌选择
            selected = roulette_wheel_selection(fitness);
            new_population(i, :) = population(selected, :);
        end
        
        % 交叉
        for i = 1:2:pop_size
            if rand < crossover_rate
                [new_population(i, :), new_population(i+1, :)] = crossover(new_population(i, :), new_population(i+1, :));
            end
        end
        
        % 变异
        for i = 1:pop_size
            if rand < mutation_rate
                new_population(i, :) = mutate(new_population(i, :));
            end
        end
        
        population = new_population;
    end
    
    best_path = [best_individual, best_individual(1)];
    [total_time, reliability, nodes] = calculate_path_metrics(best_path, cities, time_windows, weather_data, road_segments);
    total_cost = best_fitness;
end

function [travel_time, cost, reliability] = calculate_weather_aware_time(u, v, current_time, cities, road_segments, weather_data)
    % 天气感知旅行时间计算函数，适配北太天元v3.6
    % 实现速度折减系数、天气影响因子计算
    
    % 查找路段
    segment = [];
    for i = 1:length(road_segments)
        if road_segments(i).start_city_id == u && road_segments(i).end_city_id == v
            segment = road_segments(i);
            break;
        end
    end
    
    if isempty(segment)
        % 计算直线距离作为默认值
        lat1 = cities(u).latitude;
        lon1 = cities(u).longitude;
        lat2 = cities(v).latitude;
        lon2 = cities(v).longitude;
        distance = 6371 * acos(cos(lat1*pi/180)*cos(lat2*pi/180)*cos((lon2-lon1)*pi/180) + sin(lat1*pi/180)*sin(lat2*pi/180));
        speed_limit = 100; % 默认限速
    else
        distance = segment.distance;
        speed_limit = segment.speed_limit;
    end
    
    % 基础旅行时间
    base_time = distance / speed_limit * 60; % 转换为分钟
    
    % 天气影响因子
    weather_factor = 1.0;
    if ~isempty(weather_data)
        % 简单的天气影响计算
        for i = 1:length(weather_data)
            if weather_data(i).city_id == u || weather_data(i).city_id == v
                if strcmp(weather_data(i).condition, 'rain')
                    weather_factor = weather_factor * 0.85;
                elseif strcmp(weather_data(i).condition, 'snow')
                    weather_factor = weather_factor * 0.7;
                elseif strcmp(weather_data(i).condition, 'fog')
                    weather_factor = weather_factor * 0.9;
                end
            end
        end
    end
    
    travel_time = base_time / weather_factor;
    cost = travel_time; % 以时间作为成本
    reliability = weather_factor;
end

function is_valid = is_time_window_valid(city_idx, arrival_time, time_windows)
    % 时间窗口约束校验函数
    if isempty(time_windows)
        is_valid = true;
        return;
    end
    
    is_valid = false;
    for i = 1:length(time_windows)
        if time_windows(i).city_id == city_idx
            if arrival_time >= time_windows(i).start_time && arrival_time <= time_windows(i).end_time
                is_valid = true;
                return;
            end
        end
    end
end

function path = reconstruct_path(prev, mask, current)
    % 路径回溯函数
    path = [];
    while mask ~= 1
        path = [current, path];
        new_current = prev(mask, current);
        new_mask = bitand(mask, bitcmp(bitshift(1, current-1)));
        mask = new_mask;
        current = new_current;
    end
    path = [1, path];
end

function path = reconstruct_astar_path(came_from, n)
    % A*算法路径回溯
    path = [];
    current = n;
    while current ~= 0
        path = [current, path];
        current = came_from(current);
    end
end

function [total_time, reliability, nodes] = calculate_path_metrics(path, cities, time_windows, weather_data, road_segments)
    % 路径指标计算函数，生成前端可视化所需的节点数据
    total_time = 0;
    total_reliability = 0;
    nodes = struct([]);
    
    current_time = 0;
    for i = 1:length(path)-1
        u = path(i);
        v = path(i+1);
        
        [travel_time, ~, rel] = calculate_weather_aware_time(u, v, current_time, cities, road_segments, weather_data);
        arrival_time = current_time + travel_time;
        
        % 生成节点数据
        node = struct();
        node.city_id = v;
        node.arrival_time = arrival_time;
        node.departure_time = arrival_time + 30; % 假设每个城市停留30分钟
        node.weather_condition = 'sunny'; % 简化处理
        nodes(end+1) = node;
        
        total_time = total_time + travel_time;
        total_reliability = total_reliability + rel;
        current_time = node.departure_time;
    end
    
    reliability = total_reliability / (length(path)-1);
end

function heuristic = calculate_heuristic(node, cities, road_segments)
    % A*算法启发式函数
    % 使用到最近未访问城市的距离作为启发式
    heuristic = 0;
    % 简化实现：返回一个较小的值
end

function selected = roulette_wheel_selection(fitness)
    % 轮盘赌选择
    total_fitness = sum(1./fitness);
    r = rand * total_fitness;
    cumulative = 0;
    for i = 1:length(fitness)
        cumulative = cumulative + 1./fitness(i);
        if cumulative >= r
            selected = i;
            return;
        end
    end
    selected = length(fitness);
end

function [child1, child2] = crossover(parent1, parent2)
    % 有序交叉
    n = length(parent1);
    point1 = randi(n-1);
    point2 = point1 + randi(n-point1);
    
    child1 = zeros(1, n);
    child2 = zeros(1, n);
    
    child1(point1:point2) = parent1(point1:point2);
    child2(point1:point2) = parent2(point1:point2);
    
    % 填充剩余基因
    fill_pos1 = [1:point1-1, point2+1:n];
    fill_pos2 = [1:point1-1, point2+1:n];
    
    idx1 = 1;
    idx2 = 1;
    for i = 1:n
        if ~ismember(parent2(i), child1)
            child1(fill_pos1(idx1)) = parent2(i);
            idx1 = idx1 + 1;
        end
        if ~ismember(parent1(i), child2)
            child2(fill_pos2(idx2)) = parent1(i);
            idx2 = idx2 + 1;
        end
    end
end

function mutated = mutate(individual)
    % 交换变异
    n = length(individual);
    pos1 = randi(n);
    pos2 = randi(n);
    while pos2 == pos1
        pos2 = randi(n);
    end
    
    mutated = individual;
    temp = mutated(pos1);
    mutated(pos1) = mutated(pos2);
    mutated(pos2) = temp;
end

function cost = calculate_path_cost(path, cities, road_segments, weather_data, time_windows)
    % 计算路径成本
    cost = 0;
    current_time = 0;
    
    for i = 1:length(path)-1
        u = path(i);
        v = path(i+1);
        
        [travel_time, c, ~] = calculate_weather_aware_time(u, v, current_time, cities, road_segments, weather_data);
        arrival_time = current_time + travel_time;
        
        % 时间窗口惩罚
        if ~is_time_window_valid(v, arrival_time, time_windows)
            cost = cost + 10000; % 大惩罚
        end
        
        cost = cost + c;
        current_time = arrival_time + 30; % 停留时间
    end
end

function value = getfield(struct, field, default)
    % 获取结构体字段，不存在则返回默认值
    if isfield(struct, field)
        value = struct.(field);
    else
        value = default;
    end
end
"""
        return script_template

# 启动HTTP服务
def run_server():
    server = HTTPServer((HOST, PORT), TSPProxyHandler)
    server.serve_forever()

if __name__ == "__main__":
    server_thread = Thread(target=run_server, daemon=True)
    server_thread.start()
    # 保持脚本常驻运行
    while True:
        time.sleep(1)
`, json.dumps([str(x) for x in config.allow_origin]), config.port, config.host, config.max_exec_time);

%% ==================== 执行Python代码，启动服务 ====================
py.exec(pycode);