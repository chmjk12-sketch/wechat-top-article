from enum import Enum
from pydantic import BaseModel
from typing import Optional


class Audience(str, Enum):
    entrepreneur = "entrepreneur"
    developer = "developer"
    general = "general"


class Length(str, Enum):
    concise = "concise"
    standard = "standard"
    full = "full"


class TitleStyle(str, Enum):
    informative = "informative"
    suspense = "suspense"
    story = "story"


class TaskConfig(BaseModel):
    audience: Audience = Audience.entrepreneur
    length: Length = Length.full
    title_style: TitleStyle = TitleStyle.suspense
    model: str = "gpt-4o"


class TaskCreateRequest(BaseModel):
    source_text: str
    config: TaskConfig = TaskConfig()


class TaskConfirmRequest(BaseModel):
    confirmed: bool = True
    audience: Optional[Audience] = None
    length: Optional[Length] = None
    title_style: Optional[TitleStyle] = None


class TaskResponse(BaseModel):
    id: str
    status: str
    current_step: str
    source_text: str
    config: dict
    search_results: list
    draft_text: str
    final_text: str
    quality_report: dict
    data_sources: list
    created_at: str
    updated_at: str


class SSEEvent(BaseModel):
    step: str
    status: str
    message: str
    data: Optional[dict] = None


class ConfigResponse(BaseModel):
    llm_rewrite_model: str = "gpt-4o"
    llm_search_model: str = "deepseek-chat"
    llm_validate_model: str = "gpt-4o"
    max_search_results: int = 10
    search_enabled: dict = {"serper": True, "tavily": False}
    # 敏感字段脱敏显示
    openai_api_key_masked: str = ""
    anthropic_api_key_masked: str = ""
    deepseek_api_key_masked: str = ""
    serper_api_key_masked: str = ""


class ConfigUpdate(BaseModel):
    # API Keys（前端写入，空字符串表示不修改）
    openai_api_key: Optional[str] = None
    anthropic_api_key: Optional[str] = None
    deepseek_api_key: Optional[str] = None
    serper_api_key: Optional[str] = None
    # 模型选择
    llm_rewrite_model: Optional[str] = None
    llm_search_model: Optional[str] = None
    llm_validate_model: Optional[str] = None
    # 其他
    max_search_results: Optional[int] = None
    search_enabled: Optional[dict] = None
