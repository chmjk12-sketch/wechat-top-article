import uuid
from datetime import datetime
from sqlalchemy import Column, String, Text, DateTime, JSON, ForeignKey, Integer
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


def new_id():
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=new_id)
    email = Column(String(255), unique=True, index=True)
    name = Column(String(100))
    created_at = Column(DateTime, default=datetime.utcnow)

    tasks = relationship("Task", back_populates="user")


class Task(Base):
    __tablename__ = "tasks"

    id = Column(String(36), primary_key=True, default=new_id)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=True)
    source_text = Column(Text, nullable=False)
    config = Column(JSON, default=dict)
    status = Column(String(20), default="pending", index=True)
    current_step = Column(String(30), default="requirements")

    # Step results
    search_results = Column(JSON, default=list)
    draft_text = Column(Text, default="")
    final_text = Column(Text, default="")
    quality_report = Column(JSON, default=dict)
    data_sources = Column(JSON, default=list)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="tasks")
    versions = relationship("TaskVersion", back_populates="task")


class TaskVersion(Base):
    __tablename__ = "task_versions"

    id = Column(String(36), primary_key=True, default=new_id)
    task_id = Column(String(36), ForeignKey("tasks.id"))
    version = Column(Integer, default=1)
    text = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)

    task = relationship("Task", back_populates="versions")


class AppConfig(Base):
    """应用配置表：存储 API Key、模型选择等，支持前端界面修改"""
    __tablename__ = "app_config"

    id = Column(Integer, primary_key=True, default=1)  # 单例，id 固定为 1
    # LLM API Keys
    openai_api_key = Column(Text, default="")
    anthropic_api_key = Column(Text, default="")
    deepseek_api_key = Column(Text, default="")
    # 搜索 API Key
    serper_api_key = Column(Text, default="")
    # 模型选择
    llm_rewrite_model = Column(String(50), default="gpt-4o")
    llm_search_model = Column(String(50), default="deepseek-chat")
    llm_validate_model = Column(String(50), default="gpt-4o")
    # 其他配置
    max_search_results = Column(Integer, default=10)
    search_enabled = Column(JSON, default=lambda: {"serper": True, "tavily": False})
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
