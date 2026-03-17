import axios from 'axios';
import * as d3 from 'd3';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const EDGE_FUNCTION_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/solve-tsp` : null;
const supabase = (SUPABASE_URL && SUPABASE_ANON_KEY) ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

let currentSection = 'home-section';
let calculationResults = [];

window.addEventListener('DOMContentLoaded', () => {
  initializeApp();
  loadSharedSolutionFromUrl();
});

function initializeApp() {
  setupNavigation();
  setupEventListeners();
  setupVisualizationTabs();
  setupAlgorithmParameters();
}

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

  document.querySelectorAll('[data-case-id]').forEach(element => {
    element.querySelector('button').addEventListener('click', () => {
      const caseId = element.dataset.caseId;
      document.getElementById('test-case-select').value = caseId;
      showSection('solve-section');
    });
  });
}

function showSection(sectionId) {
  document.querySelectorAll('main > section').forEach(section => {
    section.classList.add('hidden');
  });
  
  document.getElementById(sectionId).classList.remove('hidden');
  currentSection = sectionId;
  
  if (sectionId === 'history-section') {
    loadHistoryRecords();
  }
  
  if (sectionId === 'compare-section') {
    initCompareChart();
  }
}

function setupEventListeners() {
  document.getElementById('start-calculation').addEventListener('click', startCalculation);
  document.getElementById('stop-calculation').addEventListener('click', stopCalculation);
  document.getElementById('reset-params').addEventListener('click', resetParameters);
  document.getElementById('save-result').addEventListener('click', saveResult);
  document.getElementById('close-modal').addEventListener('click', closeModal);
  document.getElementById('close-modal-btn').addEventListener('click', closeModal);
  document.getElementById('share-result-btn').addEventListener('click', shareResult);
  document.getElementById('compare-case-select').addEventListener('change', initCompareChart);
}

async function loadSharedSolutionFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const solutionId = params.get('solution');
    if (!solutionId) return;

    if (!supabase) {
      alert('未配置 Supabase：无法加载分享结果。请在 .env 中设置 VITE_SUPABASE_URL 与 VITE_SUPABASE_ANON_KEY');
      return;
    }

    const { data: sol, error: solError } = await supabase
      .from('route_solutions')
      .select('solution_id, case_id, algorithm, total_cost, total_time, exec_time, reliability, route_sequence, is_public, created_at')
      .eq('solution_id', solutionId)
      .single();
    if (solError) throw solError;

    const { data: nodes, error: nodesError } = await supabase
      .from('route_nodes')
      .select('city_id, visit_order, arrival_time, departure_time, weather_condition')
      .eq('solution_id', solutionId)
      .order('visit_order', { ascending: true });
    if (nodesError) throw nodesError;

    const bestPath = Array.isArray(sol.route_sequence) ? sol.route_sequence : (sol.route_sequence || []);
    const resultData = {
      algorithm: sol.algorithm,
      total_cost: sol.total_cost,
      total_time: sol.total_time,
      exec_time: sol.exec_time,
      reliability: sol.reliability,
      best_path: bestPath,
      nodes: nodes || [],
      solution_id: sol.solution_id,
      case_id: sol.case_id,
      is_public: sol.is_public
    };

    try {
      const testCaseSelect = document.getElementById('test-case-select');
      if (testCaseSelect && sol.case_id != null) testCaseSelect.value = String(sol.case_id);
    } catch {}

    calculationResults = [{ algorithm: sol.algorithm, ...resultData, path: bestPath, solution_id: sol.solution_id }];
    showSection('solve-section');
    updateVisualization(sol.algorithm, resultData);
    showResultModal();
  } catch (e) {
    console.error('加载分享结果失败:', e);
    alert(`加载分享结果失败：${e?.message || String(e)}`);
  }
}

function setupVisualizationTabs() {
  const tabs = document.querySelectorAll('[data-tab]');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.className = 'px-3 py-1 bg-gray-200 text-gray-700 rounded text-sm hover:bg-gray-300');
      tab.className = 'px-3 py-1 bg-primary text-white rounded text-sm';
      
      document.getElementById('path-visualization').classList.add('hidden');
      document.getElementById('process-visualization').classList.add('hidden');
      document.getElementById('metrics-visualization').classList.add('hidden');
      
      const tabId = tab.dataset.tab;
      document.getElementById(`${tabId}-visualization`).classList.remove('hidden');
      
      if (tabId === 'metrics' && calculationResults.length > 0) {
        initMetricsChart();
      }
    });
  });
}

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

async function startCalculation() {
  if (!EDGE_FUNCTION_URL) {
    alert('未配置 Supabase：请在 .env 中设置 VITE_SUPABASE_URL 与 VITE_SUPABASE_ANON_KEY');
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
    pop_size: parseInt(document.getElementById('population-size').value),
    max_generations: parseInt(document.getElementById('max-generations').value),
    mutation_rate: parseFloat(document.getElementById('mutation-rate').value)
  };
  
  document.getElementById('loading-overlay').classList.remove('hidden');
  document.getElementById('execution-log').innerHTML = '<p class="text-gray-600">开始计算...</p>';
  
  calculationResults = [];
  
  for (const algorithm of selectedAlgorithms) {
    try {
      const problemData = await getProblemData(testCaseId);
      const params = algorithm === 'GA' ? gaParams : {};
      
      log(`执行 ${algorithm} 算法...`);
      const result = await runTSPAlgorithm(algorithm, problemData, params, testCaseId);
      
      if (result.code === 200) {
        calculationResults.push({ algorithm, ...result.data, path: result.data.best_path, solution_id: result.data.solution_id });
        log(`${algorithm} 算法执行成功`);
        updateVisualization(algorithm, result.data);
      } else {
        log(`${algorithm} 算法执行失败: ${result.msg}`);
      }
    } catch (error) {
      log(`${algorithm} 算法执行异常: ${error.message}`);
    }
  }
  
  document.getElementById('loading-overlay').classList.add('hidden');
  
  if (calculationResults.length > 0) {
    showResultModal();
  }
}

function stopCalculation() {
  log('计算已停止');
}

function resetParameters() {
  document.getElementById('population-size').value = 50;
  document.getElementById('population-size-value').textContent = '50';
  document.getElementById('max-generations').value = 100;
  document.getElementById('max-generations-value').textContent = '100';
  document.getElementById('mutation-rate').value = 0.1;
  document.getElementById('mutation-rate-value').textContent = '0.1';
  
  log('参数已重置');
}

async function saveResult() {
  if (calculationResults.length === 0) {
    alert('请先执行算法计算');
    return;
  }

  // 纯云端链路：solve-tsp Edge Function 已在云端写入 route_solutions / route_nodes。
  // 此按钮的含义调整为“设为公开（可被历史记录读取/可分享）”。
  if (!supabase) {
    alert('未配置 Supabase：请在 .env 中设置 VITE_SUPABASE_URL 与 VITE_SUPABASE_ANON_KEY');
    return;
  }

  const missing = calculationResults.filter(r => !r.solution_id);
  if (missing.length > 0) {
    alert('当前结果缺少 solution_id（请先重新计算，或确认 Edge Function 已返回 solution_id）');
    return;
  }

  let allOk = true;
  for (const r of calculationResults) {
    try {
      const { error } = await supabase
        .from('route_solutions')
        .update({ is_public: true })
        .eq('solution_id', r.solution_id);
      if (error) throw error;
      log(`结果已设为公开，ID: ${r.solution_id}`);
    } catch (e) {
      allOk = false;
      log(`设置公开失败: ${e?.message || String(e)}`);
    }
  }

  alert(allOk ? '已设为公开，可在历史记录查看并分享' : '部分设置失败，请查看日志');
}

function shareResult() {
  if (calculationResults.length === 0) {
    alert('请先执行算法计算');
    return;
  }
  
  if (calculationResults[0].solution_id) {
    const shareUrl = `${window.location.origin}?solution=${calculationResults[0].solution_id}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
      alert('分享链接已复制到剪贴板');
    }).catch(err => {
      console.error('复制失败:', err);
      alert('复制失败，请手动复制链接');
    });
  } else {
    alert('请先计算并确保返回 solution_id；如需公开请点击“保存结果（设为公开）”');
  }
}

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

