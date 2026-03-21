import axios from 'axios';
import * as d3 from 'd3';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const EDGE_FUNCTION_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/solve-tsp` : null;
const supabase = (SUPABASE_URL && SUPABASE_ANON_KEY) ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

let currentSection = 'home-section';
let calculationResults = [];

let __staticDataCache = null;
let __lastProblemData = null;

let __processPlayer = null;

window.addEventListener('DOMContentLoaded', () => {
  initializeApp();
  initializeStaticData().catch((e) => {
    console.error('初始化静态数据失败:', e);
  });
  loadSharedSolutionFromUrl();
});

async function initializeStaticData() {
  await loadStaticData();
  renderHomeCasePreviews();
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0]).map(h => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (cols[j] ?? '').trim();
    }
    rows.push(row);
  }
  return rows;
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

async function fetchTextOrNull(url) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function loadStaticData() {
  if (__staticDataCache) return __staticDataCache;

  const [citiesCsv, roadsCsv, casesCsv, weatherCsv] = await Promise.all([
    fetchTextOrNull('/data/cities.csv'),
    fetchTextOrNull('/data/road_segments.csv'),
    fetchTextOrNull('/data/test_cases.csv'),
    fetchTextOrNull('/data/weather_observations.csv')
  ]);

  if (!citiesCsv || !roadsCsv || !casesCsv) {
    throw new Error('缺少静态数据文件：请确认 /public/data 下存在 cities.csv / road_segments.csv / test_cases.csv');
  }

  const cities = parseCsv(citiesCsv).map(r => ({
    city_id: Number(r.city_id),
    city_name: r.city_name,
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
    min_visits: Number(r.min_visits || 1)
  }));

  const road_segments = parseCsv(roadsCsv).map(r => ({
    segment_id: Number(r.segment_id),
    start_city_id: Number(r.start_city_id),
    end_city_id: Number(r.end_city_id),
    distance: Number(r.distance),
    road_type: r.road_type,
    speed_limit: Number(r.speed_limit)
  }));

  const test_cases = parseCsv(casesCsv).map(r => ({
    case_id: String(r.case_id),
    case_name: r.case_name,
    case_scale: r.case_scale,
    city_ids: safeJsonParse(r.city_ids, []),
    description: r.description,
    is_default: String(r.is_default).toLowerCase() === 'true'
  }));

  const weather_data = weatherCsv
    ? parseCsv(weatherCsv).map(r => ({
        observation_id: Number(r.observation_id),
        city_id: Number(r.city_id),
        observation_time: r.observation_time,
        temperature: Number(r.temperature),
        precipitation: Number(r.precipitation),
        wind_speed: Number(r.wind_speed),
        visibility: Number(r.visibility),
        weather_condition: r.weather_condition
      }))
    : [];

  __staticDataCache = { cities, road_segments, test_cases, weather_data };
  return __staticDataCache;
}

function safeJsonParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

async function loadCase(caseId) {
  const data = await loadStaticData();
  const tc = data.test_cases.find(c => String(c.case_id) === String(caseId)) ?? data.test_cases[0];
  const citySet = new Set((tc?.city_ids || []).map(Number));

  const cities = data.cities.filter(c => citySet.has(Number(c.city_id)));
  const road_segments = data.road_segments.filter(s => citySet.has(s.start_city_id) && citySet.has(s.end_city_id));
  const weather_data = data.weather_data.filter(w => citySet.has(w.city_id));

  return {
    case_id: Number(tc?.case_id ?? caseId),
    case_meta: tc,
    cities,
    time_windows: [],
    weather_data,
    road_segments
  };
}

function renderHomeCasePreviews() {
  const svgs = document.querySelectorAll('svg.case-preview[data-preview-case-id]');
  if (!svgs.length) return;

  Promise.resolve(loadStaticData()).then((data) => {
    svgs.forEach((el) => {
      const caseId = el.getAttribute('data-preview-case-id');
      const tc = data.test_cases.find(c => String(c.case_id) === String(caseId));
      if (!tc) return;
      const citySet = new Set((tc.city_ids || []).map(Number));
      const cities = data.cities.filter(c => citySet.has(Number(c.city_id)));
      drawCityScatterPreview(el, cities);
    });
  }).catch((e) => console.error('渲染首页用例预览失败:', e));
}

function drawCityScatterPreview(svgEl, cities) {
  const svg = d3.select(svgEl);
  svg.selectAll('*').remove();

  const width = svgEl.clientWidth || 240;
  const height = svgEl.clientHeight || 96;
  const pad = 8;

  if (!cities || cities.length === 0) {
    svg.append('text')
      .attr('x', width / 2)
      .attr('y', height / 2)
      .attr('text-anchor', 'middle')
      .attr('font-size', 12)
      .attr('fill', '#6b7280')
      .text('无数据');
    return;
  }

  const lonExtent = d3.extent(cities, d => d.longitude);
  const latExtent = d3.extent(cities, d => d.latitude);

  const x = d3.scaleLinear().domain(lonExtent).range([pad, width - pad]);
  const y = d3.scaleLinear().domain(latExtent).range([height - pad, pad]);

  svg.append('rect')
    .attr('x', 0).attr('y', 0)
    .attr('width', width).attr('height', height)
    .attr('fill', '#ffffff');

  svg.selectAll('circle')
    .data(cities)
    .enter()
    .append('circle')
    .attr('cx', d => x(d.longitude))
    .attr('cy', d => y(d.latitude))
    .attr('r', cities.length > 50 ? 1.5 : 2.5)
    .attr('fill', '#3b82f6')
    .attr('opacity', 0.85);
}

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
  document.getElementById('compare-run-now').addEventListener('click', runCompareNow);

  document.querySelectorAll('input.algorithm-radio[name="algorithm"]').forEach((el) => {
    el.addEventListener('change', syncGAParamsVisibility);
  });
  syncGAParamsVisibility();
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
      .from('tsp_solutions')
      .select('solution_id, case_id, algorithm, total_cost, total_time, exec_time, reliability, route_sequence, nodes, is_public, created_at')
      .eq('solution_id', solutionId)
      .single();
    if (solError) throw solError;

    const bestPath = Array.isArray(sol.route_sequence) ? sol.route_sequence : (sol.route_sequence || []);
    const loadedNodes = Array.isArray(sol.nodes) ? sol.nodes : (sol.nodes || []);
    const resultData = {
      algorithm: sol.algorithm,
      total_cost: sol.total_cost,
      total_time: sol.total_time,
      exec_time: sol.exec_time,
      reliability: sol.reliability,
      best_path: bestPath,
      nodes: loadedNodes || [],
      solution_id: sol.solution_id,
      case_id: sol.case_id,
      is_public: sol.is_public
    };

    // Load static cities for this case so visualization can render properly
    try {
      const c = await loadCase(String(sol.case_id));
      __lastProblemData = {
        case_id: Number(sol.case_id),
        cities: c.cities,
        road_segments: c.road_segments,
        weather_data: c.weather_data,
        time_windows: c.time_windows
      };
    } catch (e) {
      console.warn('加载用例静态数据失败，将使用空城市列表:', e);
      __lastProblemData = null;
    }

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

      const controls = document.getElementById('process-controls');
      if (controls) controls.classList.toggle('hidden', tabId !== 'process');
      
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
  const selectedAlgorithm = document.querySelector('input.algorithm-radio[name="algorithm"]:checked')?.value;
  if (!selectedAlgorithm) {
    alert('请选择一种算法');
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

  try {
    const problemData = await getProblemData(testCaseId);
    __lastProblemData = problemData;
    const params = selectedAlgorithm === 'GA' ? gaParams : {};

    log(`执行 ${selectedAlgorithm} 算法...`);
    const result = await runTSPAlgorithm(selectedAlgorithm, problemData, params, testCaseId);

    if (result.code === 200) {
      calculationResults.push({ algorithm: selectedAlgorithm, ...result.data, path: result.data.best_path, solution_id: result.data.solution_id });
      log(`${selectedAlgorithm} 算法执行成功`);
      updateVisualization(selectedAlgorithm, result.data);
    } else {
      log(`${selectedAlgorithm} 算法执行失败: ${result.msg}`);
    }
  } catch (error) {
    log(`${selectedAlgorithm} 算法执行异常: ${error.message}`);
  }
  
  document.getElementById('loading-overlay').classList.add('hidden');
  
  if (calculationResults.length > 0) {
    showResultModal();
  }
}

function syncGAParamsVisibility() {
  const selectedAlgorithm = document.querySelector('input.algorithm-radio[name="algorithm"]:checked')?.value;
  const gaParamsEl = document.getElementById('ga-params');
  if (!gaParamsEl) return;
  gaParamsEl.classList.toggle('hidden', selectedAlgorithm !== 'GA');
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
  
  calculationResults = [];
  if (__processPlayer?.destroy) __processPlayer.destroy();
  __processPlayer = null;

  clearVisualizations();
  document.getElementById('execution-log').innerHTML = '<p class="text-gray-600">等待计算...</p>';
  closeModal();

  log('参数已重置');
}

function clearVisualizations() {
  d3.select('#path-svg').selectAll('*').remove();
  d3.select('#process-svg').selectAll('*').remove();
  if (window.metricsChart) {
    window.metricsChart.destroy();
    window.metricsChart = null;
  }
  const kpisEl = document.getElementById('metrics-kpis');
  if (kpisEl) kpisEl.innerHTML = '';
  const noteEl = document.getElementById('metrics-note');
  if (noteEl) noteEl.textContent = '';
}

async function saveResult() {
  if (calculationResults.length === 0) {
    alert('请先执行算法计算');
    return;
  }

  // 纯云端链路：solve-tsp Edge Function 已在云端写入 tsp_solutions。
  // 此按钮的含义为“设为公开（可被历史记录读取/可分享）”。
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
        .from('tsp_solutions')
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
  const c = await loadCase(testCaseId);
  return {
    case_id: c.case_id,
    cities: c.cities,
    time_windows: c.time_windows,
    weather_data: c.weather_data,
    road_segments: c.road_segments
  };
}

async function runTSPAlgorithm(algorithm, problemData, params, caseId) {
  try {
    const res = await axios.post(
      EDGE_FUNCTION_URL,
      {
        case_id: parseInt(caseId),
        algorithm,
        cities: problemData.cities,
        time_windows: problemData.time_windows,
        weather_data: problemData.weather_data,
        road_segments: problemData.road_segments,
        params
      },
      {
        timeout: 120000,
        headers: SUPABASE_ANON_KEY
          ? {
              apikey: SUPABASE_ANON_KEY,
              Authorization: `Bearer ${SUPABASE_ANON_KEY}`
            }
          : undefined
      }
    );
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
      .from('tsp_solutions')
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
          <div class="flex flex-col gap-1">
            <button class="text-primary hover:underline text-left" data-action="load-solution" data-solution-id="${record.solution_id}">加载并复现</button>
            <button class="text-primary hover:underline text-left" onclick="navigator.clipboard.writeText('${window.location.origin}?solution=${record.solution_id}'); alert('分享链接已复制')">复制分享链接</button>
          </div>
        </td>
      </tr>
    `).join('');

    tableBody.querySelectorAll('button[data-action="load-solution"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const solutionId = btn.getAttribute('data-solution-id');
        if (!solutionId) return;
        await loadSolutionById(solutionId);
      });
    });
  } catch (error) {
    console.error('加载历史记录失败:', error);
  }
}

