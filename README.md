# 天气感知型 TSP 求解系统

## 项目概述

天气感知型 TSP 求解系统是一个基于北太天元v3.6的路径规划工具，采用「公网静态前端 + 用户本地北太天元计算」的创新架构，实现了考虑天气因素对旅行时间影响的TSP问题求解。

### 核心功能
- 支持3种TSP求解算法：动态规划（DP）、A*、遗传算法（GA）
- 考虑天气因素对旅行时间的影响
- 支持时间窗口约束
- 公网前端托管于Vercel，提供美观的可视化界面
- 本地代理服务，驱动北太天元执行算法计算
- 结果持久化到Supabase数据库，支持分享和对比

### 技术架构
- **公网前端层**：Vercel静态托管 + HTML5/CSS3/JS + D3.js v7
- **数据持久层**：Supabase (PostgreSQL 15+)
- **本地代理层**：北太天元v3.6原生.m脚本（内嵌Python HTTP服务）
- **核心计算层**：北太天元v3.6

## 目录结构

```
project/
├── frontend/        # 前端代码
│   ├── src/         # 源代码
│   ├── index.html   # 主页面
│   ├── package.json # 项目配置
│   └── vite.config.js # Vite配置
├── proxy/           # 北太天元本地代理脚本
│   └── baltamatica_tsp_proxy.m # 代理服务脚本
├── data/            # 示例数据
│   ├── cities.csv   # 城市数据
│   ├── road_segments.csv # 路段数据
│   └── test_cases.csv # 测试用例数据
├── scripts/         # 脚本文件
│   ├── supabase_init.sql # 数据库初始化脚本
│   └── data_importer.py # 数据导入工具
└── docs/            # 文档
    └── 使用教程.md   # 使用教程
```

## 快速开始

### 1. 环境准备
- 北太天元v3.6
- Node.js 18+
- Python 3.8+
- Supabase账号
- Vercel账号
- GitHub账号

### 2. 数据库初始化
1. 创建Supabase项目
2. 执行 `scripts/supabase_init.sql` 初始化数据库
3. 配置环境变量（复制 `.env.example` 为 `.env` 并填写）

### 3. 本地代理配置
1. 在北太天元v3.6中打开 `proxy/baltamatica_tsp_proxy.m`
2. 修改 `allow_origin` 配置，添加你的前端域名
3. 运行脚本启动代理服务

### 4. 前端部署
1. 安装依赖：`npm install`
2. 构建项目：`npm run build`
3. 部署到Vercel

### 5. 数据导入
```bash
python scripts/data_importer.py --url 你的Supabase URL --key 你的服务密钥 --cities data/cities.csv --segments data/road_segments.csv --test-cases data/test_cases.csv
```

## 使用指南

1. 启动本地代理服务
2. 访问前端网站
3. 选择测试用例和算法
4. 点击开始计算
5. 查看可视化结果
6. 保存和分享结果

详细使用教程请参考 `docs/使用教程.md`。

## 算法选择

| 算法 | 适用规模 | 特点 |
|------|----------|------|
| 动态规划(DP) | ≤15个城市 | 全局最优解 |
| A*算法 | 10-30个城市 | 兼顾速度和最优性 |
| 遗传算法(GA) | 30-100个城市 | 适合大规模问题 |

## 安全注意事项

- 本地代理仅监听 `127.0.0.1`，禁止修改为 `0.0.0.0`
- 严格配置CORS跨域规则
- 所有计算在本地执行，符合北太天元授权协议

## 许可证

本项目仅供学习和科研用途，禁止商用。

## 联系方式

如有问题，请参考使用教程或联系项目维护者。