function closeModal() {
  document.getElementById('result-modal').classList.add('hidden');
}

async function getProblemData(testCaseId) {
  return {
    cities: [
      { city_id: 1, city_name: '北京', latitude: 39.9042, longitude: 116.4074, min_visits: 1 },
      { city_id: 2, city_name: '上海', latitude: 31.2304, longitude: 121.4737, min_visits: 1 },
      { city_id: 3, city_name: '广州', latitude: 23.1291, longitude: 113.2644, min_visits: 1 },
      { city_id: 4, city_name: '深圳', latitude: 22.5431, longitude: 114.0579, min_visits: 1 },
      { city_id: 5, city_name: '成都', latitude: 30.5728, longitude: 104.0668, min_visits: 1 }
    ],
    time_windows: [],
    weather_data: [],
    road_segments: [
      { segment_id: 1, start_city_id: 1, end_city_id: 2, distance: 1318, road_type: 'highway', speed_limit: 120 },
      { segment_id: 2, start_city_id: 2, end_city_id: 3, distance: 1433, road_type: 'highway', speed_limit: 120 },
      { segment_id: 3, start_city_id: 3, end_city_id: 4, distance: 108, road_type: 'highway', speed_limit: 100 },
      { segment_id: 4, start_city_id: 4, end_city_id: 5, distance: 1412, road_type: 'highway', speed_limit: 120 },
      { segment_id: 5, start_city_id: 5, end_city_id: 1, distance: 1814, road_type: 'highway', speed_limit: 120 }
    ]
  };
}