async function loadSolutionById(solutionId) {
  if (!supabase) return;
  try {
    const { data: sol, error } = await supabase
      .from('tsp_solutions')
      .select('solution_id, case_id, algorithm, total_cost, total_time, exec_time, reliability, route_sequence, nodes, process_data, is_public, created_at')
      .eq('solution_id', solutionId)
      .single();
    if (error) throw error;

    const bestPath = Array.isArray(sol.route_sequence) ? sol.route_sequence : (sol.route_sequence || []);
    const loadedNodes = Array.isArray(sol.nodes) ? sol.nodes : (sol.nodes || []);
    const resultData = {
      algorithm: sol.algorithm,
      total_cost: sol.total_cost,
      total_time: sol.total_time,
      exec_time: sol.exec_time,
      reliability: sol.reliability,
      best_path: bestPath,
      nodes: loadedNodes || [],
      process_data: sol.process_data ?? null,
      solution_id: sol.solution_id,
      case_id: sol.case_id,
      is_public: sol.is_public
    };

    try {
      const c = await loadCase(String(sol.case_id));
      __lastProblemData = { case_id: Number(sol.case_id), cities: c.cities, road_segments: c.road_segments, weather_data: c.weather_data, time_windows: c.time_windows };
    } catch {
      __lastProblemData = null;
    }

    try {
      const testCaseSelect = document.getElementById('test-case-select');
      if (testCaseSelect && sol.case_id != null) testCaseSelect.value = String(sol.case_id);
    } catch {}

    calculationResults = [{ algorithm: sol.algorithm, ...resultData, path: bestPath, solution_id: sol.solution_id }];
    showSection('solve-section');
    updateVisualization(sol.algorithm, resultData);
    showResultModal();
  } catch (e) {
    console.error('加载历史结果失败:', e);
    alert(`加载历史结果失败：${e?.message || String(e)}`);
  }
}

