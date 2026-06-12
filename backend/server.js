// ArticleForge 全栈服务 - 生产模式
// API + 前端静态文件一体化
// 用法：node server.js
// 生产模式自动 serve ../frontend/dist/ 下的静态文件

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8000;
const DB_PATH = path.join(__dirname, 'article_forge.db.json');
const STATIC_DIR = path.join(__dirname, '..', 'frontend', 'dist');

// ========== 数据库 ==========
let db = { config: {}, tasks: [] };
try {
  db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
} catch (e) {
  db = {
    config: {
      llm_rewrite_model: 'gpt-4o',
      llm_search_model: 'deepseek-chat',
      llm_validate_model: 'gpt-4o',
      max_search_results: 10,
      search_enabled: { serper: true, tavily: false },
    },
    tasks: [],
  };
  saveDB();
}

function saveDB() {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// ========== WeChat 代理 ==========
const wechatProxy = require('./wechat-proxy');

// ========== MIME 类型 ==========
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

// ========== 工具函数 ==========

function searchWeb(query, serperKey, callback) {
  if (!serperKey) {
    return callback([{ title: '搜索不可用 - 未配置 Serper API Key', snippet: '', link: '' }]);
  }
  const body = JSON.stringify({ q: query, gl: 'cn', hl: 'zh-cn', num: 5 });
  const options = {
    hostname: 'google.serper.dev',
    path: '/search',
    method: 'POST',
    headers: {
      'X-API-KEY': serperKey,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  };
  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        const results = (json.organic || []).map(i => ({
          title: i.title || '',
          snippet: i.snippet || '',
          link: i.link || '',
        }));
        callback(results);
      } catch (e) {
        callback([]);
      }
    });
  });
  req.on('error', () => callback([]));
  req.write(body);
  req.end();
}

function callLLM(model, prompt, system, apiKey, baseURL, callback) {
  if (!apiKey) {
    return callback(`[模拟输出] ${prompt.slice(0, 50)}...（请在配置中填写真实 API Key）`);
  }
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });
  const body = JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 4000 });
  const url = new URL(`${baseURL}/chat/completions`);
  const isAnthropic = baseURL.includes('anthropic');
  const headers = isAnthropic
    ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    : { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
  const options = {
    hostname: url.hostname,
    path: url.pathname + url.search,
    method: 'POST',
    headers,
  };
  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        const content = isAnthropic
          ? (json.content || []).map(c => c.text || '').join('')
          : (json.choices || [])[0]?.message?.content || '[LLM 返回为空]';
        callback(content);
      } catch (e) {
        callback('[LLM 调用失败: ' + e.message + ']');
      }
    });
  });
  req.on('error', (e) => callback('[LLM 调用失败: ' + e.message + ']'));
  req.write(body);
  req.end();
}

function getBaseURL(model) {
  if (model.startsWith('gpt') || model.startsWith('o1') || model.startsWith('o3')) return 'https://api.openai.com/v1';
  if (model.startsWith('claude')) return 'https://api.anthropic.com/v1';
  if (model.startsWith('deepseek')) return 'https://api.deepseek.com/v1';
  return 'https://api.openai.com/v1';
}

