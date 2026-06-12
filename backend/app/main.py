from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from sqlalchemy import inspect

from app.config import settings
from app.models.database import init_db, engine
from app.models.schema import AppConfig as AppConfigModel
from app.api.tasks import router as tasks_router
from app.api.config import router as config_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    # 初始化配置表（单例，id=1）
    from sqlalchemy.orm import sessionmaker
    Session = sessionmaker(bind=engine)
    with Session() as session:
        existing = session.query(AppConfigModel).filter(AppConfigModel.id == 1).first()
        if not existing:
            session.add(AppConfigModel(id=1))
            session.commit()
    yield


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tasks_router)
app.include_router(config_router)


@app.get("/api/v1/health")
async def health():
    return {"status": "ok", "version": settings.APP_VERSION}
