from pydantic_settings import BaseSettings
from typing import Optional, Callable
from sqlalchemy.orm import sessionmaker
from .models.database import engine
from .models.schema import AppConfig as AppConfigModel


class Settings(BaseSettings):
    # App
    APP_NAME: str = "ArticleForge"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = True

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://forge:forge@localhost:5432/article_forge"

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # LLM
    OPENAI_API_KEY: Optional[str] = None
    ANTHROPIC_API_KEY: Optional[str] = None
    DEEPSEEK_API_KEY: Optional[str] = None
    DEFAULT_LLM_MODEL: str = "gpt-4o"
    CHEAP_LLM_MODEL: str = "deepseek-chat"

    # Search
    SERPER_API_KEY: Optional[str] = None
    TAVILY_API_KEY: Optional[str] = None

    # Celery
    CELERY_BROKER_URL: str = "redis://localhost:6379/1"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/2"

    # CORS
    CORS_ORIGINS: list[str] = ["http://localhost:5173", "http://localhost:3000"]

    class Config:
        env_file = ".env"
        extra = "ignore"


# 全局设置单例
settings = Settings()


def get_db_config() -> dict:
    """
    从数据库读取配置，与环境变量合并。
    优先级：环境变量 > 数据库 > 默认值。
    返回扁平字典，key 与 Settings 字段对应。
    """
    result = {
        "OPENAI_API_KEY": settings.OPENAI_API_KEY,
        "ANTHROPIC_API_KEY": settings.ANTHROPIC_API_KEY,
        "DEEPSEEK_API_KEY": settings.DEEPSEEK_API_KEY,
        "SERPER_API_KEY": settings.SERPER_API_KEY,
        "DEFAULT_LLM_MODEL": settings.DEFAULT_LLM_MODEL,
        "CHEAP_LLM_MODEL": settings.CHEAP_LLM_MODEL,
    }

    try:
        Session = sessionmaker(bind=engine)
        with Session() as session:
            db_config = session.query(AppConfigModel).filter(AppConfigModel.id == 1).first()
            if db_config:
                mappings = {
                    "OPENAI_API_KEY": db_config.openai_api_key,
                    "ANTHROPIC_API_KEY": db_config.anthropic_api_key,
                    "DEEPSEEK_API_KEY": db_config.deepseek_api_key,
                    "SERPER_API_KEY": db_config.serper_api_key,
                    "DEFAULT_LLM_MODEL": db_config.llm_rewrite_model,
                    "CHEAP_LLM_MODEL": db_config.llm_search_model,
                }
                for key, db_val in mappings.items():
                    env_val = result.get(key)
                    if db_val and (not env_val or env_val == ""):
                        result[key] = db_val
    except Exception:
        pass  # 数据库不可用时降级到环境变量

    return result
