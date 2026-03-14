import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import * as d3 from 'd3';

// 配置项
const PROXY_BASE_URL = 'http://127.0.0.1:18080';

// 初始化Supabase客户端
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL || 'https://your-project.supabase.co',
  import.meta.env.VITE_SUPABASE_ANON_KEY || 'your-anon-key'
);

// 全局变量
let currentSection = 'home-section';
let connectionStatus = false;
let calculationResults = [];

// 页面加载完成后初始化
window.addEventListener('DOMContentLoaded', () => {
  initializeApp();
});

function initializeApp() {
  setupNavigation();
  setupEventListeners();
  checkProxyConnection();
  setupVisualizationTabs();
  setupAlgorithmParameters();
}

// 设置导航
function setupNavigation() {
  const navLinks = {
    'nav-home': 'home-section',
    'nav-solve': 'solve-section',
    'nav-compare': 'compare-section',
    'nav-history': 'history-section',
    'nav-help': 'help-section'
  };

  Object.entries(navLinks).forEach(([navId, sectionId]) => {
    document.getElementById(navId).addEventListener('click', (e) => {
      e.preventDefault();
      showSection(sectionId);
    });
  });

  // 测试用例选择
  document.querySelectorAll('[data-case-id]').forEach(element => {
    element.querySelector('button').addEventListener('click', () => {
      const caseId = element.dataset.caseId;
      document.getElementById('test-case-select').value = caseId;
      showSection('solve-section');
    });
  });
}

// 显示指定 section
function showSection(sectionId) {
  // 隐藏所有 section
  document.querySelectorAll('main > section').forEach(section => {
    section.classList.add('hidden');
  });
  
  // 显示目标 section
  document.getElementById(sectionId).classList.remove('hidden');
  currentSection = sectionId;
  
  // 如果切换到历史记录页，加载历史数据
  if (sectionId === 'history-section') {
    loadHistoryRecords();
  }
  
  // 如果切换到对比页，初始化对比图表
  if (sectionId === 'compare-section') {
    initCompareChart();
  }
}

// 设置事件监听器
function setupEventListeners() {
  // 连接检测按钮
  document.getElementById('check-connection').addEventListener('click', checkProxyConnection);
  document.getElementById('refresh-connection').addEventListener('click', checkProxyConnection);
  
  // 开始计算按钮
  document.getElementById('start-calculation').addEventListener('click', startCalculation);
  
  // 停止计算按钮
  document.getElementById('stop-calculation').addEventListener('click', stopCalculation);
  
  // 重置参数按钮
  document.getElementById('reset-params').addEventListener('click', resetParameters);
  
  // 保存结果按钮
  document.getElementById('save-result').addEventListener('click', saveResult);
  
  // 关闭模态框按钮
  document.getElementById('close-modal').addEventListener('click', closeModal);
  document.getElementById('close-modal-btn').addEventListener('click', closeModal);
  
  // 分享结果按钮
  document.getElementById('share-result-btn').addEventListener('click', shareResult);
  
  // 对比页面测试用例选择
  document.getElementById('compare-case-select').addEventListener('change', initCompareChart);
}

// 检测本地代理连接
async function checkProxyConnection() {
  try {
    const res = await axios.get(`${PROXY_BASE_URL}/health`, { timeout: 3000 });
    if (res.data.status === 'running') {
      connectionStatus = true;
      updateConnectionStatus(true, res.data.version);
    } else {
      connectionStatus = false;
      updateConnectionStatus(false);
    }
  } catch (e) {
    connectionStatus = false;
    updateConnectionStatus(false, e.message);
  }
}

// 更新连接状态显示
function updateConnectionStatus(connected, message = '') {
  const indicator = document.getElementById('status-indicator');
  const text = document.getElementById('status-text');
  
  if (connected) {
    indicator.className = 'h-3 w-3 rounded-full bg-green-500';
    text.textContent = '已连接';
    text.className = 'text-sm text-green-600';
  } else {
    indicator.className = 'h-3 w-3 rounded-full bg-red-500';
    text.textContent = message ? `未连接: ${message}` : '未连接';
    text.className = 'text-sm text-red-600';
  }
}

