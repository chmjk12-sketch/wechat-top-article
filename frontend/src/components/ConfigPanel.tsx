import { Select, Button, Space, Typography, Tooltip } from "antd";
import { RocketOutlined, InfoCircleOutlined } from "@ant-design/icons";
import { useForgeStore } from "../store/forge";

const { Text } = Typography;

export default function ConfigPanel() {
  const { config, setConfig, isRunning, sourceText, appConfig } = useForgeStore();

  const hasApiKey = appConfig?.openai_api_key_masked || appConfig?.deepseek_api_key_masked;

  const handleStart = async () => {
    if (!sourceText.trim()) return;
    const { createTask, subscribeTaskStream } = await import("../services/api");
    const { setIsRunning, setCurrentTask, setAgentProgress } = useForgeStore.getState();

    setIsRunning(true);
    try {
      const task = await createTask(sourceText, config);
      setCurrentTask(task);

      subscribeTaskStream(
        task.id,
        (event) => {
          setAgentProgress(event);
          if (event.step === "completed" || event.step === "failed") {
            setIsRunning(false);
            // Refresh task data
            getTask(task.id).then((updated) => setCurrentTask(updated));
          }
        },
        () => setIsRunning(false)
      );
    } catch (err) {
      console.error("Failed to start task:", err);
      setIsRunning(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "10px 0",
        flexWrap: "wrap",
      }}
    >
      <Space size={4}>
        <Text type="secondary" style={{ fontSize: 13 }}>受众</Text>
        <Select
          value={config.audience}
          onChange={(v) => setConfig({ audience: v })}
          style={{ width: 140 }}
          size="middle"
          options={[
            { value: "entrepreneur", label: "创业者/投资人" },
            { value: "developer", label: "开发者/技术人" },
            { value: "general", label: "大众读者" },
          ]}
        />
      </Space>

      <Space size={4}>
        <Text type="secondary" style={{ fontSize: 13 }}>篇幅</Text>
        <Select
          value={config.length}
          onChange={(v) => setConfig({ length: v })}
          style={{ width: 150 }}
          size="middle"
          options={[
            { value: "concise", label: "精简 (~1500字)" },
            { value: "standard", label: "标准 (~2500字)" },
            { value: "full", label: "保留深度 (~3500字)" },
          ]}
        />
      </Space>

      <Space size={4}>
        <Text type="secondary" style={{ fontSize: 13 }}>标题</Text>
        <Select
          value={config.title_style}
          onChange={(v) => setConfig({ title_style: v })}
          style={{ width: 120 }}
          size="middle"
          options={[
            { value: "informative", label: "干货型" },
            { value: "suspense", label: "悬念型" },
            { value: "story", label: "故事型" },
          ]}
        />
      </Space>

      <Space size={4}>
        <Text type="secondary" style={{ fontSize: 13 }}>模型</Text>
        <Select
          value={config.model}
          onChange={(v) => setConfig({ model: v })}
          style={{ width: 150 }}
          size="middle"
          options={[
            { value: "gpt-4o", label: "GPT-4o" },
            { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
            { value: "deepseek-chat", label: "DeepSeek V3" },
            { value: "deepseek-reasoner", label: "DeepSeek R1" },
          ]}
        />
      </Space>

      <Button
        type="primary"
        icon={<RocketOutlined />}
        onClick={handleStart}
        loading={isRunning}
        disabled={!sourceText.trim() || isRunning}
        size="large"
        style={{
          marginLeft: "auto",
          borderRadius: 8,
          height: 40,
          padding: "0 28px",
          fontWeight: 600,
          boxShadow: sourceText.trim() && !isRunning
            ? "0 2px 8px rgba(83, 74, 183, 0.35)"
            : "none",
        }}
      >
        {isRunning ? "润色中..." : "开始润色"}
      </Button>

      {!hasApiKey && (
        <Tooltip title="请先在右上角「配置」中填写 API Key">
          <InfoCircleOutlined style={{ color: "#faad14", fontSize: 16 }} />
        </Tooltip>
      )}
    </div>
  );
}

async function getTask(taskId: string) {
  const { getTask: fetchTask } = await import("../services/api");
  return fetchTask(taskId);
}
