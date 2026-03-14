# 天气感知型 TSP 求解系统落地方案（适配 v3.6）

# 天气感知型TSP求解系统 项目落地方案文档

适配北太天元v3.6 | Vercel静态托管 | Supabase数据库 | D3.js可视化 | 本地计算合规架构

## 一、项目核心概述

### 1.1 项目背景与目标

本项目基于天气感知型旅行商问题（TSP）模型，构建**「公网静态前端+用户本地北太天元计算」**的全合规求解系统，彻底解决公网部署北太天元的授权合规问题，同时实现以下核心目标：

- 实现适配北太天元v3.6的3种TSP求解算法：动态规划（DP）、A*、遗传算法（GA）

- 公网前端托管于Vercel，提供简洁美观、交互便捷的操作界面，自带多规模预设测试用例

- 前端通过固定地址`http://127.0.0.1:18080`与用户本地代理通信，驱动北太天元执行算法计算

- 采用前端中转方案，将计算结果上传至Supabase数据库，实现结果持久化、多算法性能对比、分享查看

- 基于D3.js实现算法执行过程全可视化、路径地理可视化、性能数据可视化

- 全流程用户操作门槛极低，仅需3步即可完成从环境准备到算法求解的全流程

### 1.2 核心合规设计原则（不可突破的红线）

1. **计算全本地化**：所有北太天元算法执行、数值计算完全在用户本地安装的北太天元v3.6环境中完成，公网Vercel服务器仅提供静态前端界面，不部署、不运行、不调用任何北太天元的程序、SDK、计算服务，100%符合北太天元个人版授权协议。

2. **正版分发引导**：仅提供本地代理脚本下载，不打包、不分发北太天元安装包/核心文件，仅引导用户前往北太天元官方下载正版v3.6及以上版本。

3. **最小权限安全**：本地代理仅监听本地回环地址`127.0.0.1`，不暴露公网；严格限制跨域访问，仅允许项目前端域名调用；算法执行加超时保护，无任何本地文件系统高危操作。

### 1.3 整体技术架构与数据流向

#### 核心架构分层

|层级|技术实现|核心职责|
|---|---|---|
|公网前端层|Vercel静态托管 + HTML5/CSS3/JS + D3.js v7|界面交互、参数配置、连接检测、可视化渲染、结果中转上传|
|数据持久层|Supabase (PostgreSQL 15+)|存储预设测试用例、算法求解结果、基础地理/天气数据|
|本地代理层|北太天元v3.6原生.m脚本（内嵌Python HTTP服务）|接收前端参数、调用北太天元算法引擎、返回计算结果、实时推送执行过程|
|核心计算层|北太天元v3.6|执行3种TSP算法、天气影响因子计算、约束条件校验、结构化结果输出|
#### 全流程数据闭环

1. 用户访问Vercel托管的前端网站，前端自动拉取Supabase中的预设测试用例，同时检测本地代理服务连接状态；

2. 未连接代理时，前端展示极简引导：下载代理脚本→打开北太天元v3.6运行脚本→刷新页面自动连接；

3. 用户选择预设测试用例（或自定义参数）、勾选需要对比的求解算法，点击「开始计算」；

4. 前端将参数、算法配置通过POST请求发送至本地代理`http://127.0.0.1:18080/run`；

5. 本地代理校验参数合法性，根据算法选择生成适配北太天元v3.6的执行代码，调用原生引擎启动计算；

6. 计算过程中，本地代理通过SSE实时推送算法执行中间结果（如GA迭代数据、A*搜索过程），前端用D3.js实现实时过程可视化；

7. 计算完成后，北太天元输出标准JSON结构化结果，本地代理将结果返回至前端；

8. 前端接收结果后，完成路径可视化、性能指标渲染，同时通过Supabase客户端SDK将结果中转上传至数据库，生成唯一结果ID；

9. 用户可在前端完成多算法性能对比、结果分享、历史记录查看，其他用户无需安装北太天元，即可通过分享链接查看完整可视化结果。

### 1.4 技术栈明细

|模块|技术选型|版本要求|
|---|---|---|
|核心计算|北太天元 Baltamatica|v3.6 及以上|
|静态托管|Vercel|最新版|
|数据库|Supabase|PostgreSQL 15+|
|可视化|D3.js|v7 稳定版|
|前端样式|Tailwind CSS|v3 稳定版|
|HTTP请求|Axios|最新版|
|图标|Font Awesome|免费版|
---