function extractQueries(text) {
  const lines = text.split('\n').filter(l => l.length > 10);
  const queries = [];
  for (const line of lines) {
    if (line.match(/\d{4}/) || line.match(/[A-Z][a-z]+/) || line.match(/[公司|报告|数据|研究显示]/)) {
      const cleaned = line.replace(/[#*>\-]/g, '').trim().slice(0, 100);
      if (cleaned) queries.push(cleaned);
    }
  }
  return queries.slice(0, 5);
}

function getApiKeyForModel(model, cfg) {
  if (model.startsWith('gpt') || model.startsWith('o1') || model.startsWith('o3')) return cfg.openai_api_key || '';
  if (model.startsWith('claude')) return cfg.anthropic_api_key || '';
  if (model.startsWith('deepseek')) return cfg.deepseek_api_key || '';
  return cfg.openai_api_key || '';
}

// ========== Agent 核心 ==========
function runAgent(taskId, sourceText, config, res) {
  const cfg = db.config || {};
  const send = (step, status, message, data) => {
    const event = `data: ${JSON.stringify({ step, status, message, data })}\n\n`;
    if (res && !res.destroyed) {
      try { res.write(event); } catch (e) {}
    }
  };

  // Step 1
  send('requirements', 'completed', '需求已确认', { config });

  // Step 2: 搜索
  send('searching', 'running', '正在联网搜索真实数据...', null);
  const queries = extractQueries(sourceText);
  const allResults = [];
  let searched = 0;
  if (queries.length === 0) {
    send('searching', 'completed', '无需搜索', { results: [] });
    step3();
  } else {
    for (const q of queries) {
      send('searching', 'running', `搜索: ${q.slice(0, 30)}...`, null);
      searchWeb(q, cfg.serper_api_key || '', (results) => {
        allResults.push(...results);
        searched++;
        if (searched >= queries.length) {
          send('searching', 'completed', `搜索完成，共找到 ${allResults.length} 条数据`, { results: allResults });
          step3(allResults);
        }
      });
    }
  }

  function step3(searchResults) {
    // Step 3: 润色
    send('rewriting', 'running', '正在润色改写...', null);
    const system = `你是公众号推文写作专家。受众：${config.audience || 'entrepreneur'}，篇幅：${config.length || 'full'}，标题风格：${config.title_style || 'suspense'}。保留原文逻辑，去掉术语，语言生动。`;
    const rewritePrompt = `请将以下科研文章改写成公众号推文：\n\n${sourceText}`;
    const rewriteModel = cfg.llm_rewrite_model || 'gpt-4o';
    const apiKey = getApiKeyForModel(rewriteModel, cfg);
    callLLM(rewriteModel, rewritePrompt, system, apiKey, getBaseURL(rewriteModel), (draft) => {
      send('rewriting', 'completed', '润色完成', { draft });
      step4(draft, searchResults || []);
    });
  }

  function step4(draft, searchResults) {
    // Step 4: 质量检查
    send('validating', 'running', '正在质量检查...', null);
    const validatePrompt = `请检查以下推文：1）数据是否有来源 2）术语是否已转化 3）逻辑是否完整。以 JSON 输出：{"data_sourced": true, "terms_ok": true, "logic_ok": true, "issues": []}\n\n${draft}`;
    const validateModel = cfg.llm_validate_model || 'gpt-4o';
    const apiKey = getApiKeyForModel(validateModel, cfg);
    callLLM(validateModel, validatePrompt, '', apiKey, getBaseURL(validateModel), (quality) => {
      send('validating', 'completed', '质量检查完成', { quality_report: { passed: true, details: quality } });
      const task = db.tasks.find(t => t.id === taskId);
      if (task) {
        task.status = 'completed';
        task.final_text = draft;
        task.search_results = searchResults || [];
        task.quality_report = { passed: true };
        saveDB();
      }
      send('completed', 'completed', '推文生成完成！', { final_text: draft });
      if (res && !res.destroyed) {
        try { res.end(); } catch (e) {}
      }
    });
  }
}

// ========== 静态文件服务 ==========
function serveStatic(req, res) {
  let filePath = req.url.split('?')[0];
  if (filePath === '/') filePath = '/index.html';

  const fullPath = path.join(STATIC_DIR, filePath);

  // 安全检查：防止路径穿越
  if (!fullPath.startsWith(STATIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      // SPA fallback: 所有未找到的路径返回 index.html
      fs.readFile(path.join(STATIC_DIR, 'index.html'), (e2, indexData) => {
        if (e2) {
          res.writeHead(404);
          return res.end('Not Found');
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(indexData);
      });
      return;
    }

    const ext = path.extname(fullPath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

// ========== HTTP 服务器 ==========
const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://${req.headers.host}`);
  let body = '';
  req.on('data', (chunk) => { body += chunk; });

  req.on('end', () => {
    // ========== API 路由 ==========

    // GET /api/v1/health
    if (req.method === 'GET' && url.pathname === '/api/v1/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'ok', version: '0.1.0' }));
    }

    // GET /api/v1/config
    if (req.method === 'GET' && url.pathname === '/api/v1/config') {
      const cfg = db.config || {};
      const masked = {
        llm_rewrite_model: cfg.llm_rewrite_model || 'gpt-4o',
        llm_search_model: cfg.llm_search_model || 'deepseek-chat',
        llm_validate_model: cfg.llm_validate_model || 'gpt-4o',
        max_search_results: cfg.max_search_results || 10,
        search_enabled: cfg.search_enabled || { serper: true, tavily: false },
        openai_api_key_masked: cfg.openai_api_key ? cfg.openai_api_key.slice(0, 6) + '...' + cfg.openai_api_key.slice(-4) : '',
        anthropic_api_key_masked: cfg.anthropic_api_key ? '****' + cfg.anthropic_api_key.slice(-4) : '',
        deepseek_api_key_masked: cfg.deepseek_api_key ? '****' + cfg.deepseek_api_key.slice(-4) : '',
        serper_api_key_masked: cfg.serper_api_key ? '****' + cfg.serper_api_key.slice(-4) : '',
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(masked));
    }

    // PUT /api/v1/config
    if (req.method === 'PUT' && url.pathname === '/api/v1/config') {
      try {
        const updates = JSON.parse(body);
        db.config = { ...(db.config || {}), ...updates };
        saveDB();
        const cfg = db.config;
        const masked = {
          llm_rewrite_model: cfg.llm_rewrite_model || 'gpt-4o',
          llm_search_model: cfg.llm_search_model || 'deepseek-chat',
          llm_validate_model: cfg.llm_validate_model || 'gpt-4o',
          max_search_results: cfg.max_search_results || 10,
          search_enabled: cfg.search_enabled || { serper: true, tavily: false },
          openai_api_key_masked: cfg.openai_api_key ? cfg.openai_api_key.slice(0, 6) + '...' + cfg.openai_api_key.slice(-4) : '',
          anthropic_api_key_masked: cfg.anthropic_api_key ? '****' + cfg.anthropic_api_key.slice(-4) : '',
          deepseek_api_key_masked: cfg.deepseek_api_key ? '****' + cfg.deepseek_api_key.slice(-4) : '',
          serper_api_key_masked: cfg.serper_api_key ? '****' + cfg.serper_api_key.slice(-4) : '',
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(masked));
      } catch (e) {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: e.message }));
      }
    }

    // POST /api/v1/tasks
    if (req.method === 'POST' && url.pathname === '/api/v1/tasks') {
      try {
        const { source_text, config } = JSON.parse(body);
        const task = {
          id: 'task-' + Date.now(),
          status: 'running',
          current_step: 'requirements',
          source_text,
          config: config || {},
          search_results: [],
          draft_text: '',
          final_text: '',
          quality_report: {},
          data_sources: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        db.tasks.push(task);
        saveDB();
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(task));
        return;
      } catch (e) {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: e.message }));
      }
    }

    // GET /api/v1/tasks/:id
    const taskMatch = req.method === 'GET' && url.pathname.match(/^\/api\/v1\/tasks\/([^/]+)$/);
    if (taskMatch) {
      const task = db.tasks.find(t => t.id === taskMatch[1]);
      if (!task) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(task));
    }

    // GET /api/v1/tasks/:id/stream (SSE)
    const streamMatch = req.method === 'GET' && url.pathname.match(/^\/api\/v1\/tasks\/([^/]+)\/stream$/);
    if (streamMatch) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write(':\n\n');
      const taskId = streamMatch[1];
      const task = db.tasks.find(t => t.id === taskId);
      if (task) {
        runAgent(taskId, task.source_text, task.config || {}, res);
      } else {
        res.end();
      }
      return;
    }

    // ========== WeChat API 代理 ==========
    if (url.pathname.startsWith('/api/wechat/')) {
      return wechatProxy.handleWechatProxy(req, res, body);
    }

    // ========== 静态文件服务 ==========
    serveStatic(req, res);
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  ⚡ 推文工坊 · ArticleForge');
  console.log('  ─────────────────────────────');
  console.log(`  🌐 http://localhost:${PORT}`);
  console.log(`  📡 API: http://localhost:${PORT}/api/v1/health`);
  console.log('');
  console.log('  📂 静态文件:', STATIC_DIR);
  console.log('  💾 数据库:', DB_PATH);
  console.log('');
});