function updateVisualization(algorithm, data) {
  const cities = __lastProblemData?.cities ?? [];
  updatePathVisualization(data.best_path || data.path, cities);
  
  if (algorithm === 'GA' && data.process_data?.iteration_process) {
    updateGAProcessVisualization(data.process_data.iteration_process);
  } else if (algorithm === 'A*' && data.process_data?.search_process) {
    updateAStarProcessVisualization(data.process_data.search_process);
  } else if (algorithm === 'DP' && data.process_data?.dp_table) {
    updateDPProcessVisualization(data.process_data.dp_table);
  }
}

function createProcessPlayer({ frames, onFrame }) {
  const playBtn = document.getElementById('process-play');
  const pauseBtn = document.getElementById('process-pause');
  const stepBtn = document.getElementById('process-step');
  const slider = document.getElementById('process-slider');
  const speed = document.getElementById('process-speed');
  const status = document.getElementById('process-status');

  if (!playBtn || !pauseBtn || !stepBtn || !slider || !speed || !status) return null;

  let idx = 0;
  let timer = null;
  const getRate = () => Number(speed.value || 1);

  const setStatus = () => {
    status.textContent = frames.length
      ? `帧 ${idx + 1}/${frames.length}，速度 x${getRate().toFixed(2)}`
      : '未加载过程数据';
  };

  const render = () => {
    idx = Math.max(0, Math.min(frames.length - 1, idx));
    slider.value = String(idx);
    onFrame(frames[idx], idx);
    setStatus();
  };

  const stop = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  const play = () => {
    stop();
    if (frames.length === 0) return;
    timer = setInterval(() => {
      idx++;
      if (idx >= frames.length) {
        idx = frames.length - 1;
        stop();
      }
      render();
    }, Math.max(20, Math.floor(80 / getRate())));
  };

  slider.min = '0';
  slider.max = String(Math.max(0, frames.length - 1));
  slider.value = '0';

  playBtn.onclick = play;
  pauseBtn.onclick = stop;
  stepBtn.onclick = () => {
    stop();
    idx = Math.min(frames.length - 1, idx + 1);
    render();
  };
  slider.oninput = () => {
    stop();
    idx = Number(slider.value || 0);
    render();
  };
  speed.oninput = () => setStatus();

  idx = 0;
  setStatus();
  render();

  return { play, pause: stop, destroy: stop };
}

