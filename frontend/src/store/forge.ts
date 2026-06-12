import { create } from "zustand";
import type { TaskConfig, Task, SSEEventData, ConfigData, ConfigUpdate } from "../services/api";

interface ForgeState {
  // Input
  sourceText: string;
  setSourceText: (text: string) => void;

  // Task Config
  config: TaskConfig;
  setConfig: (config: Partial<TaskConfig>) => void;

  // App Config (API Keys, model selection)
  appConfig: ConfigData | null;
  setAppConfig: (cfg: ConfigData | null) => void;
  loadAppConfig: () => Promise<void>;
  saveAppConfig: (cfg: ConfigUpdate) => Promise<void>;
  isConfigSaving: boolean;

  // Task
  currentTask: Task | null;
  setCurrentTask: (task: Task | null) => void;

  // Agent progress
  agentStep: string;
  agentMessage: string;
  agentData: any;
  setAgentProgress: (event: SSEEventData) => void;

  // Loading
  isRunning: boolean;
  setIsRunning: (running: boolean) => void;

  // History
  history: Task[];
  setHistory: (tasks: Task[]) => void;
}

export const useForgeStore = create<ForgeState>((set, get) => ({
  sourceText: "",
  setSourceText: (text) => set({ sourceText: text }),

  config: {
    audience: "entrepreneur",
    length: "full",
    title_style: "suspense",
    model: "gpt-4o",
  },
  setConfig: (partial) =>
    set((state) => ({ config: { ...state.config, ...partial } })),

  appConfig: null,
  setAppConfig: (cfg) => set({ appConfig: cfg }),
  isConfigSaving: false,

  async loadAppConfig() {
    const { getConfig } = await import("../services/api");
    try {
      const cfg = await getConfig();
      set({ appConfig: cfg });
    } catch (err) {
      console.error("Load config failed:", err);
    }
  },

  async saveAppConfig(cfg) {
    const { updateConfig } = await import("../services/api");
    set({ isConfigSaving: true });
    try {
      const updated = await updateConfig(cfg);
      set({ appConfig: updated });
    } catch (err: any) {
      throw err;
    } finally {
      set({ isConfigSaving: false });
    }
  },

  currentTask: null,
  setCurrentTask: (task) => set({ currentTask: task }),

  agentStep: "",
  agentMessage: "",
  agentData: null,
  setAgentProgress: (event) =>
    set({
      agentStep: event.step,
      agentMessage: event.message,
      agentData: event.data,
    }),

  isRunning: false,
  setIsRunning: (running) => set({ isRunning: running }),

  history: [],
  setHistory: (tasks) => set({ history: tasks }),
}));