// 设置可视化标签页
function setupVisualizationTabs() {
  const tabs = document.querySelectorAll('[data-tab]');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // 移除所有标签页的激活状态
      tabs.forEach(t => t.className = 'px-3 py-1 bg-gray-200 text-gray-700 rounded text-sm hover:bg-gray-300');
      
      // 激活当前标签页
      tab.className = 'px-3 py-1 bg-primary text-white rounded text-sm';
      
      // 隐藏所有可视化内容
      document.getElementById('path-visualization').classList.add('hidden');
      document.getElementById('process-visualization').classList.add('hidden');
      document.getElementById('metrics-visualization').classList.add('hidden');
      
      // 显示对应内容
      const tabId = tab.dataset.tab;
      document.getElementById(`${tabId}-visualization`).classList.remove('hidden');
      
      // 如果切换到指标页，初始化图表
      if (tabId === 'metrics' && calculationResults.length > 0) {
        initMetricsChart();
      }
    });
  });
}

// 设置算法参数滑块
function setupAlgorithmParameters() {
  const sliders = [
    { id: 'population-size', valueId: 'population-size-value' },
    { id: 'max-generations', valueId: 'max-generations-value' },
    { id: 'mutation-rate', valueId: 'mutation-rate-value' }
  ];
  
  sliders.forEach(({ id, valueId }) => {
    const slider = document.getElementById(id);
    const valueDisplay = document.getElementById(valueId);
    
    slider.addEventListener('input', () => {
      valueDisplay.textContent = slider.value;
    });
  });
}

// 开始计算
async function startCalculation() {
  if (!connectionStatus) {
    alert('请先连接本地代理服务');
    return;
  }
  
  const selectedAlgorithms = Array.from(document.querySelectorAll('.algorithm-checkbox:checked'))
    .map(checkbox => checkbox.value);
  
  if (selectedAlgorithms.length === 0) {
    alert('请至少选择一种算法');
    return;
  }
  
  const testCaseId = document.getElementById('test-case-select').value;
  const gaParams = {
    population_size: parseInt(document.getElementById('population-size').value),
    max_generations: parseInt(document.getElementById('max-generations').value),
    mutation_rate: parseFloat(document.getElementById('mutation-rate').value)
  };
  
  // 显示加载动画
  document.getElementById('loading-overlay').classList.remove('hidden');
  
  // 清空日志
  document.getElementById('execution-log').innerHTML = '<p class="text-gray-600">开始计算...</p>';
  
  calculationResults = [];
  
  // 逐个执行算法
  for (const algorithm of selectedAlgorithms) {
    try {
      const problemData = await getProblemData(testCaseId);
      const params = algorithm === 'GA' ? gaParams : {};
      
      log(`执行 ${algorithm} 算法...`);
      const result = await runTSPAlgorithm(algorithm, problemData, params);
      
      if (result.code === 200) {
        calculationResults.push({ algorithm, ...result.data });
        log(`${algorithm} 算法执行成功`);
        
        // 实时更新可视化
        updateVisualization(algorithm, result.data);
      } else {
        log(`${algorithm} 算法执行失败: ${result.msg}`);
      }
    } catch (error) {
      log(`${algorithm} 算法执行异常: ${error.message}`);
    }
  }
  
  // 隐藏加载动画
  document.getElementById('loading-overlay').classList.add('hidden');
  
  // 显示结果
  if (calculationResults.length > 0) {
    showResultModal();
  }
}

// 停止计算
function stopCalculation() {
  // 这里可以实现停止计算的逻辑
  log('计算已停止');
}

// 重置参数
function resetParameters() {
  document.getElementById('population-size').value = 50;
  document.getElementById('population-size-value').textContent = '50';
  document.getElementById('max-generations').value = 100;
  document.getElementById('max-generations-value').textContent = '100';
  document.getElementById('mutation-rate').value = 0.1;
  document.getElementById('mutation-rate-value').textContent = '0.1';
  
  log('参数已重置');
}

