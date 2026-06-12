// 类型定义

export interface TaskConfig {
  audience: 'entrepreneur' | 'developer' | 'general';
  length: 'concise' | 'standard' | 'full';
  title_style: 'informative' | 'suspense' | 'story';
}

export interface Task {
  id: string;
  source_text: string;
  config: TaskConfig;
  status: 'pending' | 'running' | 'completed' | 'failed';
  current_step: string;
  search_results: SearchResult[];
  draft_text: string;
  final_text: string;
  quality_report: QualityReport;
  created_at: string;
}

export interface SearchResult {
  title: string;
  snippet: string;
  link: string;
}

export interface QualityReport {
  passed: boolean;
  score: number;
  feedback: string;
}

export interface SSEEvent {
  step: string;
  status: string;
  message?: string;
  data?: any;
}

export interface AgentStep {
  step: string;
  status: string;
  message: string;
  data?: any;
  timestamp: number;
}