function updatePathVisualization(path, cities) {
  const svg = d3.select('#path-svg');
  svg.selectAll('*').remove();
  
  const width = svg.node().clientWidth || 600;
  const height = svg.node().clientHeight || 380;
  const pad = 32;

  if (!Array.isArray(cities) || cities.length === 0) {
    svg.append('text')
      .attr('x', width / 2)
      .attr('y', height / 2)
      .attr('text-anchor', 'middle')
      .attr('font-size', 14)
      .attr('fill', '#6b7280')
      .text('暂无城市数据');
    return;
  }

  const lonExtent = d3.extent(cities, d => d.longitude);
  const latExtent = d3.extent(cities, d => d.latitude);

  const x = d3.scaleLinear().domain(lonExtent).range([pad, width - pad]);
  const y = d3.scaleLinear().domain(latExtent).range([height - pad, pad]);

  const coordsByIndex = cities.map(c => ({
    x: x(c.longitude),
    y: y(c.latitude),
    name: c.city_name,
    city_id: c.city_id
  }));

  // Draw route (path is a sequence of indices into `cities` array)
  const safePath = Array.isArray(path) ? path.filter(i => Number.isFinite(i) && i >= 0 && i < coordsByIndex.length) : [];
  const line = d3.line()
    .x(i => coordsByIndex[i].x)
    .y(i => coordsByIndex[i].y);

  if (safePath.length > 1) {
    svg.append('path')
      .datum(safePath)
      .attr('fill', 'none')
      .attr('stroke', '#3b82f6')
      .attr('stroke-width', Math.max(1.5, 6 / Math.sqrt(coordsByIndex.length)))
      .attr('opacity', 0.9)
      .attr('d', line);
  }

  // Draw city nodes
  svg.selectAll('circle.city')
    .data(coordsByIndex)
    .enter()
    .append('circle')
    .attr('class', 'city')
    .attr('cx', d => d.x)
    .attr('cy', d => d.y)
    .attr('r', coordsByIndex.length > 50 ? 2 : 4)
    .attr('fill', '#1d4ed8')
    .attr('opacity', 0.9);

  // Highlight start + route order for small N
  if (coordsByIndex.length <= 20 && safePath.length > 0) {
    const order = new Map();
    safePath.forEach((idx, k) => order.set(idx, k));

    svg.selectAll('text.city-label')
      .data(coordsByIndex)
      .enter()
      .append('text')
      .attr('class', 'city-label')
      .attr('x', d => d.x + 8)
      .attr('y', d => d.y + 4)
      .attr('font-size', 11)
      .attr('fill', '#111827')
      .text((d, i) => {
        const k = order.get(i);
        return k != null ? `${k}:${d.name}` : d.name;
      });
  }

  // Start node emphasis
  svg.append('circle')
    .attr('cx', coordsByIndex[0].x)
    .attr('cy', coordsByIndex[0].y)
    .attr('r', coordsByIndex.length > 50 ? 4 : 6)
    .attr('fill', '#10b981')
    .attr('opacity', 0.95);
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

  // Create an animation player over iterations
  const frames = iterationData.map((d, i) => ({ iter: i + 1, best: d[1], mean: d[2] }));
  if (__processPlayer?.destroy) __processPlayer.destroy();
  __processPlayer = createProcessPlayer({
    frames,
    onFrame: (frame) => {
      // marker
      svg.selectAll('line.marker').remove();
      svg.append('line')
        .attr('class', 'marker')
        .attr('x1', x(frame.iter - 1))
        .attr('x2', x(frame.iter - 1))
        .attr('y1', 50)
        .attr('y2', height - 50)
        .attr('stroke', '#111827')
        .attr('stroke-width', 1)
        .attr('opacity', 0.35);

      svg.selectAll('text.marker-label').remove();
      svg.append('text')
        .attr('class', 'marker-label')
        .attr('x', 60)
        .attr('y', 30)
        .attr('fill', '#111827')
        .attr('font-size', 12)
        .text(`迭代 ${frame.iter} | best=${frame.best.toFixed(2)} mean=${frame.mean.toFixed(2)}`);
    }
  });
}

