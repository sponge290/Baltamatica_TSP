% 北太天元v3.6 本地代理服务脚本
% 文件名：baltamatica_tsp_proxy.m
% 用法：直接在北太天元v3.6中打开，点击运行即可，无需任何修改
%% ==================== 配置项（仅需修改此处） ====================
config.allow_origin = {"http://localhost:3000", "https://baltamatica-tsp.vercel.app", "http://192.168.1.100:8080"}; % 允许的前端域名
config.port = 18080; % 固定端口，与前端保持一致
config.max_exec_time = 120; % 算法最大执行时间（秒）
config.host = "127.0.0.1"; % 仅监听本地，禁止修改为0.0.0.0
%% ==================== 启动提示 ====================
disp("=====================================");
disp("天气感知型TSP 本地代理服务启动成功");
% 显示允许的前端域名
allowed_origins = config.allow_origin;
origins_str = allowed_origins{1};
for i = 2:length(allowed_origins)
    origins_str = [origins_str "、" allowed_origins{i}];
end
disp(["前端允许域名：" origins_str]);
disp(["本地服务地址：http://" config.host ":" num2str(config.port)]);
disp("提示：请勿关闭此窗口，关闭后前端将无法调用计算能力");
disp("=====================================");
%% ==================== 北太天元原生HTTP服务 ====================
% 初始化HTTP服务器
server = tcpserver(config.host, config.port);

% 主循环：处理客户端连接
while true
    try
        % 等待客户端连接
        disp('等待客户端连接...');
        client = accept(server);
        
        % 处理客户端请求
        process_client(client, config);
        
    catch ME
        disp(['错误：' ME.message]);
        continue;
    end
end