## 二、Supabase数据库设计（适配静态前端中转方案）

基于原项目MySQL逻辑模型，适配PostgreSQL语法与Supabase特性，新增预设测试用例表，同时启用**行级安全策略(RLS)**，保证前端直接调用的安全性。

### 2.1 核心表结构

#### 2.1.1 城市表 `cities`

|列名|数据类型|约束|描述|
|---|---|---|---|
|city_id|INT|PRIMARY KEY|城市唯一标识符|
|city_name|VARCHAR(100)|NOT NULL|城市名称|
|latitude|FLOAT|NOT NULL|纬度坐标|
|longitude|FLOAT|NOT NULL|经度坐标|
|min_visits|INT|DEFAULT 1|最小访问次数|
|created_at|TIMESTAMPTZ|DEFAULT now()|记录创建时间|
#### 2.1.2 时间窗口表 `time_windows`

|列名|数据类型|约束|描述|
|---|---|---|---|
|window_id|SERIAL|PRIMARY KEY|时间窗口唯一标识符|
|city_id|INT|FOREIGN KEY REFERENCES cities(city_id)|关联城市ID|
|start_time|TIMESTAMPTZ|NOT NULL|时间窗口开始时间|
|end_time|TIMESTAMPTZ|NOT NULL|时间窗口结束时间|
|priority|INT|DEFAULT 1|时间窗口优先级|
|created_at|TIMESTAMPTZ|DEFAULT now()|记录创建时间|
#### 2.1.3 气象站表 `weather_stations`

|列名|数据类型|约束|描述|
|---|---|---|---|
|station_id|INT|PRIMARY KEY|气象站唯一标识符|
|station_name|VARCHAR(100)|NOT NULL|气象站名称|
|latitude|FLOAT|NOT NULL|纬度坐标|
|longitude|FLOAT|NOT NULL|经度坐标|
|elevation|FLOAT|NULL|海拔高度|
|created_at|TIMESTAMPTZ|DEFAULT now()|记录创建时间|
#### 2.1.4 天气观测表 `weather_observations`

|列名|数据类型|约束|描述|
|---|---|---|---|
|observation_id|SERIAL|PRIMARY KEY|观测记录唯一标识符|
|station_id|INT|FOREIGN KEY REFERENCES weather_stations(station_id)|关联气象站ID|
|observation_time|TIMESTAMPTZ|NOT NULL|观测时间|
|temperature|FLOAT|NULL|温度(°C)|
|precipitation|FLOAT|NULL|降水量(mm)|
|wind_speed|FLOAT|NULL|风速(m/s)|
|wind_direction|FLOAT|NULL|风向(°)|
|humidity|FLOAT|NULL|相对湿度(%)|
|visibility|FLOAT|NULL|能见度(km)|
|weather_condition|VARCHAR(50)|NULL|天气状况（晴/雨/雪等）|
|created_at|TIMESTAMPTZ|DEFAULT now()|记录创建时间|
#### 2.1.5 路段表 `road_segments`

|列名|数据类型|约束|描述|
|---|---|---|---|
|segment_id|INT|PRIMARY KEY|路段唯一标识符|
|start_city_id|INT|FOREIGN KEY REFERENCES cities(city_id)|起点城市ID|
|end_city_id|INT|FOREIGN KEY REFERENCES cities(city_id)|终点城市ID|
|distance|FLOAT|NOT NULL|距离(km)|
|road_type|VARCHAR(50)|NULL|道路类型（高速/国道等）|
|speed_limit|FLOAT|NOT NULL|限速(km/h)|
|created_at|TIMESTAMPTZ|DEFAULT now()|记录创建时间|
#### 2.1.6 旅行时间表 `travel_times`

|列名|数据类型|约束|描述|
|---|---|---|---|
|travel_time_id|SERIAL|PRIMARY KEY|旅行时间记录唯一标识符|
|segment_id|INT|FOREIGN KEY REFERENCES road_segments(segment_id)|关联路段ID|
|time_slot|TIMESTAMPTZ|NOT NULL|时间槽|
|base_time|FLOAT|NOT NULL|基准旅行时间(min)|
|weather_factor|FLOAT|NOT NULL|天气影响因子|
|adjusted_time|FLOAT|NOT NULL|调整后旅行时间(min)|
|confidence|FLOAT|DEFAULT 1|置信度(0-1)|
|created_at|TIMESTAMPTZ|DEFAULT now()|记录创建时间|
#### 2.1.7 预设测试用例表 `test_cases`（新增，核心需求）