async function runTSPAlgorithm(algorithm, problemData, params, caseId) {
  try {
    const res = await axios.post(EDGE_FUNCTION_URL, {
      case_id: parseInt(caseId),
      algorithm,
      cities: problemData.cities,
      time_windows: problemData.time_windows,
      weather_data: problemData.weather_data,
      road_segments: problemData.road_segments,
      params
    }, { timeout: 120000 });
    return res.data;
  } catch (e) {
    return { code: 500, msg: '请求失败', error: e.message };
  }
}

async function loadHistoryRecords() {
  if (!supabase) {
    console.error('Supabase 未配置，无法加载历史记录');
    return;
  }
  try {
    const { data, error } = await supabase
      .from('route_solutions')
      .select('solution_id, case_id, algorithm, total_cost, total_time, exec_time, reliability, is_public, created_at')
      .eq('is_public', true)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;

    const tableBody = document.getElementById('history-table-body');
    if (data.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="7" class="px-6 py-4 text-center text-gray-500">暂无历史记录</td></tr>';
      return;
    }

    tableBody.innerHTML = data.map(record => `
      <tr>
        <td class="px-6 py-4">${record.case_id}</td>
        <td class="px-6 py-4">${record.algorithm}</td>
        <td class="px-6 py-4">${record.total_cost.toFixed(2)}</td>
        <td class="px-6 py-4">${record.total_time.toFixed(2)}</td>
        <td class="px-6 py-4">${record.exec_time.toFixed(2)} ms</td>
        <td class="px-6 py-4">${record.reliability ? record.reliability.toFixed(2) : 'N/A'}</td>
        <td class="px-6 py-4">
          <button class="text-primary hover:underline" onclick="navigator.clipboard.writeText('${window.location.origin}?solution=${record.solution_id}'); alert('分享链接已复制')">复制分享链接</button>
        </td>
      </tr>
    `).join('');
  } catch (error) {
    console.error('加载历史记录失败:', error);
  }
}

function updateVisualization(algorithm, data) {
  updatePathVisualization(data.best_path || data.path, data.nodes);
  
  if (algorithm === 'GA' && data.process_data?.iteration_process) {
    updateGAProcessVisualization(data.process_data.iteration_process);
  } else if (algorithm === 'A*' && data.process_data?.search_process) {
    updateAStarProcessVisualization(data.process_data.search_process);
  } else if (algorithm === 'DP' && data.process_data?.dp_table) {
    updateDPProcessVisualization(data.process_data.dp_table);
  }
}

function updatePathVisualization(path, nodes) {
  const svg = d3.select('#path-svg');
  svg.selectAll('*').remove();
  
  const width = svg.node().clientWidth;
  const height = svg.node().clientHeight;
  
  const cities = [
    { id: 0, name: '北京', x: 100, y: 100 },
    { id: 1, name: '上海', x: 300, y: 150 },
    { id: 2, name: '广州', x: 250, y: 300 },
    { id: 3, name: '深圳', x: 300, y: 350 },
    { id: 4, name: '成都', x: 50, y: 200 }
  ];
  
  const line = d3.line()
    .x(d => cities.find(c => c.id === d).x)
    .y(d => cities.find(c => c.id === d).y);
  
  svg.append('path')
    .datum(path)
    .attr('fill', 'none')
    .attr('stroke', '#3b82f6')
    .attr('stroke-width', 2)
    .attr('d', line);
  
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

function updateGAProcessVisualization(iterationData) {
  const svg = d3.select('#process-svg');
  svg.selectAll('*').remove();
  
  const width = svg.node().clientWidth;
  const height = svg.node().clientHeight;
  
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
  
  svg.append('g')
    .attr('transform', `translate(0, ${height - 50})`)
    .call(d3.axisBottom(x));
  
  svg.append('g')
    .attr('transform', 'translate(50, 0)')
    .call(d3.axisLeft(y));
}

function updateAStarProcessVisualization(searchProcess) {
  const svg = d3.select('#process-svg');
  svg.selectAll('*').remove();
  
  const width = svg.node().clientWidth;
  const height = svg.node().clientHeight;
  
  svg.append('text')
    .attr('x', width / 2)
    .attr('y', height / 2)
    .text('A* 搜索过程可视化')
    .attr('text-anchor', 'middle')
    .attr('font-size', '16px');
}

function updateDPProcessVisualization(stateProcess) {
  const svg = d3.select('#process-svg');
  svg.selectAll('*').remove();
  
  const width = svg.node().clientWidth;
  const height = svg.node().clientHeight;
  
  svg.append('text')
    .attr('x', width / 2)
    .attr('y', height / 2)
    .text('动态规划状态转移可视化')
    .attr('text-anchor', 'middle')
    .attr('font-size', '16px');
}

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

function initCompareChart() {
  const ctx = document.getElementById('compare-chart').getContext('2d');
  const caseId = document.getElementById('compare-case-select').value;
  
  if (window.compareChart) {
    window.compareChart.destroy();
  }
  
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

function log(message) {
  const logElement = document.getElementById('execution-log');
  const p = document.createElement('p');
  p.className = 'text-gray-600';
  p.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logElement.appendChild(p);
  logElement.scrollTop = logElement.scrollHeight;
}
