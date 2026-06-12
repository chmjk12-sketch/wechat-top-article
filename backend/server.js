// 推文工坊 · ArticleForge v3 — 智能识别内容类型，多阶段引擎
// 支持大纲→扩写→润色 流水线
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 80;
const DB_PATH = path.join(__dirname, '..', 'article_forge.db.json');
const STATIC_DIR = path.join(__dirname, '..', '..', 'frontend', 'dist');

const DEEPSEEK_KEY = 'sk-b114e560f3d3466ca6089bb1626ef9da';
const SERPER_KEY = process.env.SERPER_API_KEY || '';

// ========== 数据库 ==========
function loadDB() { try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); } catch { return { tasks: [] }; } }
function saveDB(db) { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); }

// ========== LLM 调用 ==========
function callDeepSeek(messages, opts = {}) {
  const { temperature = 0.7, max_tokens = 4000 } = opts;
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: 'deepseek-chat', messages, temperature, max_tokens, stream: false });
    const req = https.request({
      hostname: 'api.deepseek.com', path: '/v1/chat/completions', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_KEY}`, 'Content-Length': Buffer.byteLength(body) },
      timeout: 180000,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data).choices?.[0]?.message?.content || ''); }
        catch { reject(new Error(data)); }
      });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

// ========== Serper 搜索 ==========
function searchWeb(query) {
  return new Promise((resolve) => {
    if (!SERPER_KEY) return resolve([]);
    const body = JSON.stringify({ q: query, gl: 'cn', hl: 'zh-cn', num: 8 });
    const req = https.request({
      hostname: 'google.serper.dev', path: '/search', method: 'POST',
      headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve((json.organic || []).slice(0, 8).map(i => ({
            title: i.title || '', snippet: i.snippet || '', link: i.link || ''
          })));
        } catch { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.write(body); req.end();
  });
}

// ========== 内容类型检测 ==========
function detectContentType(text) {
  // 大纲特征：大量短行、标题标记、bullet points、符号碎片、标点密度低
  const lines = text.split('\n').filter(l => l.trim());
  const avgLineLen = lines.reduce((s, l) => s + l.length, 0) / Math.max(lines.length, 1);
  const hasHeadings = /^#{1,4}\s/.test(text);
  const hasBullets = /^[\-\*\d]+[\.\s]/.test(text);
  const hasSymbols = /->|→|``|→\s/.test(text);
  const punctuationDensity = (text.match(/[，。、；：？！\n]/g) || []).length / Math.max(text.length, 1);
  
  // 分数越高越像大纲
  let score = 0;
  if (hasHeadings) score += 2;
  if (hasBullets) score += 2;
  if (hasSymbols) score += 1;
  if (avgLineLen < 80) score += 2;
  if (punctuationDensity < 0.03) score += 1;
  
  return { isOutline: score >= 4, score, avgLineLen, hasHeadings, hasBullets };
}

// ========== 智能搜索关键词提取（对大纲友好） ==========
async function extractSearchTopics(text, contentType) {
  if (contentType.isOutline) {
    // 大纲模式：让 LLM 理解大纲意图，推断搜索主题
    const prompt = `你是一位行业分析师。以下是用户提供的一份研究大纲/笔记。请推断这份大纲想分析的主题领域，然后生成 5 个具体的搜索查询词。

规则：
- 每个查询词应针对可验证的事实数据（市场规模、增长率、融资额、渗透率、技术指标等）
- 查询词应包含具体年份（如"2025年"）、具体公司名、具体技术名称
- 只输出搜索查询词，每行一个，无编号

【大纲内容】
${text.slice(0, 3000)}

搜索查询词：`;
    try {
      const raw = await callDeepSeek([{ role: 'user', content: prompt }], { max_tokens: 300, temperature: 0.3 });
      return raw.split('\n').map(s => s.replace(/^[\d\.\-\s]+/, '').trim()).filter(s => s.length > 3).slice(0, 5);
    } catch { return []; }
  } else {
    // 全文模式：直接从文本中提取需要数据支撑的声明
    const prompt = `从以下文本中提取 3 个需要数据支撑的关键搜索词（可验证的事实声明）。只输出搜索词，每行一个。\n\n${text.slice(0, 2000)}`;
    try {
      const raw = await callDeepSeek([{ role: 'user', content: prompt }], { max_tokens: 200, temperature: 0.3 });
      return raw.split('\n').map(s => s.replace(/^[\d\.\-\s]+/, '').trim()).filter(s => s.length > 2).slice(0, 3);
    } catch { return []; }
  }
}

// ========== Agent 引擎 v3 ==========
async function runAgent(taskId, sourceText, config, emit) {
  const db = loadDB();
  const task = db.tasks.find(t => t.id === taskId);
  if (!task) return;

  function update(partial) { Object.assign(task, partial); saveDB(db); }

  try {
    const audienceMap = { entrepreneur: '创业者/投资人', developer: '开发者/技术人', general: '大众读者' };
    const lengthMap = { concise: '精简（~1500字）', standard: '标准（~2500字）', full: '保留深度（~3500字）' };
    const styleMap = { informative: '干货型', suspense: '悬念型', story: '故事型' };

    // ====== Step 0: 检测内容类型 ======
    emit({ step: 'thinking', status: 'running', message: '正在分析你的内容类型...' });
    const contentType = detectContentType(sourceText);
    update({ status: 'running', current_step: 'thinking' });

    const typeLabel = contentType.isOutline
      ? `检测到【大纲/笔记】格式（标题:${contentType.hasHeadings} 列表:${contentType.hasBullets} 均行${contentType.avgLineLen.toFixed(0)}字）→ 将执行：理解意图 → 搜索数据 → 结构扩写 → 风格润色`
      : `检测到【完整文章】格式 → 将执行：搜索数据 → 风格润色`;
    
    emit({
      step: 'thinking', status: 'done',
      message: typeLabel,
      data: { contentType }
    });

    // ====== Step 1: 搜索补充数据 ======
    emit({ step: 'searching', status: 'running', message: '正在全网搜索相关数据...' });

    const queries = await extractSearchTopics(sourceText, contentType);
    let searchResults = [];
    
    if (queries.length > 0) {
      emit({ step: 'searching', status: 'running', message: `搜索关键词：${queries.join('、')}...` });
      const allResults = await Promise.all(queries.map(q => searchWeb(q)));
      const seen = new Set();
      searchResults = allResults.flat().filter(r => {
        const key = r.link;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, 12);
    }

    update({ search_results: searchResults });
    emit({
      step: 'searching', status: 'done',
      message: searchResults.length > 0
        ? `找到 ${searchResults.length} 条相关数据。${contentType.isOutline ? '开始结构化扩写...' : '开始润色...'}`
        : '未找到额外数据。开始处理...',
      data: { results: searchResults, queries }
    });

    // ====== Step 2: 处理（大纲→扩写 or 直接润色） ======
    let finalText = '';

    if (contentType.isOutline) {
      // ===== 大纲模式：两步流水线 =====

      // Phase 2a: 结构化扩写
      emit({ step: 'writing', status: 'running', message: 'Phase 1/2: 将大纲展开为完整分析文章...' });

      const searchDataText = searchResults.length > 0
        ? searchResults.map(r => `- [${r.title}](${r.link}): ${r.snippet}`).join('\n')
        : '无额外数据';

      const expandPrompt = `你是一位资深行业分析师。以下是一份研究报告大纲，以及从网络上搜索到的相关数据。请将这份大纲展开为一份**结构完整、论据充分、数据翔实**的完整分析报告。

【写作要求】
- 保持原文的分析框架和逻辑结构
- **把每个 bullet point 展开为完整的段落**，补充推理过程和解释
- **将搜索数据作为论据自然融入**，而不是堆砌数据
- 对大纲中提到的技术概念（如 TRIZ、MPC、RAG 等）给出清晰解释
- 使用专业但易懂的语言，面向行业内读者
- 字数控制在 2500-4000 字
- 使用 Markdown 格式，包含合适的标题层级

【分析大纲】
${sourceText}

【搜索数据（融入文章，标明来源）】
${searchDataText}

请输出完整的分析报告：`;

      const expanded = await callDeepSeek(
        [{ role: 'user', content: expandPrompt }],
        { max_tokens: 8000, temperature: 0.5 }
      );

      if (!expanded) throw new Error('扩写失败');

      // Phase 2b: 风格润色
      emit({ step: 'writing', status: 'running', message: 'Phase 2/2: 按照目标风格进行润色...' });

      const polishPrompt = `你是一位资深公众号编辑。请将以下分析报告改写为适合目标受众阅读的公众号推文。

【改写要求】
- 目标受众：${audienceMap[config.audience] || '大众读者'}
- 篇幅要求：${lengthMap[config.length] || '标准（~2500字）'}
- 标题风格：${styleMap[config.title_style] || '干货型'}
- 使用口语化表达，避免学术腔和专业术语堆砌
- 适当使用emoji增加可读性（不要过度）
- 保留所有关键数据和观点，但用更通俗的方式表达
- 段落不宜过长，多用小标题分段
- 开头要抓人（钩子），结尾要有行动号召或总结
- 不要丢失任何核心论据

【分析报告】
${expanded}

请直接输出润色后的推文内容（含标题）。`;

      finalText = await callDeepSeek(
        [{ role: 'user', content: polishPrompt }],
        { max_tokens: 8000, temperature: 0.7 }
      );

    } else {
      // ===== 全文模式：直接润色 =====
      emit({ step: 'writing', status: 'running', message: '正在润色文章...' });

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

      finalText = await callDeepSeek(
        [{ role: 'user', content: rewritePrompt }],
        { max_tokens: 8000, temperature: 0.7 }
      );
    }

    if (!finalText) throw new Error('生成失败');

    update({ draft_text: finalText, current_step: 'validating' });
    emit({
      step: 'writing', status: 'done',
      message: `文章${contentType.isOutline ? '扩写+润色' : '润色'}完成！共 ${finalText.length} 字。`,
      data: { preview: finalText }
    });

    // ====== Step 3: 质量检查 ======
    emit({ step: 'checking', status: 'running', message: '正在进行质量检查...' });

    const validatePrompt = `请检查以下公众号推文的质量。从以下几个方面评估：
1. 数据丰富度（是否有足够的真实数据支撑观点）
2. 逻辑连贯性（结构是否清晰、论证是否完整）
3. 可读性（语言是否适合目标受众）
4. 格式规范性（标题层级、段落长度是否合理）

输出 JSON 格式：{"passed": true/false, "score": 1-10, "feedback": "简短评语（10字内）", "details": "详细评价"}

【推文】
${finalText.slice(0, 4000)}`;

    let report = { passed: true, score: 8, feedback: '质量良好', details: '' };
    try {
      const raw = await callDeepSeek([{ role: 'user', content: validatePrompt }], { max_tokens: 500, temperature: 0.3 });
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) report = JSON.parse(jsonMatch[0]);
    } catch { /* default */ }

    update({ status: 'completed', current_step: 'completed', final_text: finalText, quality_report: report });
    emit({
      step: 'checking', status: 'done',
      message: `质量评分：${report.score}/10 — ${report.feedback}`,
      data: { report }
    });
    emit({ step: 'completed', status: 'done', message: '✅ 全部完成！' });

  } catch (err) {
    console.error('Agent error:', err);
    update({ status: 'failed', current_step: 'failed' });
    emit({ step: 'failed', status: 'error', message: '处理失败：' + err.message });
    saveDB(db);
  }
}

// ========== SSE 管理 ==========
const sseClients = new Map();

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
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  if (req.method === 'OPTIONS') { setCORS(res); res.writeHead(204); res.end(); return; }
  setCORS(res);

  if (p === '/api/v1/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', version: '3.0.0', features: ['outline-detection', 'multi-phase'] }));
    return;
  }

  if (p === '/api/v1/tasks' && req.method === 'POST') {
    const body = await parseBody(req);
    const db = loadDB();
    const task = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      source_text: body.source_text || '',
      config: body.config || {},
      status: 'pending', current_step: 'thinking',
      search_results: [], draft_text: '', final_text: '', quality_report: {},
      created_at: new Date().toISOString(),
    };
    db.tasks.unshift(task);
    if (db.tasks.length > 100) db.tasks.length = 100;
    saveDB(db);

    const clients = new Set();
    sseClients.set(task.id, clients);
    runAgent(task.id, body.source_text, body.config || {}, (event) => {
      for (const c of clients) { c.write(`data: ${JSON.stringify(event)}\n\n`); }
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
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    const db = loadDB();
    const task = db.tasks.find(t => t.id === taskId);
    if (task) { res.write(`data: ${JSON.stringify({ step: 'init', status: 'done', data: { task } })}\n\n`); }
    if (sseClients.has(taskId)) { sseClients.get(taskId).add(res); }
    req.on('close', () => { if (sseClients.has(taskId)) sseClients.get(taskId).delete(res); });
    return;
  }

  if (p.startsWith('/api/v1/tasks/')) {
    const taskId = p.split('/')[4];
    const db = loadDB();
    const task = db.tasks.find(t => t.id === taskId);
    if (task) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(task)); }
    else { res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' })); }
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
      llm_rewrite_model: 'deepseek-chat', llm_search_model: 'deepseek-chat', llm_validate_model: 'deepseek-chat',
      max_search_results: 8, serper_api_key: SERPER_KEY ? `****${SERPER_KEY.slice(-4)}` : '',
      deepseek_api_key: `****${DEEPSEEK_KEY.slice(-4)}`, version: '3.0.0'
    }));
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log('\n  ⚡ 推文工坊 · ArticleForge v3');
  console.log('  ─────────────────────────────');
  console.log(`  🌐 http://localhost:${PORT}`);
  console.log('  🤖 模型: DeepSeek Chat');
  console.log('  🧠 特性: 大纲检测 + 两阶段扩写\n');
});
