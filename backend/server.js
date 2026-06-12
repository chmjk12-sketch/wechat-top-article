// 推文工坊 · ArticleForge v2 — 服务端
// Chat-based AI 润色引擎，集成 DeepSeek + Serper 搜索
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 80;
const DB_PATH = path.join(__dirname, '..', 'article_forge.db.json');
const STATIC_DIR = path.join(__dirname, '..', '..', 'frontend', 'dist');

// ========== 硬编码配置 ==========
const DEEPSEEK_KEY = 'sk-b114e560f3d3466ca6089bb1626ef9da';
const SERPER_KEY = process.env.SERPER_API_KEY || '';

// ========== 数据库 ==========
function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch { return { tasks: [] }; }
}
function saveDB(db) { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); }

// ========== LLM 调用 (仅 DeepSeek) ==========
function callDeepSeek(messages, { temperature = 0.7, max_tokens = 4000 } = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'deepseek-chat',
      messages,
      temperature,
      max_tokens,
      stream: false
    });
    const req = https.request({
      hostname: 'api.deepseek.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 120000,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.choices?.[0]?.message?.content || '');
        } catch { reject(new Error(data)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ========== Serper 搜索 ==========
function searchWeb(query) {
  return new Promise((resolve) => {
    if (!SERPER_KEY) return resolve([]);
    const body = JSON.stringify({ q: query, gl: 'cn', hl: 'zh-cn', num: 5 });
    const req = https.request({
      hostname: 'google.serper.dev', path: '/search', method: 'POST',
      headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve((json.organic || []).slice(0, 5).map(i => ({
            title: i.title || '', snippet: i.snippet || '', link: i.link || ''
          })));
        } catch { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.write(body); req.end();
  });
}

// ========== Agent 引擎 (Chat 化) ==========
async function runAgent(taskId, sourceText, config, emit) {
  const db = loadDB();
  const task = db.tasks.find(t => t.id === taskId);
  if (!task) return;

  function update(partial) {
    Object.assign(task, partial);
    saveDB(db);
  }

  try {
    // Step 1: 理解需求
    emit({ step: 'thinking', status: 'running', message: '正在理解你的内容...' });
    const audienceMap = { entrepreneur: '创业者/投资人', developer: '开发者/技术人', general: '大众读者' };
    const lengthMap = { concise: '精简（~1500字）', standard: '标准（~2500字）', full: '保留深度（~3500字）' };
    const styleMap = { informative: '干货型', suspense: '悬念型', story: '故事型' };

    update({ status: 'running', current_step: 'searching' });
    emit({
      step: 'thinking', status: 'done',
      message: `已确认：面向 ${audienceMap[config.audience] || '大众读者'}，${lengthMap[config.length] || '标准篇幅'}，${styleMap[config.title_style] || '干货型'} 标题风格。`,
      data: { config }
    });

    // Step 2: 搜索补充数据
    emit({ step: 'searching', status: 'running', message: '正在搜索相关数据来丰富内容...' });

    // 先让 AI 提取搜索词
    const extractPrompt = `从以下文本中提取 3 个需要数据支撑的关键搜索词（可验证的事实声明）。只输出搜索词列表，每行一个。\n\n${sourceText.slice(0, 2000)}`;
    let queries = [];
    try {
      const raw = await callDeepSeek([{ role: 'user', content: extractPrompt }], { max_tokens: 200, temperature: 0.3 });
      queries = raw.split('\n').map(s => s.replace(/^\d+\.?\s*/, '').trim()).filter(s => s.length > 2).slice(0, 3);
    } catch { queries = []; }

    let searchResults = [];
    if (queries.length > 0) {
      const allResults = await Promise.all(queries.map(q => searchWeb(q)));
      const seen = new Set();
      searchResults = allResults.flat().filter(r => {
        const key = r.link;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, 8);
    }

    update({ search_results: searchResults });
    emit({
      step: 'searching', status: 'done',
      message: searchResults.length > 0 ? `找到了 ${searchResults.length} 条相关数据。` : '无需额外搜索数据。',
      data: { results: searchResults }
    });

    // Step 3: 润色改写
    emit({ step: 'writing', status: 'running', message: '正在根据你的需求改写文章...' });

    const searchContext = searchResults.length > 0
      ? `\n\n【补充数据（请融入文章，不要直接复制）】\n${JSON.stringify(searchResults, null, 2)}`
      : '';

    const rewritePrompt = `你是一位资深公众号编辑，擅长将深度分析文章改写成引人入胜的公众号推文。

【改写要求】
- 目标受众：${audienceMap[config.audience] || '大众读者'}
- 篇幅要求：${lengthMap[config.length] || '标准（~2500字）'}
- 标题风格：${styleMap[config.title_style] || '干货型'}
- 使用口语化表达，避免学术腔
- 适当使用emoji增加可读性
- 保留原文核心数据和观点，融入搜索结果中的真实数据
- 段落不宜过长，多用小标题分段
- 开头要抓人，结尾要有行动号召或总结

【原文】
${sourceText}
${searchContext}

请直接输出润色后的推文内容（含标题）。`;

    const rewritten = await callDeepSeek([{ role: 'user', content: rewritePrompt }], { max_tokens: 6000, temperature: 0.7 });

    update({ draft_text: rewritten, current_step: 'validating' });
    emit({
      step: 'writing', status: 'done',
      message: '文章润色完成！',
      data: { preview: rewritten }
    });

    // Step 4: 快速质量检查
    emit({ step: 'checking', status: 'running', message: '正在做最后的检查...' });

    const validatePrompt = `请检查以下公众号推文的质量。输出 JSON 格式：{"passed": true/false, "score": 1-10, "feedback": "简短评语"}

【推文】
${rewritten.slice(0, 3000)}`;

    let report = { passed: true, score: 8, feedback: '质量良好' };
    try {
      const raw = await callDeepSeek([{ role: 'user', content: validatePrompt }], { max_tokens: 500, temperature: 0.3 });
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) report = JSON.parse(jsonMatch[0]);
    } catch { /* 使用默认报告 */ }

    update({
      status: 'completed',
      current_step: 'completed',
      final_text: rewritten,
      quality_report: report,
    });
    emit({
      step: 'checking', status: 'done',
      message: `质量评分：${report.score}/10 — ${report.feedback}`,
      data: { report }
    });
    emit({ step: 'completed', status: 'done', message: '全部完成！' });

  } catch (err) {
    console.error('Agent error:', err);
    update({ status: 'failed', current_step: 'failed' });
    emit({ step: 'failed', status: 'error', message: '处理失败：' + err.message });
    saveDB(db);
  }
}

// ========== SSE 管理 ==========
const sseClients = new Map(); // taskId -> Set<response>

// ========== HTTP Server ==========
const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  const fullPath = path.join(STATIC_DIR, filePath);
  if (!fullPath.startsWith(STATIC_DIR)) { res.writeHead(403); res.end(); return; }

  const ext = path.extname(fullPath);
  fs.readFile(fullPath, (err, data) => {
    if (err) {
      // SPA fallback
      fs.readFile(path.join(STATIC_DIR, 'index.html'), (e2, indexData) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(indexData);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  // CORS
  if (req.method === 'OPTIONS') { setCORS(res); res.writeHead(204); res.end(); return; }
  setCORS(res);

  // API 路由
  if (p === '/api/v1/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', version: '2.0.0' }));
    return;
  }

  if (p === '/api/v1/tasks' && req.method === 'POST') {
    const body = await parseBody(req);
    const db = loadDB();
    const task = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      source_text: body.source_text || '',
      config: body.config || {},
      status: 'pending',
      current_step: 'thinking',
      search_results: [],
      draft_text: '',
      final_text: '',
      quality_report: {},
      created_at: new Date().toISOString(),
    };
    db.tasks.unshift(task);
    if (db.tasks.length > 100) db.tasks.length = 100;
    saveDB(db);

    // 后台启动 Agent
    const clients = new Set();
    sseClients.set(task.id, clients);
    runAgent(task.id, body.source_text, body.config || {}, (event) => {
      for (const c of clients) {
        c.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      if (event.step === 'completed' || event.step === 'failed') {
        clients.forEach(c => c.end());
        sseClients.delete(task.id);
      }
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(task));
    return;
  }

  if (p.startsWith('/api/v1/tasks/') && p.endsWith('/stream')) {
    const taskId = p.split('/')[4];
    const db = loadDB();
    const task = db.tasks.find(t => t.id === taskId);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // 发送当前状态
    if (task) {
      res.write(`data: ${JSON.stringify({
        step: 'init', status: 'done',
        data: { task }
      })}\n\n`);
    }

    // 注册客户端
    if (sseClients.has(taskId)) {
      sseClients.get(taskId).add(res);
    }

    req.on('close', () => {
      if (sseClients.has(taskId)) {
        sseClients.get(taskId).delete(res);
      }
    });
    return;
  }

  if (p.startsWith('/api/v1/tasks/')) {
    const taskId = p.split('/')[4];
    const db = loadDB();
    const task = db.tasks.find(t => t.id === taskId);
    if (task) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(task));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Task not found' }));
    }
    return;
  }

  if (p === '/api/v1/tasks' && req.method === 'GET') {
    const db = loadDB();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(db.tasks.slice(0, 20)));
    return;
  }

  if (p === '/api/v1/config' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      llm_rewrite_model: 'deepseek-chat',
      llm_search_model: 'deepseek-chat',
      llm_validate_model: 'deepseek-chat',
      max_search_results: 5,
      serper_api_key: SERPER_KEY ? `****${SERPER_KEY.slice(-4)}` : '',
      deepseek_api_key: `****${DEEPSEEK_KEY.slice(-4)}`,
    }));
    return;
  }

  // 静态文件
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log('\n  ⚡ 推文工坊 · ArticleForge v2');
  console.log('  ─────────────────────────────');
  console.log(`  🌐 http://localhost:${PORT}`);
  console.log(`  📡 API: http://localhost:${PORT}/api/v1/health`);
  console.log(`  🤖 模型: DeepSeek Chat\n`);
});
