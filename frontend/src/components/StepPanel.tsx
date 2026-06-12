import { Steps, Typography, Card } from "antd";
import {
  CheckCircleOutlined,
  LoadingOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  SearchOutlined,
  EditOutlined,
  AuditOutlined,
  RocketOutlined,
} from "@ant-design/icons";
import { useForgeStore } from "../store/forge";

const { Text } = Typography;

const STEP_ORDER = ["requirements", "searching", "rewriting", "validating", "completed"];

const STEP_CONFIG = {
  requirements: { label: "需求确认", icon: <RocketOutlined /> },
  searching: { label: "数据搜索", icon: <SearchOutlined /> },
  rewriting: { label: "润色改写", icon: <EditOutlined /> },
  validating: { label: "质量检查", icon: <AuditOutlined /> },
  completed: { label: "完成", icon: <CheckCircleOutlined /> },
};

export default function StepPanel() {
  const { agentStep, agentMessage } = useForgeStore();

  const currentIdx = STEP_ORDER.indexOf(agentStep);

  const getStepStatus = (step: string, idx: number) => {
    if (agentStep === "failed") return "error";
    if (idx < currentIdx) return "finish";
    if (idx === currentIdx) return "process";
    return "wait";
  };

  const getStepIcon = (step: string, idx: number) => {
    if (idx === currentIdx && agentStep !== "failed" && agentStep !== "completed") {
      return <LoadingOutlined style={{ color: "#534AB7" }} />;
    }
    if (idx < currentIdx) return <CheckCircleOutlined style={{ color: "#52c41a" }} />;
    return STEP_CONFIG[step]?.icon || <ClockCircleOutlined />;
  };

  if (!agentStep) return null;

  return (
    <Card
      size="small"
      style={{
        marginBottom: 12,
        borderRadius: 8,
        border: agentStep ? "1px solid #d3d0f0" : "1px solid #f0f0f0",
        background: agentStep ? "#fafaff" : "#fff",
      }}
      bodyStyle={{ padding: "12px 16px" }}
    >
      <Steps
        current={currentIdx >= 0 ? currentIdx : 0}
        size="small"
        items={STEP_ORDER.map((step, idx) => ({
          title: STEP_CONFIG[step]?.label || step,
          status: getStepStatus(step, idx) as any,
          icon: getStepIcon(step, idx),
        }))}
      />
      {agentMessage && (
        <div style={{ marginTop: 8, textAlign: "center" }}>
          <Text type="secondary" style={{ fontSize: 13 }}>{agentMessage}</Text>
        </div>
      )}
    </Card>
  );
}
