import json
import asyncio
import redis
from typing import AsyncGenerator
from app.agent.states import AgentStep, STEP_ORDER
from app.tools.search import SearchTool
from app.tools.llm import LLMCaller
from app.api.schemas import SSEEvent


# ── Prompt templates ──

EXTRACT_QUERIES_PROMPT = """你是一个数据验证专家。请从以下文章中提取所有需要用真实数据验证的关键声明。

提取规则：
1. 包含具体数字/统计的声明（如"市场规模达XX亿"）
2. 提到具体公司/产品的声明（如"XX公司融资XX亿"）
3. 涉及行业排名/市场地位的声明

请以JSON数组格式输出，每个元素包含：
- "claim": 原文中的声明
- "query": 用于搜索验证的搜索词

仅输出JSON，不要其他内容。

文章内容：
{source_text}
"""

REWRITE_PROMPT = """你是一位资深公众号编辑，擅长将科研/学术风格的深度分析文章润色为大众可读的微信公众号推文。

## 润色规则

### 受众：{audience}
### 篇幅：{length}
### 标题风格：{title_style}

### 核心原则
1. 保留完整分析逻辑链：问题诊断→根因→方案→为什么巨头做不了
2. 去掉所有研究术语，用通俗语言替代
3. 每个数字/数据必须有真实来源

### 数据替换
以下是从搜索中获得的真实数据，请用这些数据替换原文中的估算/假设：
{search_data}

### 术语翻译规则
- TRIZ矛盾矩阵 → "核心冲突"/"根本性矛盾"
- FOS跨界映射 → "从其他行业找解法"/"跨界借鉴"
- 因果递归图谱 → "层层追问为什么"
- 形式化验证 → "自动化安全验证"
- 知识图谱RAG → "内置合规知识库"
- 分割原理 → "把流程拆成两步"
- 中介原理 → "引入中间层"

### 格式要求
- 使用 emoji + 中文小标题
- 关键数字加粗
- 重要结论用 block quote
- 每个机会方向必须包含：真实痛点 + 创业解法 + 真实案例参考
- 结尾加数据来源附录

请润色以下文章：

{source_text}
"""

VALIDATE_PROMPT = """你是一位质量审核专家。请检查以下公众号推文的质量。

## 检查清单

1. **数据溯源**：每个数字/统计是否标注了来源？是否有未标注来源的数据？
2. **术语残留**：是否还有未翻译的学术/研究术语？
3. **逻辑完整性**：分析链是否完整？每个section是否逻辑衔接？
4. **案例真实性**：提到的公司/产品是否真实存在？
5. **格式规范**：是否有emoji小标题？关键数字是否加粗？是否有block quote？

请以JSON格式输出：
{{
  "passed": true/false,
  "checks": [
    {{"item": "检查项名称", "passed": true/false, "detail": "详情"}},
    ...
  ],
  "issues": ["问题1", "问题2"],
  "suggestions": ["建议1", "建议2"]
}}

推文内容：
{article_text}
"""