function process_client(client, config)
try
    % 读取请求头
    request = readline(client);
    if isempty(request)
        close(client);
        return;
    end
    
    % 解析请求行
    parts = strsplit(request, ' ');
    if length(parts) < 3
        send_error(client, 400, 'Bad Request');
        close(client);
        return;
    end
    
    method = parts{1};
    path = parts{2};
    
    % 读取请求头
    headers = struct();
    while true
        header_line = readline(client);
        if isempty(header_line) || strcmp(header_line, '\r')
            break;
        end
        header_parts = strsplit(header_line, ':');
        if length(header_parts) >= 2
            key = strtrim(header_parts{1});
            value = strtrim(strjoin(header_parts(2:end), ':'));
            headers.(lower(key)) = value;
        end
    end
    
    % 处理预检请求
    if strcmp(method, 'OPTIONS')
        send_cors_headers(client, config, headers);
        send_response(client, 200, 'OK', '{}');
        close(client);
        return;
    end
    
    % 处理GET请求（健康检查）
    if strcmp(method, 'GET')
        if strcmp(path, '/health')
            send_cors_headers(client, config, headers);
            response = struct('status', 'running', 'version', 'v3.6');
            send_response(client, 200, 'OK', jsonencode(response));
        else
            send_error(client, 404, 'Not Found');
        end
        close(client);
        return;
    end
    
    % 处理POST请求（核心执行）
    if strcmp(method, 'POST')
        if strcmp(path, '/run')
            % 读取请求体
            content_length = 0;
            if isfield(headers, 'content-length')
                content_length = str2double(headers.content_length);
            end
            
            if content_length > 0
                body = read(client, content_length, 'uint8');
                body_str = char(body');
                
                % 解析JSON请求
                try
                    request_data = jsondecode(body_str);
                    
                    % 提取核心参数
                    algorithm = request_data.algorithm;
                    if isfield(request_data, 'algorithm')
                        algorithm = request_data.algorithm;
                    else
                        algorithm = 'GA';
                    end
                    
                    problem_data = struct();
                    if isfield(request_data, 'problem_data')
                        problem_data = request_data.problem_data;
                    end
                    
                    params = struct();
                    if isfield(request_data, 'params')
                        params = request_data.params;
                    end
                    
                    % 验证参数
                    if isempty(problem_data)
                        send_cors_headers(client, config, headers);
                        error_response = struct('code', 400, 'msg', '问题参数不能为空');
                        send_response(client, 400, 'Bad Request', jsonencode(error_response));
                        close(client);
                        return;
                    end
                    
                    % 执行算法
                    [success, result, error_msg] = run_algorithm(algorithm, problem_data, params, config.max_exec_time);
                    
                    % 发送响应
                    send_cors_headers(client, config, headers);
                    if success
                        response = struct('code', 200, 'msg', '执行成功', 'data', result, 'logs', {{'算法执行成功'}});
                        send_response(client, 200, 'OK', jsonencode(response));
                    else
                        response = struct('code', 500, 'msg', '算法执行失败', 'error', error_msg);
                        send_response(client, 500, 'Internal Server Error', jsonencode(response));
                    end
                catch ME
                    send_cors_headers(client, config, headers);
                    error_response = struct('code', 500, 'msg', '服务内部错误', 'error', ME.message);
                    send_response(client, 500, 'Internal Server Error', jsonencode(error_response));
                end
            else
                send_cors_headers(client, config, headers);
                error_response = struct('code', 400, 'msg', '请求体不能为空');
                send_response(client, 400, 'Bad Request', jsonencode(error_response));
            end
        else
            send_error(client, 404, 'Not Found');
        end
        close(client);
        return;
    end
    
    % 其他方法返回405
    send_error(client, 405, 'Method Not Allowed');
    close(client);
    
catch ME
    disp(['处理客户端请求错误：' ME.message]);
    try
        close(client);
    end
end
end

function send_cors_headers(client, config, headers)
% 发送CORS头
origin = '';
if isfield(headers, 'origin')
    origin = headers.origin;
end

% 检查是否在允许的源列表中
allowed = false;
for i = 1:length(config.allow_origin)
    if strcmp(origin, config.allow_origin{i})
        allowed = true;
        break;
    end
end

if allowed
    writeline(client, ['Access-Control-Allow-Origin: ' origin]);
end
writeline(client, 'Access-Control-Allow-Methods: POST, GET, OPTIONS');
writeline(client, 'Access-Control-Allow-Headers: Content-Type');
writeline(client, 'Access-Control-Allow-Credentials: true');
end

function send_response(client, status_code, status_text, content)
% 发送HTTP响应
writeline(client, ['HTTP/1.1 ' num2str(status_code) ' ' status_text]);
writeline(client, 'Content-Type: application/json');
writeline(client, ['Content-Length: ' num2str(length(content))]);
writeline(client, '');
writeline(client, content);
end

function send_error(client, status_code, status_text)
% 发送错误响应
writeline(client, ['HTTP/1.1 ' num2str(status_code) ' ' status_text]);
writeline(client, 'Content-Type: text/plain');
writeline(client, ['Content-Length: ' num2str(length(status_text))]);
writeline(client, '');
writeline(client, status_text);
end

function [success, result, error_msg] = run_algorithm(algorithm, problem_data, params, max_exec_time)
try
    % 提取数据
    cities = [];
    if isfield(problem_data, 'cities')
        cities = problem_data.cities;
    end
    
    time_windows = [];
    if isfield(problem_data, 'time_windows')
        time_windows = problem_data.time_windows;
    end
    
    weather_data = [];
    if isfield(problem_data, 'weather_data')
        weather_data = problem_data.weather_data;
    end
    
    road_segments = [];
    if isfield(problem_data, 'road_segments')
        road_segments = problem_data.road_segments;
    end
    
    % 执行对应算法
    result = struct();
    start_time = tic;
    
    if strcmp(algorithm, 'DP')
        [result.path, result.total_cost, result.total_time, result.reliability, result.nodes, result.state_process] = DP_TSP(cities, time_windows, weather_data, road_segments);
    elseif strcmp(algorithm, 'A*')
        [result.path, result.total_cost, result.total_time, result.reliability, result.nodes, result.search_process] = AStar_TSP(cities, time_windows, weather_data, road_segments);
    elseif strcmp(algorithm, 'GA')
        [result.path, result.total_cost, result.total_time, result.reliability, result.nodes, result.iteration_process] = GA_TSP(cities, time_windows, weather_data, road_segments, params);
    else
        error('不支持的算法类型');
    end
    
    result.exec_time = toc(start_time) * 1000; % 执行耗时(ms)
    success = true;
    error_msg = '';
    
catch ME
    success = false;
    result = struct();
    error_msg = ME.message;
end
end

function [best_path, total_cost, total_time, reliability, nodes, state_process] = DP_TSP(cities, time_windows, weather_data, road_segments)
    % 适配北太天元v3.6 天气感知型TSP动态规划算法
    % 输入：标准化问题参数
    % 输出：最优路径、总成本、总时间、可靠性、节点详情、状态转移过程（可视化用）
    n = length(cities);
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
    n = length(cities);
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
        f_values = zeros(1, length(open_set));
        for i = 1:length(open_set)
            f_values(i) = open_set{i}.f;
        end
        [~, idx] = min(f_values);
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
    n = length(cities);
    
    % 算法参数
    pop_size = 50;
    if isfield(params, 'population_size')
        pop_size = params.population_size;
    end
    
    max_gen = 100;
    if isfield(params, 'max_generations')
        max_gen = params.max_generations;
    end
    
    mutation_rate = 0.1;
    if isfield(params, 'mutation_rate')
        mutation_rate = params.mutation_rate;
    end
    
    crossover_rate = 0.8;
    if isfield(params, 'crossover_rate')
        crossover_rate = params.crossover_rate;
    end
    
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
            if rand < crossover_rate && i+1 <= pop_size
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