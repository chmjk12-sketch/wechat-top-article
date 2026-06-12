import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { createTask, subscribeTaskStream } from './api';
import { TaskConfig, AgentStep, SearchResult, QualityReport } from './types';
import './App.css';

const AUDIENCES = [
  { value: 'entrepreneur', label: '🚀 创业者/投资人' },
  { value: 'developer', label: '💻 开发者/技术人' },
  { value: 'general', label: '👥 大众读者' },
] as const;

const LENGTHS = [
  { value: 'concise', label: '精简 ~1500字' },
  { value: 'standard', label: '标准 ~2500字' },
  { value: 'full', label: '深度 ~3500字' },
] as const;

const STYLES = [
  { value: 'informative', label: '📊 干货型' },
  { value: 'suspense', label: '🎭 悬念型' },
  { value: 'story', label: '📖 故事型' },
] as const;

const STEP_ICONS: Record<string, string> = {
  thinking: '🧠', searching: '🔍', writing: '✍️', checking: '✅', completed: '🎉', failed: '❌',
};

export default function App() {
  const [sourceText, setSourceText] = useState('');
  const [config, setConfig] = useState<TaskConfig>({
    audience: 'general', length: 'standard', title_style: 'informative',
  });
  const [isRunning, setIsRunning] = useState(false);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [preview, setPreview] = useState('');
  const [report, setReport] = useState<QualityReport | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [steps]);

  const addStep = (step: AgentStep) => {
    setSteps(prev => {
      const idx = prev.findIndex(s => s.step === step.step);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = step;
        return next;
      }
      return [...prev, step];
    });
  };

  const handleStart = async () => {
    if (!sourceText.trim() || isRunning) return;
    setIsRunning(true);
    setSteps([]);
    setSearchResults([]);
    setPreview('');
    setReport(null);

    try {
      const task = await createTask(sourceText, config);
      const close = subscribeTaskStream(task.id, (event) => {
        const s: AgentStep = {
          step: event.step,
          status: event.status,
          message: event.message || '',
          data: event.data,
          timestamp: Date.now(),
        };
        addStep(s);

        if (event.step === 'searching' && event.status === 'done' && event.data?.results) {
          setSearchResults(event.data.results);
        }
        if (event.step === 'writing' && event.status === 'done' && event.data?.preview) {
          setPreview(event.data.preview);
        }
        if (event.step === 'checking' && event.status === 'done' && event.data?.report) {
          setReport(event.data.report);
        }
        if (event.step === 'completed' || event.step === 'failed') {
          setIsRunning(false);
        }
      }, () => setIsRunning(false));
    } catch (e) {
      setIsRunning(false);
    }
  };

  const reset = () => {
    setSteps([]);
    setSearchResults([]);
    setPreview('');
    setReport(null);
    setIsRunning(false);
  };

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <span className="logo">⚡</span>
          <h1>推文工坊</h1>
          <span className="version">ArticleForge v2</span>
        </div>
        <div className="header-right">
          <span className="model-badge">🤖 DeepSeek Chat</span>
        </div>
      </header>

      {/* Main Content */}
      <main className="main">
        {/* Left: Chat Panel */}
        <section className="chat-panel">
          {/* Input Area */}
          <div className="input-area">
            <textarea
              className="source-input"
              placeholder="粘贴你要改写的长文内容...&#10;&#10;支持学术文章、分析报告、行业研报等各种深度内容。AI 会自动搜索补充数据，改写成适合目标受众阅读的公众号推文。"
              value={sourceText}
              onChange={e => setSourceText(e.target.value)}
              disabled={isRunning}
            />

            {/* Config Chips */}
            <div className="config-row">
              <div className="config-group">
                <label>受众</label>
                <div className="chip-group">
                  {AUDIENCES.map(a => (
                    <button
                      key={a.value}
                      className={`chip ${config.audience === a.value ? 'active' : ''}`}
                      onClick={() => setConfig(c => ({ ...c, audience: a.value as any }))}
                      disabled={isRunning}
                    >{a.label}</button>
                  ))}
                </div>
              </div>
              <div className="config-group">
                <label>篇幅</label>
                <div className="chip-group">
                  {LENGTHS.map(l => (
                    <button
                      key={l.value}
                      className={`chip ${config.length === l.value ? 'active' : ''}`}
                      onClick={() => setConfig(c => ({ ...c, length: l.value as any }))}
                      disabled={isRunning}
                    >{l.label}</button>
                  ))}
                </div>
              </div>
              <div className="config-group">
                <label>标题风格</label>
                <div className="chip-group">
                  {STYLES.map(s => (
                    <button
                      key={s.value}
                      className={`chip ${config.title_style === s.value ? 'active' : ''}`}
                      onClick={() => setConfig(c => ({ ...c, title_style: s.value as any }))}
                      disabled={isRunning}
                    >{s.label}</button>
                  ))}
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="action-row">
              <span className="char-count">{sourceText.length} 字</span>
              <button
                className="btn-primary"
                onClick={handleStart}
                disabled={!sourceText.trim() || isRunning}
              >
                {isRunning ? (
                  <><span className="spinner" /> 处理中...</>
                ) : (
                  <>✨ 开始润色</>
                )}
              </button>
              <button className="btn-secondary" onClick={reset} disabled={isRunning}>
                重置
              </button>
            </div>
          </div>

          {/* Chat Messages */}
          <div className="chat-messages">
            {steps.length === 0 && !isRunning && (
              <div className="empty-state">
                <div className="empty-icon">📝</div>
                <div className="empty-title">开始你的第一篇推文</div>
                <div className="empty-desc">
                  粘贴原文，选择受众和风格，AI 将自动完成搜索数据、润色改写、质量检查。
                </div>
              </div>
            )}

            {steps.map((step, i) => (
              <div key={i} className={`chat-bubble ${step.status === 'running' ? 'ai-running' : 'ai'}`}>
                <div className="bubble-avatar">{STEP_ICONS[step.step] || '🤖'}</div>
                <div className="bubble-content">
                  <div className="bubble-text">{step.message}</div>
                  {step.status === 'running' && <div className="typing-indicator"><span /><span /><span /></div>}
                  {/* Search Results Card */}
                  {step.step === 'searching' && step.status === 'done' && step.data?.results?.length > 0 && (
                    <div className="data-card">
                      <div className="data-card-title">🔍 搜索数据</div>
                      {step.data.results.slice(0, 5).map((r: any, j: number) => (
                        <a key={j} href={r.link} target="_blank" rel="noopener" className="search-item">
                          <div className="search-item-title">{r.title}</div>
                          <div className="search-item-snippet">{r.snippet}</div>
                        </a>
                      ))}
                    </div>
                  )}
                  {/* Quality Report Card */}
                  {step.step === 'checking' && step.status === 'done' && step.data?.report && (
                    <div className={`data-card ${step.data.report.passed ? 'passed' : 'failed'}`}>
                      <div className="data-card-title">
                        {step.data.report.passed ? '✅ 质量通过' : '⚠️ 需改进'} — {step.data.report.score}/10
                      </div>
                      <div className="data-card-text">{step.data.report.feedback}</div>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {isRunning && (
              <div className="chat-bubble ai-running">
                <div className="bubble-avatar">🤖</div>
                <div className="bubble-content">
                  <div className="typing-indicator"><span /><span /><span /></div>
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>
        </section>

        {/* Right: Preview Panel */}
        <section className="preview-panel">
          <div className="preview-header">
            <h2>📄 推文预览</h2>
            {report && (
              <span className={`preview-badge ${report.passed ? 'passed' : 'failed'}`}>
                {report.passed ? '✅ 通过' : '⚠️ ' + report.score + '/10'}
              </span>
            )}
          </div>

          <div className="preview-content">
            {preview ? (
              <div className="markdown-body">
                <ReactMarkdown>{preview}</ReactMarkdown>
              </div>
            ) : searchResults.length > 0 ? (
              <div className="preview-search">
                <h3>🔍 搜索数据 ({searchResults.length} 条)</h3>
                {searchResults.map((r, i) => (
                  <a key={i} href={r.link} target="_blank" rel="noopener" className="search-item">
                    <div className="search-item-title">{r.title}</div>
                    <div className="search-item-snippet">{r.snippet}</div>
                  </a>
                ))}
              </div>
            ) : (
              <div className="preview-empty">
                <div className="empty-icon">👈</div>
                <div className="empty-title">润色结果将在这里实时展示</div>
                <div className="empty-desc">在左侧粘贴原文并点击「开始润色」，等待 AI 完成<br />整个过程包括：需求理解 → 数据搜索 → 润色改写 → 质量检查</div>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
