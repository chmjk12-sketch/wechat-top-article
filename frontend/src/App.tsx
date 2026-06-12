import { Layout, Typography, ConfigProvider, Button, Badge } from "antd";
import { SettingOutlined, ThunderboltOutlined } from "@ant-design/icons";
import SourceEditor from "./components/SourceEditor";
import PreviewPanel from "./components/PreviewPanel";
import StepPanel from "./components/StepPanel";
import ConfigPanel from "./components/ConfigPanel";
import { SettingsModal } from "./components/SettingsModal";
import { useState } from "react";
import { useForgeStore } from "./store/forge";
import "./App.css";

const { Header, Content } = Layout;
const { Title, Text } = Typography;

function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { appConfig, isRunning } = useForgeStore();
  const hasKeys = appConfig?.openai_api_key_masked || appConfig?.deepseek_api_key_masked;

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: "#534AB7",
          borderRadius: 8,
          colorBgContainer: "#fff",
        },
      }}
    >
      <Layout style={{ minHeight: "100vh", background: "#fff" }}>
        <Header
          style={{
            background: "linear-gradient(135deg, #534AB7 0%, #7C4DFF 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 24px",
            height: 56,
            boxShadow: "0 2px 8px rgba(83, 74, 183, 0.2)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <ThunderboltOutlined style={{ color: "#FFD700", fontSize: 22 }} />
            <Title level={4} style={{ margin: 0, color: "#fff", fontWeight: 700, letterSpacing: 1 }}>
              推文工坊
            </Title>
            <Text style={{ color: "rgba(255,255,255,0.65)", fontSize: 12, marginTop: 2 }}>
              ArticleForge
            </Text>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {!hasKeys && (
              <Badge status="warning" text={
                <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 12 }}>
                  未配置 API Key
                </Text>
              } />
            )}
            <Button
              type="text"
              icon={<SettingOutlined />}
              onClick={() => setSettingsOpen(true)}
              style={{ color: "#fff" }}
            >
              配置
            </Button>
          </div>
        </Header>

        <Content style={{ padding: "12px 24px", overflow: "hidden" }}>
          {/* Config panel */}
          <ConfigPanel />

          {/* Agent step progress */}
          <StepPanel />

          {/* Main editor area */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 16,
              height: "calc(100vh - 270px)",
              minHeight: 460,
            }}
          >
            <SourceEditor />
            <PreviewPanel />
          </div>
        </Content>
      </Layout>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </ConfigProvider>
  );
}

export default App;