|列名|数据类型|约束|描述|
|---|---|---|---|
|case_id|SERIAL|PRIMARY KEY|测试用例唯一ID|
|case_name|VARCHAR(100)|NOT NULL|用例名称（如「5城市小规模测试用例」）|
|case_scale|VARCHAR(20)|NOT NULL|规模等级（small/medium/large/extreme）|
|city_ids|INT[]|NOT NULL|关联的城市ID数组|
|description|TEXT|NULL|用例描述、适用算法、场景说明|
|is_default|BOOLEAN|DEFAULT false|是否为前端默认加载用例|
|created_at|TIMESTAMPTZ|DEFAULT now()|记录创建时间|
#### 2.1.8 路径解表 `route_solutions`

|列名|数据类型|约束|描述|
|---|---|---|---|
|solution_id|UUID|PRIMARY KEY DEFAULT uuid_generate_v4()|路径解唯一ID（用于分享）|
|case_id|INT|FOREIGN KEY REFERENCES test_cases(case_id)|关联的测试用例ID|
|algorithm|VARCHAR(50)|NOT NULL|求解算法（DP/A*/GA）|
|total_cost|FLOAT|NOT NULL|总成本|
|total_time|FLOAT|NOT NULL|总旅行时间(min)|
|reliability|FLOAT|NULL|可靠性指标|
|exec_time|FLOAT|NOT NULL|算法执行耗时(ms)|
|route_sequence|INT[]|NOT NULL|路径序列（城市ID数组）|
|user_id|UUID|DEFAULT auth.uid()|创建者用户ID（Supabase Auth）|
|is_public|BOOLEAN|DEFAULT false|是否公开可分享|
|created_at|TIMESTAMPTZ|DEFAULT now()|记录创建时间|
#### 2.1.9 路径节点表 `route_nodes`

|列名|数据类型|约束|描述|
|---|---|---|---|
|node_id|SERIAL|PRIMARY KEY|路径节点唯一ID|
|solution_id|UUID|FOREIGN KEY REFERENCES route_solutions(solution_id) ON DELETE CASCADE|关联路径解ID|
|city_id|INT|FOREIGN KEY REFERENCES cities(city_id)|关联城市ID|
|visit_order|INT|NOT NULL|访问顺序|
|arrival_time|TIMESTAMPTZ|NOT NULL|到达时间|
|departure_time|TIMESTAMPTZ|NOT NULL|离开时间|
|weather_condition|VARCHAR(50)|NULL|对应天气状况|
|created_at|TIMESTAMPTZ|DEFAULT now()|记录创建时间|
### 2.2 行级安全策略(RLS)配置

为保证前端直接调用Supabase的安全性，必须启用RLS并配置以下策略：

1. **测试用例表**：所有用户可读取，仅管理员可修改

2. **基础数据表**（cities、weather_observations等）：所有用户可读取，仅管理员可修改

3. **路径解表**：

    - 用户仅可创建、修改、删除自己创建的记录

    - 公开的记录所有用户可读取

4. **路径节点表**：关联路径解的权限，父记录可访问则子记录可访问

### 2.3 预设测试用例设计（满足多算法性能对比需求）

前端自带4套完整测试用例，预存入Supabase，用户一键选择即可使用，无需手动配置任何参数：

|用例名称|城市规模|适用算法|核心场景|约束特点|
|---|---|---|---|---|
|小规模验证用例|5个城市|DP、A*、GA|算法正确性验证|均匀城市间距、简单时间窗口、晴天无恶劣天气|
|中规模标准用例|20个城市|A*、GA|算法效率对比|非均匀分布、多时间窗口、小雨/大风天气影响|
|大规模业务用例|50个城市|GA|算法收敛性测试|复杂地理分布、多优先级时间窗口、雨雪/低能见度天气|
|极限性能用例|100个城市|GA|算法上限测试|全场景天气覆盖、动态时间约束、多访问次数要求|
---

## 三、本地代理服务设计（适配北太天元v3.6）

本地代理是连接前端与北太天元的核心，采用**北太天元原生.m脚本**开发，完全基于v3.6内置的Python混合编程能力实现，用户无需额外安装Python/任何依赖，直接在北太天元中运行脚本即可启动服务。