function updateAStarProcessVisualization(searchProcess) {
  const svg = d3.select('#process-svg');
  svg.selectAll('*').remove();
  
  const width = svg.node().clientWidth || 600;
  const height = svg.node().clientHeight || 380;

  const frames = Array.isArray(searchProcess) ? searchProcess : [];
  if (!frames.length) {
    svg.append('text')
      .attr('x', width / 2)
      .attr('y', height / 2)
      .text('暂无 A* 过程数据')
      .attr('text-anchor', 'middle')
      .attr('font-size', '14px')
      .attr('fill', '#6b7280');
    return;
  }

  // Chart: open/closed size over iterations
  const padL = 56, padR = 16, padT = 36, padB = 40;
  const x = d3.scaleLinear()
    .domain([0, frames.length - 1])
    .range([padL, width - padR]);
  const yMax = d3.max(frames, d => Math.max(d.open_size ?? 0, d.closed_size ?? 0)) || 1;
  const y = d3.scaleLinear()
    .domain([0, yMax])
    .range([height - padB, padT]);

  const lineOpen = d3.line()
    .x((d, i) => x(i))
    .y(d => y(d.open_size ?? 0));

  const lineClosed = d3.line()
    .x((d, i) => x(i))
    .y(d => y(d.closed_size ?? 0));

  svg.append('path')
    .datum(frames)
    .attr('fill', 'none')
    .attr('stroke', '#3b82f6')
    .attr('stroke-width', 2)
    .attr('d', lineOpen);

  svg.append('path')
    .datum(frames)
    .attr('fill', 'none')
    .attr('stroke', '#10b981')
    .attr('stroke-width', 2)
    .attr('d', lineClosed);

  svg.append('g')
    .attr('transform', `translate(0, ${height - padB})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat(i => String(frames[Math.floor(i)]?.iter ?? '')));

  svg.append('g')
    .attr('transform', `translate(${padL}, 0)`)
    .call(d3.axisLeft(y).ticks(5));

  svg.append('text')
    .attr('x', padL)
    .attr('y', 18)
    .attr('fill', '#111827')
    .attr('font-size', 12)
    .text('A*: open/closed 集合规模（蓝=open，绿=closed）');

  const marker = svg.append('line')
    .attr('x1', x(0))
    .attr('x2', x(0))
    .attr('y1', padT)
    .attr('y2', height - padB)
    .attr('stroke', '#111827')
    .attr('stroke-width', 1)
    .attr('opacity', 0.35);

  const label = svg.append('text')
    .attr('x', padL)
    .attr('y', padT - 8)
    .attr('fill', '#111827')
    .attr('font-size', 12);

  if (__processPlayer?.destroy) __processPlayer.destroy();
  __processPlayer = createProcessPlayer({
    frames,
    onFrame: (frame, i) => {
      marker.attr('x1', x(i)).attr('x2', x(i));
      const exp = frame.expanded;
      const pathLen = exp?.path?.length ?? 0;
      label.text(`iter=${frame.iter} expand=${exp?.city} visited=${exp?.visitedCount}/${pathLen ? pathLen : ''} open=${frame.open_size} closed=${frame.closed_size}`);
    }
  });
}

function updateDPProcessVisualization(stateProcess) {
  const svg = d3.select('#process-svg');
  svg.selectAll('*').remove();
  
  const width = svg.node().clientWidth;
  const height = svg.node().clientHeight;

  // DP table can be very large; summarize by subset size (best cost so far)
  const dp = Array.isArray(stateProcess) ? stateProcess : null;
  if (!dp) {
    svg.append('text')
      .attr('x', width / 2)
      .attr('y', height / 2)
      .text('暂无 DP 过程数据')
      .attr('text-anchor', 'middle')
      .attr('font-size', '14px')
      .attr('fill', '#6b7280');
    return;
  }

  const n = dp[0]?.length ?? 0;
  const maskCount = dp.length;
  const bestByK = new Map();
  for (let mask = 0; mask < maskCount; mask++) {
    const k = popcount(mask);
    let best = Infinity;
    for (let u = 0; u < n; u++) {
      const v = dp[mask][u];
      if (typeof v === 'number' && Number.isFinite(v) && v < best) best = v;
    }
    if (!bestByK.has(k) || best < bestByK.get(k)) bestByK.set(k, best);
  }
  const frames = Array.from(bestByK.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([k, best], i) => ({ k, best, i }));

  const padL = 56, padR = 16, padT = 36, padB = 40;
  const x = d3.scaleLinear().domain([0, frames.length - 1]).range([padL, width - padR]);
  const y = d3.scaleLinear()
    .domain([d3.max(frames, d => d.best) || 1, d3.min(frames, d => d.best) || 0])
    .range([height - padB, padT]);

  const line = d3.line()
    .x((d, i) => x(i))
    .y(d => y(d.best));

  svg.append('path')
    .datum(frames)
    .attr('fill', 'none')
    .attr('stroke', '#8b5cf6')
    .attr('stroke-width', 2)
    .attr('d', line);

  svg.append('g')
    .attr('transform', `translate(0, ${height - padB})`)
    .call(d3.axisBottom(x).ticks(frames.length).tickFormat((i) => String(frames[Math.floor(i)]?.k ?? '')));

  svg.append('g')
    .attr('transform', `translate(${padL}, 0)`)
    .call(d3.axisLeft(y).ticks(5));

  svg.append('text')
    .attr('x', padL)
    .attr('y', 18)
    .attr('fill', '#111827')
    .attr('font-size', 12)
    .text('DP: 按已访问城市数 k 的最优代价（紫色）');

  const marker = svg.append('circle')
    .attr('cx', x(0))
    .attr('cy', y(frames[0].best))
    .attr('r', 4)
    .attr('fill', '#111827')
    .attr('opacity', 0.6);

  const label = svg.append('text')
    .attr('x', padL)
    .attr('y', padT - 8)
    .attr('fill', '#111827')
    .attr('font-size', 12);

  if (__processPlayer?.destroy) __processPlayer.destroy();
  __processPlayer = createProcessPlayer({
    frames,
    onFrame: (frame, i) => {
      marker.attr('cx', x(i)).attr('cy', y(frame.best));
      label.text(`k=${frame.k} best=${frame.best.toFixed(2)}`);
    }
  });
}

function popcount(x) {
  let c = 0;
  while (x) {
    x &= (x - 1);
    c++;
  }
  return c;
}

async function initMetricsChart() {
  const ctx = document.getElementById('metrics-chart').getContext('2d');
  
  if (window.metricsChart) {
    window.metricsChart.destroy();
  }

  const kpisEl = document.getElementById('metrics-kpis');
  const noteEl = document.getElementById('metrics-note');

  const latest = calculationResults[calculationResults.length - 1];
  if (!latest) {
    if (kpisEl) kpisEl.innerHTML = '';
    if (noteEl) noteEl.textContent = '暂无结果，请先运行算法。';
    return;
  }

  const algorithm = latest.algorithm;
  const totalCost = Number(latest.total_cost);
  const totalTime = Number(latest.total_time);
  const execTime = Number(latest.exec_time);
  const reliability = latest.reliability == null ? null : Number(latest.reliability);

  // Search/iteration effort (derived from process_data)
  let effortLabel = '过程规模';
  let effortValue = null;
  const pd = latest.process_data;
  if (algorithm === 'GA' && pd?.iteration_process) {
    effortLabel = '迭代次数';
    effortValue = Array.isArray(pd.iteration_process) ? pd.iteration_process.length : null;
  } else if (algorithm === 'A*' && pd?.meta?.expansions) {
    effortLabel = '扩展节点数';
    effortValue = Number(pd.meta.expansions);
  } else if (algorithm === 'DP' && pd?.dp_table) {
    effortLabel = '状态数';
    effortValue = Array.isArray(pd.dp_table) ? pd.dp_table.length : null;
  }

  // Baseline best (from public history) for the same case_id + algorithm, if available
  let bestPublic = null;
  let bestNote = '';
  const caseId = __lastProblemData?.case_id ?? null;
  if (supabase && caseId != null) {
    try {
      const { data, error } = await supabase
        .from('tsp_solutions')
        .select('total_cost, algorithm')
        .eq('case_id', caseId)
        .eq('algorithm', algorithm)
        .eq('is_public', true)
        .order('total_cost', { ascending: true })
        .limit(1);
      if (error) throw error;
      if (data && data.length > 0) {
        bestPublic = Number(data[0].total_cost);
        bestNote = `（公开历史最佳 ${bestPublic.toFixed(2)}）`;
      }
    } catch (e) {
      // ignore
    }
  }

  const gapPct = (bestPublic && Number.isFinite(bestPublic) && bestPublic > 0)
    ? ((totalCost / bestPublic) - 1) * 100
    : null;

  if (kpisEl) {
    kpisEl.innerHTML = [
      kpiCard('总成本', `${totalCost.toFixed(2)} ${bestNote}`),
      kpiCard('总时间(分)', `${totalTime.toFixed(2)}`),
      kpiCard('执行耗时(ms)', `${execTime.toFixed(2)}`),
      kpiCard('可靠性', reliability == null ? 'N/A' : reliability.toFixed(2)),
      kpiCard(effortLabel, effortValue == null ? 'N/A' : String(effortValue)),
      kpiCard('相对差距', gapPct == null ? 'N/A' : `${gapPct.toFixed(2)}%`)
    ].join('');
  }
  if (noteEl) {
    noteEl.textContent = '说明：成本/时间用于衡量解质量；耗时与过程规模衡量求解效率；可靠性来自天气因子。相对差距以公开历史最佳为基线（若存在）。';
  }

  // Radar chart: normalized (higher is better)
  const qualityScore = bestPublic && bestPublic > 0 ? clamp(bestPublic / totalCost, 0, 1) : 1;
  const reliabilityScore = reliability == null ? 0.5 : clamp(reliability, 0, 1);
  const speedScore = clamp(1 / (1 + execTime / 2000), 0, 1);
  const effortScore = effortValue == null ? 0.5 : clamp(1 / (1 + Number(effortValue) / 50000), 0, 1);

  window.metricsChart = new Chart(ctx, {
    type: 'radar',
    data: {
      labels: ['解质量', '可靠性', '速度', '搜索/迭代效率'],
      datasets: [{
        label: `${algorithm} 指标雷达图（归一化）`,
        data: [qualityScore, reliabilityScore, speedScore, effortScore],
        borderColor: 'rgba(59, 130, 246, 1)',
        backgroundColor: 'rgba(59, 130, 246, 0.2)',
        pointBackgroundColor: 'rgba(59, 130, 246, 1)',
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        r: {
          min: 0,
          max: 1,
          ticks: { stepSize: 0.25 }
        }
      }
    }
  });
}

function kpiCard(title, value) {
  return `
    <div class="bg-white border rounded p-3">
      <div class="text-xs text-gray-500">${title}</div>
      <div class="text-sm font-semibold text-gray-900 mt-1">${escapeHtml(value)}</div>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function initCompareChart() {
  const ctx = document.getElementById('compare-chart').getContext('2d');
  const caseId = document.getElementById('compare-case-select').value;
  
  if (window.compareChart) {
    window.compareChart.destroy();
  }

  const statusEl = document.getElementById('compare-status');
  if (statusEl) statusEl.textContent = '正在从历史记录加载对比数据...';

  loadCompareFromHistory(caseId)
    .then(rows => {
      if (!rows || rows.length === 0) {
        if (statusEl) statusEl.textContent = '没有可用的公开历史结果。可以点击“一键运行对比”。';
        renderCompareChart(ctx, [], caseId);
        return;
      }
      if (statusEl) statusEl.textContent = `已加载历史对比数据（case=${caseId}）`;
      renderCompareChart(ctx, rows, caseId);
    })
    .catch((e) => {
      console.error('加载对比数据失败:', e);
      if (statusEl) statusEl.textContent = `加载历史失败：${e?.message || String(e)}；可以点击“一键运行对比”。`;
      renderCompareChart(ctx, [], caseId);
    });
}

async function loadCompareFromHistory(caseId) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('tsp_solutions')
    .select('algorithm, total_cost, total_time, exec_time, reliability, created_at')
    .eq('case_id', parseInt(caseId))
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;

  // pick best (min cost) per algorithm
  const byAlg = new Map();
  for (const r of (data || [])) {
    const alg = r.algorithm;
    const cur = byAlg.get(alg);
    if (!cur || Number(r.total_cost) < Number(cur.total_cost)) byAlg.set(alg, r);
  }
  return Array.from(byAlg.values());
}

function renderCompareChart(ctx, rows, caseId) {
  const algorithms = rows.map(r => r.algorithm);
  const costArr = rows.map(r => Number(r.total_cost));
  const timeArr = rows.map(r => Number(r.total_time));
  const execArr = rows.map(r => Number(r.exec_time));
  const relArr = rows.map(r => r.reliability == null ? 0.5 : Number(r.reliability));

  const costScore = normalizeLowerBetter(costArr);
  const timeScore = normalizeLowerBetter(timeArr);
  const execScore = normalizeLowerBetter(execArr);
  const relScore = normalizeHigherBetter(relArr);

  const colors = {
    'DP': ['rgba(59,130,246,1)', 'rgba(59,130,246,0.2)'],
    'A*': ['rgba(16,185,129,1)', 'rgba(16,185,129,0.2)'],
    'GA': ['rgba(139,92,246,1)', 'rgba(139,92,246,0.2)'],
  };

  window.compareChart = new Chart(ctx, {
    type: 'radar',
    data: {
      labels: ['解质量(成本)', '总时间', '速度(耗时)', '可靠性'],
      datasets: rows.map((r, i) => {
        const alg = r.algorithm;
        const [border, bg] = colors[alg] || ['rgba(107,114,128,1)', 'rgba(107,114,128,0.2)'];
        return {
          label: alg,
          data: [costScore[i], timeScore[i], execScore[i], relScore[i]],
          borderColor: border,
          backgroundColor: bg,
        };
      })
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        r: { min: 0, max: 1, ticks: { stepSize: 0.25 } }
      },
      plugins: {
        tooltip: {
          callbacks: {
            afterBody: (items) => {
              const idx = items?.[0]?.datasetIndex ?? 0;
              const row = rows[idx];
              if (!row) return '';
              return [
                `cost=${Number(row.total_cost).toFixed(2)}`,
                `time=${Number(row.total_time).toFixed(2)}min`,
                `exec=${Number(row.exec_time).toFixed(2)}ms`,
                `rel=${row.reliability == null ? 'N/A' : Number(row.reliability).toFixed(2)}`
              ].join('\n');
            }
          }
        }
      }
    }
  });
}

