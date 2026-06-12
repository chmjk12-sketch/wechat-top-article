const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

export interface TaskConfig {
  audience: "entrepreneur" | "developer" | "general";
  length: "concise" | "standard" | "full";
  title_style: "informative" | "suspense" | "story";
  model: string;
}

export interface Task {
  id: string;
  status: string;
  current_step: string;
  source_text: string;
  config: TaskConfig;
  search_results: any[];
  draft_text: string;
  final_text: string;
  quality_report: any;
  data_sources: any[];
  created_at: string;
  updated_at: string;
}

export interface SSEEventData {
  step: string;
  status: string;
  message: string;
  data?: any;
}

export async function createTask(sourceText: string, config: TaskConfig): Promise<Task> {
  const resp = await fetch(`${API_BASE}/api/v1/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source_text: sourceText, config }),
  });
  if (!resp.ok) throw new Error(`Create task failed: ${resp.statusText}`);
  return resp.json();
}

export async function getTask(taskId: string): Promise<Task> {
  const resp = await fetch(`${API_BASE}/api/v1/tasks/${taskId}`);
  if (!resp.ok) throw new Error(`Get task failed: ${resp.statusText}`);
  return resp.json();
}

export async function listTasks(limit = 20, offset = 0): Promise<Task[]> {
  const resp = await fetch(`${API_BASE}/api/v1/tasks?limit=${limit}&offset=${offset}`);
  if (!resp.ok) throw new Error(`List tasks failed: ${resp.statusText}`);
  return resp.json();
}

export function subscribeTaskStream(
  taskId: string,
  onEvent: (event: SSEEventData) => void,
  onError?: (err: any) => void
): EventSource {
  const source = new EventSource(`${API_BASE}/api/v1/tasks/${taskId}/stream`);
  source.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      onEvent(data);
      if (data.step === "completed" || data.step === "failed") {
        source.close();
      }
    } catch (err) {
      console.error("Parse SSE error:", err);
    }
  };
  source.onerror = (err) => {
    console.error("SSE connection error:", err);
    source.close();
    onError?.(err);
  };
  return source;
}

// ========== 配置 API ==========

export interface ConfigData {
  llm_rewrite_model: string;
  llm_search_model: string;
  llm_validate_model: string;
  max_search_results: number;
  search_enabled: Record<string, boolean>;
  openai_api_key_masked: string;
  anthropic_api_key_masked: string;
  deepseek_api_key_masked: string;
  serper_api_key_masked: string;
}

export interface ConfigUpdate {
  openai_api_key?: string;
  anthropic_api_key?: string;
  deepseek_api_key?: string;
  serper_api_key?: string;
  llm_rewrite_model?: string;
  llm_search_model?: string;
  llm_validate_model?: string;
  max_search_results?: number;
  search_enabled?: Record<string, boolean>;
}

export async function getConfig(): Promise<ConfigData> {
  const resp = await fetch(`${API_BASE}/api/v1/config`);
  if (!resp.ok) throw new Error(`Get config failed: ${resp.statusText}`);
  return resp.json();
}

export async function updateConfig(cfg: ConfigUpdate): Promise<ConfigData> {
  const resp = await fetch(`${API_BASE}/api/v1/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cfg),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(text || `Update config failed: ${resp.statusText}`);
  }
  return resp.json();
}