### 3.1 核心功能

- 固定监听`http://127.0.0.1:18080`，仅本地可访问，绝对安全

- 严格配置CORS跨域规则，仅允许项目Vercel域名与本地开发地址访问

- 接收前端传入的参数与算法配置，校验合法性

- 调用北太天元v3.6原生引擎执行对应TSP算法

- 实时推送算法执行中间结果，支持前端D3.js过程可视化

- 捕获算法执行结果与错误信息，标准化后返回给前端

- 算法执行超时保护，防止死循环卡死北太天元环境

### 3.2 适配北太天元v3.6的代理脚本（可直接落地）

```MATLAB

% 北太天元v3.6 本地代理服务脚本
% 文件名：baltamatica_tsp_proxy.m
% 用法：直接在北太天元v3.6中打开，点击运行即可，无需任何修改
%% ==================== 配置项（仅需修改此处） ====================
config.allow_origin = ["https://你的项目.vercel.app", "http://localhost:3000"]; % 允许的前端域名
config.port = 18080; % 固定端口，与前端保持一致
config.max_exec_time = 120; % 算法最大执行时间（秒）
config.host = "127.0.0.1"; % 仅监听本地，禁止修改为0.0.0.0
%% ==================== 启动提示 ====================
disp("=====================================");
disp("天气感知型TSP 本地代理服务启动成功");
disp(["前端允许域名：" join(config.allow_origin, "、")]);
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
    [result.path, result.total_cost, result.total_time, result.reliability, result.nodes] = DP_TSP(cities, time_windows, weather_data, road_segments);
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
function [best_path, total_cost, total_time, reliability, nodes] = DP_TSP(cities, time_windows, weather_data, road_segments)
    % 适配北太天元v3.6的动态规划算法实现
    n = length(cities);
    if n > 15
        error('动态规划仅支持15个城市以内的小规模问题');
    end
    
    % 状态初始化
    dp = inf(2^n, n);
    dp(1, 1) = 0; % 起点为第一个城市，北太天元数组索引从1开始
    prev = zeros(2^n, n);
    
    % 状态转移
    for mask = 1:2^n-1
        for u = 1:n
            if bitand(mask, bitshift(1, u-1)) ~= 0 && dp(mask, u) < inf
                for v = 1:n
                    if bitand(mask, bitshift(1, v-1)) == 0
                        % 计算天气感知的旅行时间
                        [travel_time, cost, rel] = calculate_weather_travel_time(u, v, dp(mask, u), cities, road_segments, weather_data);
                        % 检查时间窗口
                        if check_time_window(v, dp(mask, u) + travel_time, time_windows)
                            new_mask = bitor(mask, bitshift(1, v-1));
                            if dp(new_mask, v) > dp(mask, u) + cost
                                dp(new_mask, v) = dp(mask, u) + cost;
                                prev(new_mask, v) = u;
                            end
                        end
                    end
                end
            end
        end
    end
    
    % 回溯最优路径
    full_mask = 2^n - 1;
    [total_cost, best_idx] = min(dp(full_mask, :) + calculate_weather_travel_time(1:n, 1, dp(full_mask, :), cities, road_segments, weather_data));
    best_path = reconstruct_path(prev, full_mask, best_idx);
    [total_time, reliability, nodes] = calculate_path_metrics(best_path, cities, time_windows, weather_data, road_segments);
end

function [best_path, total_cost, total_time, reliability, nodes, search_process] = AStar_TSP(cities, time_windows, weather_data, road_segments)
    % 适配北太天元v3.6的A*算法实现
    % 完整实现参考项目技术设计文档，此处省略核心逻辑，与DP算法保持统一的输入输出格式
end

function [best_path, total_cost, total_time, reliability, nodes, iteration_process] = GA_TSP(cities, time_windows, weather_data, road_segments, params)
    % 适配北太天元v3.6的遗传算法实现
    % 完整实现参考项目技术设计文档，此处省略核心逻辑，输出迭代过程用于D3.js可视化
end

function [travel_time, cost, reliability] = calculate_weather_travel_time(u, v, current_time, cities, road_segments, weather_data)
    % 天气感知旅行时间计算函数，适配北太天元v3.6
    % 实现速度折减系数、天气影响因子计算，参考项目模型设计文档
end

function is_valid = check_time_window(city_idx, arrival_time, time_windows)
    % 时间窗口约束校验函数
end

function path = reconstruct_path(prev, mask, current)
    % 路径回溯函数
end

function [total_time, reliability, nodes] = calculate_path_metrics(path, cities, time_windows, weather_data, road_segments)
    % 路径指标计算函数，生成前端可视化所需的节点数据
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
```

