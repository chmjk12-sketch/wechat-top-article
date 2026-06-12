import { Task, TaskConfig, SSEEvent } from './types';

const BASE = '';

export async function createTask(sourceText: string, config: TaskConfig): Promise<Task> {
  const r = await fetch(`${BASE}/api/v1/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_text: sourceText, config }),
  });
  return r.json();
}

export function subscribeTaskStream(
  taskId: string,
  onEvent: (event: SSEEvent) => void,
  onError: (err: any) => void
): () => void {
  const es = new EventSource(`${BASE}/api/v1/tasks/${taskId}/stream`);
  es.onmessage = (e) => {
    try {
      const event: SSEEvent = JSON.parse(e.data);
      onEvent(event);
    } catch { }
  };
  es.onerror = (err) => {
    onError(err);
    es.close();
  };
  return () => es.close();
}
