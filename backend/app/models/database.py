from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import Session
from app.config import settings
import os

# SQLite 模式：本地开发无需 PostgreSQL
USE_SQLITE = not settings.DATABASE_URL.startswith("postgresql")

if USE_SQLITE:
    DB_URL = "sqlite+aiosqlite:///./article_forge.db"
else:
    DB_URL = settings.DATABASE_URL

# 异步引擎（FastAPI 路由用）
async_engine = create_async_engine(DB_URL, echo=settings.DEBUG)
async_session = async_sessionmaker(async_engine, class_=AsyncSession, expire_on_commit=False)

# 同步引擎（Celery / config 读取用）
if USE_SQLITE:
    sync_url = "sqlite:///./article_forge.db"
else:
    sync_url = settings.DATABASE_URL.replace("+asyncpg", "").replace("+psycopg2", "")

from sqlalchemy import create_engine as _create_engine
engine = _create_engine(sync_url, echo=settings.DEBUG)


async def get_db() -> AsyncSession:
    async with async_session() as session:
        yield session


async def init_db():
    async with async_engine.begin() as conn:
        from app.models.schema import Base
        await conn.run_sync(Base.metadata.create_all)