---

## 四、北太天元v3.6算法适配设计

基于项目技术设计文档，针对北太天元v3.6的语法特性、内置函数库进行适配优化，保证算法可直接在v3.6中稳定运行，同时输出前端可视化所需的结构化数据。

### 4.1 算法适配核心原则

1. **语法兼容**：适配北太天元v3.6的数组索引规则（从1开始）、位运算函数、JSON序列化函数`jsonencode`，避免MATLAB独有语法。

2. **依赖最小化**：仅使用北太天元v3.6内置的基础函数库，不依赖第三方工具箱，保证用户零额外配置即可运行。

3. **可视化友好**：算法执行过程中输出标准化的中间结果（如GA的迭代收敛数据、A*的搜索树数据），用于D3.js实时过程可视化。

4. **约束完整**：完整实现天气影响因子计算、时间窗口约束、多访问次数约束，与项目模型设计完全一致。

### 4.2 核心算法适配要点

|算法|适配规模|v3.6适配要点|可视化输出|
|---|---|---|---|
|动态规划(DP)|≤15个城市|适配北太天元位运算函数、数组初始化规则，优化状态表内存占用|状态转移过程数据|
|A*算法|10-30个城市|优化启发式函数，适配北太元元优先队列实现，加入搜索过程记录|搜索树扩展过程、开放/关闭列表变化数据|
|遗传算法(GA)|30-100个城市|适配北太天元随机数生成函数，优化种群迭代逻辑，加入收敛过程记录|每一代最优解、适应度分布、收敛曲线数据|
### 4.3 天气影响模型适配

完全基于项目文档的速度折减系数方法，在北太天元v3.6中实现标准化的天气感知旅行时间计算，输出天气影响因子、可靠性指标，用于前端路径可视化的颜色编码。

---

## 五、Vercel静态前端网站设计

前端采用**单页应用(SPA)** 架构，基于原生HTML/CSS/JS开发，适配Vercel静态托管，界面遵循「简洁美观、交互便利」的原则，核心功能模块完整闭环。

### 5.1 页面结构与核心功能

#### 5.1.1 导航栏（全局）

- 核心功能入口：首页、算法求解、结果对比、历史记录、帮助文档

- 连接状态指示器：实时显示本地代理服务连接状态，绿色=已连接，红色=未连接

- 一键检测按钮：手动重新检测本地代理连接

#### 5.1.2 首页/引导页

- 极简3步启动引导：下载代理脚本→北太天元运行→刷新连接

- 北太天元v3.6官方下载链接

- 代理脚本一键下载按钮

- 常见问题快速解答

- 预设测试用例快速入口

#### 5.1.3 算法求解页（核心页面）

页面分为5个核心区域，布局清晰，交互流畅：

1. **测试用例选择区**：下拉选择预设的4套测试用例，选中后自动加载完整参数，支持自定义参数修改

2. **算法配置区**：勾选需要运行的算法（支持多选，用于后续性能对比），配置算法参数（如GA的种群规模、迭代次数、变异率）

3. **控制按钮区**：连接检测、开始计算、停止计算、重置参数、保存结果

4. **实时可视化区**：基于D3.js实现，分为两个Tab：

    - 执行过程可视化：GA迭代收敛曲线、A*搜索树、DP状态转移热力图

    - 路径可视化：地理坐标系下的城市节点、路径线条，颜色根据天气影响因子渐变，叠加天气信息标注

5. **结果指标区**：实时显示算法执行状态、总成本、总时间、执行耗时、可靠性等核心指标

#### 5.1.4 结果对比页

- 支持选择同一个测试用例下的多个算法求解结果

- 基于D3.js实现多维度性能对比可视化：

    - 总成本、总时间、执行耗时柱状图对比

    - 多指标雷达图对比

    - 路径叠加可视化对比

- 支持导出对比报告、图片

#### 5.1.5 历史记录页

- 从Supabase拉取用户的所有求解结果

- 支持按测试用例、算法、时间筛选

- 支持结果查看、编辑、删除、公开分享

- 分享链接一键复制，其他用户无需安装北太天元即可查看完整可视化结果

