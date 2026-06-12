import { Input, Typography, Empty } from "antd";
import { EditOutlined } from "@ant-design/icons";
import { useForgeStore } from "../store/forge";

const { TextArea } = Input;
const { Title } = Typography;

export default function SourceEditor() {
  const { sourceText, setSourceText } = useForgeStore();

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <EditOutlined style={{ color: "#534AB7" }} />
        <Title level={5} style={{ margin: 0 }}>
          原文输入
        </Title>
      </div>
      <TextArea
        value={sourceText}
        onChange={(e) => setSourceText(e.target.value)}
        placeholder={"在这里粘贴你的科研/学术风格文章，点击「开始润色」即可生成公众号推文。\n\n支持 Markdown 格式。"}
        style={{
          flex: 1,
          minHeight: 400,
          fontFamily: "inherit",
          fontSize: 14,
          lineHeight: 1.8,
          resize: "none",
          borderColor: sourceText ? "#534AB7" : "#d9d9d9",
          borderWidth: sourceText ? 1.5 : 1,
          borderRadius: 8,
          padding: 16,
          transition: "border-color 0.3s",
        }}
      />
      <div style={{ marginTop: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "#999", fontSize: 12 }}>
          {sourceText.length > 0 ? `${sourceText.length} 字` : "等待输入..."}
        </span>
        {sourceText.length > 0 && sourceText.length < 100 && (
          <span style={{ color: "#faad14", fontSize: 12 }}>
            建议输入 100 字以上以获得更好效果
          </span>
        )}
      </div>
    </div>
  );
}