class AgentEngine:
    """核心 Agent 引擎 - 4 步状态机驱动"""

    def __init__(self):
        self.search = SearchTool()
        self.llm = LLMCaller()
        self._redis = redis.from_url("redis://localhost:6379/0", decode_responses=True)

    def _pub_key(self, task_id: str) -> str:
        return f"agent:events:{task_id}"

    async def _emit(self, task_id: str, event: SSEEvent):
        """发布 SSE 事件到 Redis pub/sub"""
        self._redis.publish(self._pub_key(task_id), event.model_dump_json())

    async def subscribe(self, task_id: str) -> AsyncGenerator[SSEEvent, None]:
        """订阅 Agent 事件流"""
        pubsub = self._redis.pubsub()
        channel = self._pub_key(task_id)
        pubsub.subscribe(channel)
        try:
            for message in pubsub.listen():
                if message["type"] == "message":
                    yield SSEEvent.model_validate_json(message["data"])
                    if json.loads(message["data"]).get("step") == "completed":
                        break
                    if json.loads(message["data"]).get("step") == "failed":
                        break
        finally:
            pubsub.unsubscribe(channel)
            pubsub.close()

    async def run(self, task_id: str, source_text: str, config: dict) -> dict:
        """执行完整的 4 步 Agent 工作流"""
        try:
            # Step 1: Requirements (auto mode)
            await self._emit(task_id, SSEEvent(
                step=AgentStep.REQUIREMENTS, status="running",
                message="分析文章，确认润色需求...",
            ))
            await asyncio.sleep(0.3)
            await self._emit(task_id, SSEEvent(
                step=AgentStep.REQUIREMENTS, status="done",
                message="需求确认完成", data={"config": config},
            ))

            # Step 2: Search real data
            await self._emit(task_id, SSEEvent(
                step=AgentStep.SEARCHING, status="running",
                message="提取关键声明，搜索真实数据...",
            ))
            search_data = await self._step_search(source_text)
            await self._emit(task_id, SSEEvent(
                step=AgentStep.SEARCHING, status="done",
                message=f"搜索完成，找到 {len(search_data)} 条数据",
                data={"results": search_data},
            ))

            # Step 3: Rewrite
            await self._emit(task_id, SSEEvent(
                step=AgentStep.REWRITING, status="running",
                message="LLM 润色改写中...",
            ))
            draft = await self._step_rewrite(source_text, search_data, config)
            await self._emit(task_id, SSEEvent(
                step=AgentStep.REWRITING, status="done",
                message="润色完成",
                data={"preview": draft[:500] + "..." if len(draft) > 500 else draft},
            ))

            # Step 4: Validate
            await self._emit(task_id, SSEEvent(
                step=AgentStep.VALIDATING, status="running",
                message="质量检查中...",
            ))
            report = await self._step_validate(draft)
            await self._emit(task_id, SSEEvent(
                step=AgentStep.VALIDATING, status="done",
                message="质量检查完成",
                data={"report": report},
            ))

            # Complete
            await self._emit(task_id, SSEEvent(
                step=AgentStep.COMPLETED, status="done",
                message="润色完成！",
            ))

            return {
                "search_results": search_data,
                "draft_text": draft,
                "final_text": draft,
                "quality_report": report,
            }

        except Exception as e:
            await self._emit(task_id, SSEEvent(
                step=AgentStep.FAILED, status="error",
                message=f"Agent 执行失败: {str(e)}",
            ))
            raise

    async def _step_search(self, source_text: str) -> list[dict]:
        """Step 2: 提取关键声明 + 联网搜索"""
        # 2a. 用便宜模型提取搜索词
        extract_resp = await self.llm.call(
            prompt=EXTRACT_QUERIES_PROMPT.format(source_text=source_text),
            system="你是一个数据验证专家，只输出JSON。",
            model="deepseek-chat",
            temperature=0.1,
            max_tokens=2000,
        )

        queries = []
        try:
            # Try to parse JSON from response
            text = extract_resp.strip()
            if text.startswith("```"):
                text = text.split("```")[1]
                if text.startswith("json"):
                    text = text[4:]
            parsed = json.loads(text)
            queries = [item["query"] for item in parsed if "query" in item]
        except (json.JSONDecodeError, KeyError):
            # Fallback: extract first 3 sentences with numbers
            queries = [" ".join(source_text.split()[:20])]

        # 2b. Execute searches
        all_results = await self.search.search_multiple(queries[:5])
        return all_results

    async def _step_rewrite(self, source_text: str, search_data: list[dict], config: dict) -> str:
        """Step 3: LLM 润色改写"""
        search_formatted = json.dumps(search_data, ensure_ascii=False, indent=2)

        audience_map = {"entrepreneur": "创业者/投资人", "developer": "开发者/技术人", "general": "大众读者"}
        length_map = {"concise": "精简（~1500字）", "standard": "标准深度（~2500字）", "full": "保留深度（~3500字）"}
        title_map = {"informative": "干货型", "suspense": "悬念型", "story": "故事型"}

        result = await self.llm.call(
            prompt=REWRITE_PROMPT.format(
                source_text=source_text,
                search_data=search_formatted,
                audience=audience_map.get(config.get("audience", "entrepreneur"), "创业者/投资人"),
                length=length_map.get(config.get("length", "full"), "保留深度"),
                title_style=title_map.get(config.get("title_style", "suspense"), "悬念型"),
            ),
            system="你是一位资深公众号编辑，擅长深度分析文章的润色改写。直接输出润色后的推文内容，不要加任何解释或说明。",
            model=config.get("model", "gpt-4o"),
            temperature=0.7,
            max_tokens=8000,
        )
        return result.strip()

    async def _step_validate(self, article_text: str) -> dict:
        """Step 4: 质量检查"""
        result = await self.llm.call(
            prompt=VALIDATE_PROMPT.format(article_text=article_text),
            system="你是一位质量审核专家，只输出JSON格式的检查报告。",
            model="deepseek-chat",
            temperature=0.1,
            max_tokens=2000,
        )

        try:
            text = result.strip()
            if text.startswith("```"):
                text = text.split("```")[1]
                if text.startswith("json"):
                    text = text[4:]
            return json.loads(text)
        except json.JSONDecodeError:
            return {"passed": False, "checks": [], "issues": ["无法解析检查报告"], "suggestions": []}