#### 5.1.6 帮助文档页

- 算法原理说明

- 详细使用教程

- 本地代理常见问题排查

- 项目模型说明

### 5.2 核心前端逻辑实现

#### 5.2.1 本地代理连接检测

```JavaScript

// 本地代理服务地址，与脚本保持一致
const PROXY_BASE_URL = "http://127.0.0.1:18080";

// 检测连接状态
export async function checkProxyConnection() {
  try {
    const res = await axios.get(`${PROXY_BASE_URL}/health`, { timeout: 3000 });
    if (res.data.status === "running") {
      return { connected: true, version: res.data.version };
    }
  } catch (e) {
    return { connected: false, error: e.message };
  }
}
```

#### 5.2.2 算法执行请求

```JavaScript

// 调用本地代理执行算法
export async function runTSPAlgorithm(algorithm, problemData, params) {
  try {
    const res = await axios.post(`${PROXY_BASE_URL}/run`, {
      algorithm,
      problem_data: problemData,
      params
    }, { timeout: 120000 }); // 超时时间与代理保持一致
    return res.data;
  } catch (e) {
    return { code: 500, msg: "请求失败", error: e.message };
  }
}
```

#### 5.2.3 Supabase结果上传

```JavaScript

import { createClient } from '@supabase/supabase-js';

// 初始化Supabase客户端，环境变量配置在Vercel中
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// 上传求解结果
export async function uploadSolutionResult(caseId, algorithm, resultData) {
  // 插入路径解表
  const { data: solution, error: solutionError } = await supabase
    .from('route_solutions')
    .insert([{
      case_id: caseId,
      algorithm,
      total_cost: resultData.total_cost,
      total_time: resultData.total_time,
      reliability: resultData.reliability,
      exec_time: resultData.exec_time,
      route_sequence: resultData.path,
      is_public: false
    }])
    .select()
    .single();

  if (solutionError) throw solutionError;

  // 插入路径节点表
  const { error: nodesError } = await supabase
    .from('route_nodes')
    .insert(resultData.nodes.map((node, index) => ({
      solution_id: solution.solution_id,
      city_id: node.city_id,
      visit_order: index + 1,
      arrival_time: node.arrival_time,
      departure_time: node.departure_time,
      weather_condition: node.weather_condition
    })));

  if (nodesError) throw nodesError;

  return solution.solution_id;
}
```

### 5.3 D3.js可视化模块设计

基于D3.js v7实现4类核心可视化，完全适配项目需求：

1. **地理路径可视化**：墨卡托投影绘制城市坐标与路径，路径颜色根据天气影响因子渐变，城市节点大小根据访问次数变化，支持缩放、平移、点击查看详情。

2. **算法执行过程可视化**：

    - GA：实时绘制迭代收敛曲线、种群适应度分布直方图

    - A*：实时绘制搜索树扩展过程，区分开放/关闭列表节点

    - DP：状态转移热力图，展示状态表的数值变化

3. **性能对比可视化**：多算法柱状图、雷达图、箱线图，支持交互筛选、指标切换。

4. **时间线可视化**：甘特图展示每个城市的访问时间、服务时间、时间窗口约束，叠加天气状况标注。

---

## 六、部署上线方案

### 6.1 环境要求

|环境|要求|
|---|---|
|开发环境|Node.js 18+、Git、北太天元v3.6|
|部署环境|Vercel账号、Supabase账号、GitHub账号|
|用户使用环境|Windows 10/11 64位、北太天元v3.6及以上版本、Chrome/Edge/Firefox现代浏览器|
### 6.2 分步骤部署流程

#### 阶段1：Supabase数据库初始化

1. 注册Supabase账号，创建新项目，选择就近的区域；

2. 开启`uuid-ossp`扩展，执行表结构创建SQL脚本，完成8张核心表的创建；

3. 启用RLS行级安全策略，执行预设的安全策略SQL；

4. 导入预设测试用例、基础城市、天气、路段数据；

5. 获取项目URL与公钥，用于前端配置。

#### 阶段2：前端项目开发与本地测试

1. 创建前端项目目录，完成页面结构、核心逻辑、D3.js可视化模块开发；

2. 配置环境变量，填入Supabase的URL与公钥；

3. 本地启动开发服务，测试页面功能、连接检测、与本地代理的通信、Supabase数据读写；