function normalizeLowerBetter(arr) {
  if (!arr.length) return [];
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) return arr.map(() => 1);
  return arr.map(v => clamp((max - v) / (max - min), 0, 1));
}

function normalizeHigherBetter(arr) {
  if (!arr.length) return [];
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) return arr.map(() => 1);
  return arr.map(v => clamp((v - min) / (max - min), 0, 1));
}

async function runCompareNow() {
  const caseId = document.getElementById('compare-case-select').value;
  const statusEl = document.getElementById('compare-status');
  if (statusEl) statusEl.textContent = '正在运行对比（串行执行，可能需要一些时间）...';

  try {
    const problemData = await getProblemData(caseId);
    const n = problemData.cities?.length || 0;
    const candidates = [];
    if (n <= 15) candidates.push('DP');
    if (n <= 30) candidates.push('A*');
    candidates.push('GA');

    const gaParams = {
      pop_size: 50,
      max_generations: 100,
      mutation_rate: 0.1
    };

    const rows = [];
    for (const alg of candidates) {
      if (!EDGE_FUNCTION_URL) throw new Error('未配置 Supabase Edge Function');
      if (statusEl) statusEl.textContent = `运行 ${alg}...`;
      const params = alg === 'GA' ? gaParams : {};
      const res = await runTSPAlgorithm(alg, problemData, params, caseId);
      if (res.code !== 200) {
        console.warn(`${alg} 失败:`, res);
        continue;
      }
      rows.push({ algorithm: alg, ...res.data });
    }

    const ctx = document.getElementById('compare-chart').getContext('2d');
    if (statusEl) statusEl.textContent = rows.length ? '对比完成（基于当次运行结果）' : '对比失败：没有算法成功返回结果';
    renderCompareChart(ctx, rows, caseId);
  } catch (e) {
    console.error('运行对比失败:', e);
    if (statusEl) statusEl.textContent = `运行对比失败：${e?.message || String(e)}`;
  }
}

function log(message) {
  const logElement = document.getElementById('execution-log');
  const p = document.createElement('p');
  p.className = 'text-gray-600';
  p.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logElement.appendChild(p);
  logElement.scrollTop = logElement.scrollHeight;
}