// 保存结果
async function saveResult() {
  if (calculationResults.length === 0) {
    alert('请先执行算法计算');
    return;
  }
  
  const testCaseId = document.getElementById('test-case-select').value;
  let allSaved = true;
  
  for (let i = 0; i < calculationResults.length; i++) {
    try {
      const result = calculationResults[i];
      const solutionId = await uploadSolutionResult(testCaseId, result.algorithm, result);
      // 更新计算结果，添加solution_id
      calculationResults[i].solution_id = solutionId;
      log(`结果已保存，ID: ${solutionId}`);
    } catch (error) {
      log(`保存结果失败: ${error.message}`);
      allSaved = false;
    }
  }
  
  if (allSaved) {
    alert('结果保存成功');
  } else {
    alert('部分结果保存失败，请查看日志');
  }
}

// 分享结果
function shareResult() {
  if (calculationResults.length === 0) {
    alert('请先执行算法计算');
    return;
  }
  
  // 检查是否有保存的solution_id
  if (calculationResults[0].solution_id) {
    // 生成分享链接
    const shareUrl = `${window.location.origin}?solution=${calculationResults[0].solution_id}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
      alert('分享链接已复制到剪贴板');
    }).catch(err => {
      console.error('复制失败:', err);
      alert('复制失败，请手动复制链接');
    });
  } else {
    alert('请先保存结果后再分享');
  }
}

// 显示结果模态框
function showResultModal() {
  const modal = document.getElementById('result-modal');
  const content = document.getElementById('result-content');
  
  let resultHtml = '<div class="space-y-4">';
  
  calculationResults.forEach(result => {
    resultHtml += `
      <div class="border rounded-lg p-4">
        <h4 class="font-semibold text-primary">${result.algorithm} 算法</h4>
        <div class="grid grid-cols-2 gap-2 mt-2">
          <div><span class="text-gray-600">总成本:</span> ${result.total_cost.toFixed(2)}</div>
          <div><span class="text-gray-600">总时间:</span> ${result.total_time.toFixed(2)} 分钟</div>
          <div><span class="text-gray-600">执行耗时:</span> ${result.exec_time.toFixed(2)} ms</div>
          <div><span class="text-gray-600">可靠性:</span> ${result.reliability ? result.reliability.toFixed(2) : 'N/A'}</div>
        </div>
        <div class="mt-2">
          <span class="text-gray-600">路径:</span> ${result.path.join(' → ')}
        </div>
      </div>
    `;
  });
  
  resultHtml += '</div>';
  content.innerHTML = resultHtml;
  modal.classList.remove('hidden');
}

// 关闭模态框
function closeModal() {
  document.getElementById('result-modal').classList.add('hidden');
}

// 获取问题数据
async function getProblemData(testCaseId) {
  // 这里可以从Supabase获取数据，现在返回模拟数据
  return {
    cities: [
      { city_id: 1, name: '北京', latitude: 39.9042, longitude: 116.4074 },
      { city_id: 2, name: '上海', latitude: 31.2304, longitude: 121.4737 },
      { city_id: 3, name: '广州', latitude: 23.1291, longitude: 113.2644 },
      { city_id: 4, name: '深圳', latitude: 22.5431, longitude: 114.0579 },
      { city_id: 5, name: '成都', latitude: 30.5728, longitude: 104.0668 }
    ],
    time_windows: [],
    weather_data: [],
    road_segments: [
      { segment_id: 1, start_city_id: 1, end_city_id: 2, distance: 1318, speed_limit: 120 },
      { segment_id: 2, start_city_id: 2, end_city_id: 3, distance: 1433, speed_limit: 120 },
      { segment_id: 3, start_city_id: 3, end_city_id: 4, distance: 108, speed_limit: 100 },
      { segment_id: 4, start_city_id: 4, end_city_id: 5, distance: 1412, speed_limit: 120 },
      { segment_id: 5, start_city_id: 5, end_city_id: 1, distance: 1814, speed_limit: 120 }
    ]
  };
}

// 调用本地代理执行算法
async function runTSPAlgorithm(algorithm, problemData, params) {
  try {
    const res = await axios.post(`${PROXY_BASE_URL}/run`, {
      algorithm,
      problem_data: problemData,
      params
    }, { timeout: 120000 });
    return res.data;
  } catch (e) {
    return { code: 500, msg: '请求失败', error: e.message };
  }
}

// 上传结果到Supabase
async function uploadSolutionResult(caseId, algorithm, resultData) {
  try {
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

    if (resultData.nodes) {
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
    }

    return solution.solution_id;
  } catch (error) {
    console.error('上传结果失败:', error);
    throw error;
  }
}

// 加载历史记录
async function loadHistoryRecords() {
  try {
    const { data, error } = await supabase
      .from('route_solutions')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const tableBody = document.getElementById('history-table-body');
    if (data.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="7" class="px-6 py-4 text-center text-gray-500">暂无历史记录</td></tr>';
      return;
    }

    tableBody.innerHTML = data.map(record => `
      <tr>
        <td class="px-6 py-4">测试用例 ${record.case_id}</td>
        <td class="px-6 py-4">${record.algorithm}</td>
        <td class="px-6 py-4">${record.total_cost.toFixed(2)}</td>
        <td class="px-6 py-4">${record.total_time.toFixed(2)}</td>
        <td class="px-6 py-4">${record.exec_time.toFixed(2)} ms</td>
        <td class="px-6 py-4">${record.reliability ? record.reliability.toFixed(2) : 'N/A'}</td>
        <td class="px-6 py-4">
          <button class="text-primary hover:underline">查看</button>
          ${record.is_public ? '<button class="text-green-600 hover:underline ml-2">已分享</button>' : '<button class="text-primary hover:underline ml-2">分享</button>'}
        </td>
      </tr>
    `).join('');
  } catch (error) {
    console.error('加载历史记录失败:', error);
  }
}

// 更新可视化
function updateVisualization(algorithm, data) {
  // 路径可视化
  updatePathVisualization(data.path, data.nodes);
  
  // 执行过程可视化
  if (algorithm === 'GA' && data.iteration_process) {
    updateGAProcessVisualization(data.iteration_process);
  } else if (algorithm === 'A*' && data.search_process) {
    updateAStarProcessVisualization(data.search_process);
  } else if (algorithm === 'DP' && data.state_process) {
    updateDPProcessVisualization(data.state_process);
  }
}

// 更新路径可视化
function updatePathVisualization(path, nodes) {
  const svg = d3.select('#path-svg');
  svg.selectAll('*').remove();
  
  const width = svg.node().clientWidth;
  const height = svg.node().clientHeight;
  
  // 简单的路径绘制
  const cities = [
    { id: 1, name: '北京', x: 100, y: 100 },
    { id: 2, name: '上海', x: 300, y: 150 },
    { id: 3, name: '广州', x: 250, y: 300 },
    { id: 4, name: '深圳', x: 300, y: 350 },
    { id: 5, name: '成都', x: 50, y: 200 }
  ];
  
  // 绘制路径
  const line = d3.line()
    .x(d => cities.find(c => c.id === d).x)
    .y(d => cities.find(c => c.id === d).y);
  
  svg.append('path')
    .datum(path)
    .attr('fill', 'none')
    .attr('stroke', '#3b82f6')
    .attr('stroke-width', 2)
    .attr('d', line);
  
  // 绘制城市节点
  cities.forEach(city => {
    svg.append('circle')
      .attr('cx', city.x)
      .attr('cy', city.y)
      .attr('r', 8)
      .attr('fill', '#3b82f6');
    
    svg.append('text')
      .attr('x', city.x + 12)
      .attr('y', city.y + 4)
      .text(city.name)
      .attr('font-size', '12px');
  });
}

// 更新GA执行过程可视化
function updateGAProcessVisualization(iterationData) {
  const svg = d3.select('#process-svg');
  svg.selectAll('*').remove();
  
  const width = svg.node().clientWidth;
  const height = svg.node().clientHeight;
  
  // 绘制收敛曲线
  const x = d3.scaleLinear()
    .domain([0, iterationData.length])
    .range([50, width - 50]);
  
  const y = d3.scaleLinear()
    .domain([d3.min(iterationData, d => d[1]), d3.max(iterationData, d => d[1])])
    .range([height - 50, 50]);
  
  const line = d3.line()
    .x((d, i) => x(i))
    .y(d => y(d[1]));
  
  svg.append('path')
    .datum(iterationData)
    .attr('fill', 'none')
    .attr('stroke', '#10b981')
    .attr('stroke-width', 2)
    .attr('d', line);
  
  // 添加坐标轴
  svg.append('g')
    .attr('transform', `translate(0, ${height - 50})`)
    .call(d3.axisBottom(x));
  
  svg.append('g')
    .attr('transform', 'translate(50, 0)')
    .call(d3.axisLeft(y));
}

// 更新A*执行过程可视化
function updateAStarProcessVisualization(searchProcess) {
  const svg = d3.select('#process-svg');
  svg.selectAll('*').remove();
  
  // 简单的搜索过程可视化
  const width = svg.node().clientWidth;
  const height = svg.node().clientHeight;
  
  svg.append('text')
    .attr('x', width / 2)
    .attr('y', height / 2)
    .text('A* 搜索过程可视化')
    .attr('text-anchor', 'middle')
    .attr('font-size', '16px');
}

// 更新DP执行过程可视化
function updateDPProcessVisualization(stateProcess) {
  const svg = d3.select('#process-svg');
  svg.selectAll('*').remove();
  
  // 简单的状态转移可视化
  const width = svg.node().clientWidth;
  const height = svg.node().clientHeight;
  
  svg.append('text')
    .attr('x', width / 2)
    .attr('y', height / 2)
    .text('动态规划状态转移可视化')
    .attr('text-anchor', 'middle')
    .attr('font-size', '16px');
}

// 初始化指标图表
function initMetricsChart() {
  const ctx = document.getElementById('metrics-chart').getContext('2d');
  
  if (window.metricsChart) {
    window.metricsChart.destroy();
  }
  
  const algorithms = calculationResults.map(r => r.algorithm);
  const costs = calculationResults.map(r => r.total_cost);
  const times = calculationResults.map(r => r.total_time);
  const execTimes = calculationResults.map(r => r.exec_time);
  
  window.metricsChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: algorithms,
      datasets: [
        {
          label: '总成本',
          data: costs,
          backgroundColor: 'rgba(59, 130, 246, 0.6)'
        },
        {
          label: '总时间 (分钟)',
          data: times,
          backgroundColor: 'rgba(16, 185, 129, 0.6)'
        },
        {
          label: '执行耗时 (ms)',
          data: execTimes,
          backgroundColor: 'rgba(139, 92, 246, 0.6)'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false
    }
  });
}

// 初始化对比图表
function initCompareChart() {
  const ctx = document.getElementById('compare-chart').getContext('2d');
  const caseId = document.getElementById('compare-case-select').value;
  
  if (window.compareChart) {
    window.compareChart.destroy();
  }
  
  // 模拟数据
  const algorithms = ['DP', 'A*', 'GA'];
  const costs = [1250, 1320, 1450];
  const times = [320, 350, 380];
  const execTimes = [150, 250, 500];
  
  window.compareChart = new Chart(ctx, {
    type: 'radar',
    data: {
      labels: ['总成本', '总时间', '执行速度', '可靠性'],
      datasets: [
        {
          label: 'DP',
          data: [1250, 320, 150, 0.95],
          borderColor: 'rgba(59, 130, 246, 1)',
          backgroundColor: 'rgba(59, 130, 246, 0.2)'
        },
        {
          label: 'A*',
          data: [1320, 350, 250, 0.92],
          borderColor: 'rgba(16, 185, 129, 1)',
          backgroundColor: 'rgba(16, 185, 129, 0.2)'
        },
        {
          label: 'GA',
          data: [1450, 380, 500, 0.88],
          borderColor: 'rgba(139, 92, 246, 1)',
          backgroundColor: 'rgba(139, 92, 246, 0.2)'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false
    }
  });
}

// 日志函数
function log(message) {
  const logElement = document.getElementById('execution-log');
  const p = document.createElement('p');
  p.className = 'text-gray-600';
  p.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logElement.appendChild(p);
  logElement.scrollTop = logElement.scrollHeight;
}

// 导出全局函数
window.checkProxyConnection = checkProxyConnection;