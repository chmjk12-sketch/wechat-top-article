import { Typography, Empty, Tag, Card, List, Divider } from "antd";
import { FileTextOutlined, CheckCircleOutlined } from "@ant-design/icons";
import ReactMarkdown from "react-markdown";
import { useForgeStore } from "../store/forge";

const { Title, Paragraph } = Typography;

export default function PreviewPanel() {
  const { currentTask, agentStep, agentData } = useForgeStore();
  const displayText = currentTask?.final_text || currentTask?.draft_text || "";

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <FileTextOutlined style={{ color: "#534AB7" }} />
        <Title level={5} style={{ margin: 0 }}>
          推文预览
        </Title>
        {agentStep === "completed" && (
          <Tag icon={<CheckCircleOutlined />} color="success" style={{ marginLeft: 8 }}>
            生成完成
          </Tag>
        )}
      </div>

      {/* Search results preview */}
      {agentStep === "searching" && agentData?.results && agentData.results.length > 0 && (
        <Card
          size="small"
          style={{ marginBottom: 12, borderRadius: 8, border: "1px solid #e8e8e8" }}
          title={<span style={{ fontSize: 13 }}>搜索结果 ({agentData.results.length})</span>}
        >
          <List
            size="small"
            dataSource={agentData.results.slice(0, 5)}
            renderItem={(item: any) => (
              <List.Item style={{ padding: "6px 0" }}>
                <div>
                  <a href={item.link} target="_blank" rel="noopener" style={{ fontSize: 13 }}>
                    {item.title}
                  </a>
                  <div style={{ color: "#999", fontSize: 12, marginTop: 2 }}>{item.snippet}</div>
                </div>
              </List.Item>
            )}
          />
        </Card>
      )}

      {/* Article preview */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "20px",
          background: "linear-gradient(180deg, #fafafa 0%, #fff 100%)",
          borderRadius: 8,
          border: "1px solid #f0f0f0",
        }}
      >
        {displayText ? (
          <div className="markdown-body">
            <ReactMarkdown>{displayText}</ReactMarkdown>
          </div>
        ) : (
          <div style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            opacity: 0.5,
          }}>
            <Empty
              description={
                <span style={{ color: "#999" }}>
                  润色结果将在这里实时预览
                </span>
              }
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          </div>
        )}
      </div>

      {/* Quality report */}
      {agentStep === "validating" && agentData?.report && (
        <Card size="small" style={{ marginTop: 12, borderRadius: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 500 }}>质量检查：</span>
            <Tag color={agentData.report.passed ? "green" : "orange"}>
              {agentData.report.passed ? "通过" : "需修改"}
            </Tag>
          </div>
          {agentData.report.issues?.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {agentData.report.issues.map((issue: string, i: number) => (
                <Tag key={i} color="orange">{issue}</Tag>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
