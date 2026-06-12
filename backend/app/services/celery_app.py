from celery import Celery
from app.config import settings

celery_app = Celery(
    "article_forge",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Shanghai",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=300,
)


@celery_app.task(bind=True)
def run_agent_task(self, task_id: str, source_text: str, config: dict):
    """Celery 异步任务：运行 Agent Engine"""
    import asyncio
    from app.agent.engine import AgentEngine

    engine = AgentEngine()
    result = asyncio.run(engine.run(task_id, source_text, config))
    return result