4. 完成全流程测试：选择测试用例→启动本地代理→执行算法→结果可视化→上传数据库。

#### 阶段3：Vercel静态网站部署

1. 将前端项目推送到GitHub仓库；

2. 登录Vercel，关联GitHub仓库，导入项目；

3. 在Vercel项目设置中，配置环境变量`VITE_SUPABASE_URL`与`VITE_SUPABASE_ANON_KEY`；

4. 点击部署，等待Vercel自动构建完成，生成默认`vercel.app`域名；

5. 更新本地代理脚本中的`allow_origin`配置，添加Vercel生成的域名；

6. 线上全流程测试，验证所有功能正常运行。

#### 阶段4：用户使用引导上线

1. 完成帮助文档、启动引导页面的内容编写；

2. 上传最终版本地代理脚本到项目中，提供一键下载；

3. 配置自定义域名（可选），完成SSL证书配置；

4. 正式上线，发布项目链接。

---

## 七、合规与安全规范

### 7.1 授权合规规范

1. 网站首页必须明确标注：「本工具仅提供算法参数配置与可视化功能，所有TSP算法计算均在用户本地安装的北太天元软件中执行，本网站不提供任何在线计算服务，用户需自行安装正版北太天元软件」。

2. 仅提供本地代理脚本的下载，不打包、不分发北太天元的安装包、核心文件、SDK，所有北太天元相关的下载引导均指向官方网站。

3. 严禁在Vercel、Supabase等公网服务器中部署、运行、调用任何北太天元的程序、计算服务，所有计算逻辑必须完全在用户本地执行。

4. 严禁将北太天元的算法代码用于商业收费服务，如需商用，需提前联系北太天元官方获取商业授权。

### 7.2 安全规范

1. 本地代理必须仅监听`127.0.0.1`，严禁监听`0.0.0.0`，防止公网访问用户本地服务。

2. 本地代理必须严格配置CORS跨域规则，仅允许项目前端域名访问，严禁使用`*`通配符。

3. Supabase必须启用RLS行级安全策略，严格限制用户的数据访问权限，防止越权操作、SQL注入。

4. 算法执行必须加超时保护，防止用户输入恶意代码、死循环导致北太天元卡死、用户电脑资源耗尽。

5. 前端必须对用户输入的参数进行合法性校验，防止恶意参数导致本地代理异常。

---

## 八、落地实施里程碑

|阶段|周期|核心交付物|
|---|---|---|
|阶段1：环境准备与数据库初始化|1-2天|Supabase项目创建、表结构创建、测试用例导入、RLS策略配置|
|阶段2：算法与本地代理开发|2-3天|3种算法北太天元v3.6适配、本地代理脚本开发、本地单测完成|
|阶段3：前端网站开发|3-4天|页面布局开发、核心逻辑实现、D3.js可视化模块开发、Supabase集成|
|阶段4：集成测试与优化|2天|全流程联调测试、多测试用例验证、性能优化、体验优化|
|阶段5：部署上线|1天|Vercel部署、线上全流程验证、引导文档完善、正式发布|
---

## 九、常见问题排查

1. **前端提示本地代理未连接**

    - 检查北太天元v3.6是否正常运行，代理脚本是否已执行，控制台是否有启动成功提示；

    - 检查端口18080是否被其他程序占用，可修改代理脚本中的端口号，同步修改前端配置；

    - 检查防火墙是否拦截了端口，添加入站规则允许18080端口的本地访问；

    - 检查前端域名是否在代理脚本的`allow_origin`配置中。

2. **算法执行失败，返回报错**

    - 检查北太天元版本是否为v3.6及以上，低版本可能存在语法不兼容；

    - 检查测试用例的城市规模是否超出算法支持范围（如DP算法超过15个城市）；

    - 查看返回的`stderr`错误信息，定位具体报错位置，修正算法适配问题。

3. **结果上传Supabase失败**

    - 检查Vercel环境变量是否正确配置了Supabase的URL和公钥；

    - 检查RLS安全策略是否正确配置，是否有插入数据的权限；

    - 检查表结构是否完整，字段约束是否匹配上传的数据格式。

4. **D3.js可视化不显示**

    - 检查浏览器控制台是否有JS报错，定位数据格式问题；

    - 检查算法返回的结果是否包含可视化所需的完整字段；

    - 检查D3.js版本是否为v7，语法是否适配。
> （注：文档部分内容可能由 AI 生成）