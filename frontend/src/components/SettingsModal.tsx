import React, { useState, useEffect } from "react";
import { Modal, Form, Input, InputNumber, Select, Button, message, Divider, Typography } from "antd";
import { SaveOutlined, KeyOutlined, RobotOutlined, SearchOutlined } from "@ant-design/icons";
import { useForgeStore } from "../store/forge";
import type { ConfigUpdate } from "../services/api";

interface Props {
  open: boolean;
  onClose: () => void;
}

const { Text } = Typography;

const MODEL_OPTIONS = [
  { value: "gpt-4o", label: "GPT-4o" },
  { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
  { value: "gpt-4.1", label: "GPT-4.1" },
  { value: "claude-opus-4", label: "Claude Opus 4" },
  { value: "claude-sonnet-4", label: "Claude Sonnet 4" },
  { value: "claude-haiku-4", label: "Claude Haiku 4" },
  { value: "deepseek-chat", label: "DeepSeek V3 (Chat)" },
  { value: "deepseek-reasoner", label: "DeepSeek R1 (Reasoner)" },
];

export const SettingsModal: React.FC<Props> = ({ open, onClose }) => {
  const { appConfig, loadAppConfig, saveAppConfig, isConfigSaving } = useForgeStore();
  const [form] = Form.useForm();

  useEffect(() => {
    if (open) {
      loadAppConfig();
    }
  }, [open]);

  useEffect(() => {
    if (appConfig) {
      form.setFieldsValue({
        llm_rewrite_model: appConfig.llm_rewrite_model,
        llm_search_model: appConfig.llm_search_model,
        llm_validate_model: appConfig.llm_validate_model,
        max_search_results: appConfig.max_search_results,
        openai_api_key: "",
        anthropic_api_key: "",
        deepseek_api_key: "",
        serper_api_key: "",
      });
    }
  }, [appConfig, open]);

  const handleSave = async () => {
    try {
      const vals = await form.validateFields();
      const update: ConfigUpdate = {};
      // 只提交非空字段
      (Object.keys(vals) as (keyof typeof vals)[]).forEach((k) => {
        const v = vals[k];
        if (v !== undefined && v !== "" && v !== null) {
          (update as any)[k] = v;
        }
      });
      await saveAppConfig(update);
      message.success("配置已保存");
      onClose();
    } catch (err: any) {
      message.error(`保存失败: ${err.message || err}`);
    }
  };

  return (
    <Modal
      title={
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <KeyOutlined style={{ color: "#534AB7" }} />
          <span>系统配置</span>
        </div>
      }
      open={open}
      onCancel={onClose}
      width={560}
      footer={[
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button
          key="save"
          type="primary"
          icon={<SaveOutlined />}
          loading={isConfigSaving}
          onClick={handleSave}
        >
          保存
        </Button>,
      ]}
    >
      <Form form={form} layout="vertical" style={{ maxHeight: "60vh", overflowY: "auto", paddingRight: 8 }}>
        {/* API Keys */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
          <KeyOutlined style={{ color: "#534AB7" }} />
          <Text strong style={{ color: "#534AB7" }}>API 密钥</Text>
        </div>
        <Form.Item name="openai_api_key" label="OpenAI API Key" style={{ marginBottom: 12 }}>
          <Input.Password placeholder={appConfig?.openai_api_key_masked || "留空表示不修改"} />
        </Form.Item>
        <Form.Item name="anthropic_api_key" label="Anthropic (Claude) API Key" style={{ marginBottom: 12 }}>
          <Input.Password placeholder={appConfig?.anthropic_api_key_masked || "留空表示不修改"} />
        </Form.Item>
        <Form.Item name="deepseek_api_key" label="DeepSeek API Key" style={{ marginBottom: 12 }}>
          <Input.Password placeholder={appConfig?.deepseek_api_key_masked || "留空表示不修改"} />
        </Form.Item>
        <Form.Item name="serper_api_key" label="Serper（搜索）API Key" style={{ marginBottom: 16 }}>
          <Input.Password placeholder={appConfig?.serper_api_key_masked || "留空表示不修改"} />
        </Form.Item>

        <Divider style={{ margin: "8px 0 16px" }} />

        {/* Model Selection */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
          <RobotOutlined style={{ color: "#534AB7" }} />
          <Text strong style={{ color: "#534AB7" }}>模型选择</Text>
        </div>
        <Form.Item name="llm_rewrite_model" label="润色改写模型" rules={[{ required: true }]} style={{ marginBottom: 12 }}>
          <Select options={MODEL_OPTIONS} />
        </Form.Item>
        <Form.Item name="llm_search_model" label="搜索摘要模型（低成本）" rules={[{ required: true }]} style={{ marginBottom: 12 }}>
          <Select options={MODEL_OPTIONS} />
        </Form.Item>
        <Form.Item name="llm_validate_model" label="质量检查模型" rules={[{ required: true }]} style={{ marginBottom: 16 }}>
          <Select options={MODEL_OPTIONS} />
        </Form.Item>

        <Divider style={{ margin: "8px 0 16px" }} />

        {/* Search Config */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
          <SearchOutlined style={{ color: "#534AB7" }} />
          <Text strong style={{ color: "#534AB7" }}>搜索配置</Text>
        </div>
        <Form.Item name="max_search_results" label="最大搜索结果数" rules={[{ required: true }]}>
          <InputNumber min={1} max={50} style={{ width: "100%" }} />
        </Form.Item>
      </Form>
    </Modal>
  );
};
