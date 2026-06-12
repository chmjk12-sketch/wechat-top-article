import json
import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.database import get_db
from app.models.schema import Task as TaskModel
from app.api.schemas import TaskCreateRequest, TaskResponse, TaskConfirmRequest
from app.agent.engine import AgentEngine

router = APIRouter(prefix="/api/v1/tasks", tags=["tasks"])

agent_engine = AgentEngine()


def _task_to_response(task: TaskModel) -> dict:
    return {
        "id": str(task.id),
        "status": task.status,
        "current_step": task.current_step,
        "source_text": task.source_text,
        "config": task.config or {},
        "search_results": task.search_results or [],
        "draft_text": task.draft_text or "",
        "final_text": task.final_text or "",
        "quality_report": task.quality_report or {},
        "data_sources": task.data_sources or [],
        "created_at": task.created_at.isoformat() if task.created_at else "",
        "updated_at": task.updated_at.isoformat() if task.updated_at else "",
    }


@router.post("", response_model=TaskResponse)
async def create_task(
    req: TaskCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    """创建润色任务"""
    task = TaskModel(
        id=uuid.uuid4(),
        source_text=req.source_text,
        config=req.config.model_dump(),
        status="running",
        current_step="requirements",
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)

    # Run agent in background (asyncio for MVP, Celery for production)
    import asyncio
    asyncio.create_task(_run_agent(task.id, req.source_text, req.config.model_dump(), db))

    return _task_to_response(task)


async def _run_agent(task_id: uuid.UUID, source_text: str, config: dict, db: AsyncSession):
    """后台运行 Agent"""
    try:
        result = await agent_engine.run(str(task_id), source_text, config)

        # Update task in DB
        stmt = select(TaskModel).where(TaskModel.id == task_id)
        db_result = await db.execute(stmt)
        task = db_result.scalar_one_or_none()
        if task:
            task.status = "completed"
            task.current_step = "completed"
            task.search_results = result.get("search_results", [])
            task.draft_text = result.get("draft_text", "")
            task.final_text = result.get("final_text", "")
            task.quality_report = result.get("quality_report", {})
            task.updated_at = datetime.utcnow()
            await db.commit()
    except Exception as e:
        stmt = select(TaskModel).where(TaskModel.id == task_id)
        db_result = await db.execute(stmt)
        task = db_result.scalar_one_or_none()
        if task:
            task.status = "failed"
            task.current_step = "failed"
            task.updated_at = datetime.utcnow()
            await db.commit()


@router.get("/{task_id}", response_model=TaskResponse)
async def get_task(task_id: str, db: AsyncSession = Depends(get_db)):
    """查询任务状态"""
    stmt = select(TaskModel).where(TaskModel.id == uuid.UUID(task_id))
    result = await db.execute(stmt)
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return _task_to_response(task)


@router.get("/{task_id}/stream")
async def stream_task(task_id: str):
    """SSE 实时推送 Agent 进度"""
    async def event_generator():
        async for event in agent_engine.subscribe(task_id):
            yield f"data: {event.model_dump_json()}\n\n"
    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/{task_id}/confirm")
async def confirm_task(
    task_id: str,
    req: TaskConfirmRequest,
    db: AsyncSession = Depends(get_db),
):
    """步骤1确认需求"""
    stmt = select(TaskModel).where(TaskModel.id == uuid.UUID(task_id))
    result = await db.execute(stmt)
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if req.audience:
        task.config["audience"] = req.audience.value
    if req.length:
        task.config["length"] = req.length.value
    if req.title_style:
        task.config["title_style"] = req.title_style.value
    task.updated_at = datetime.utcnow()
    await db.commit()
    return _task_to_response(task)


@router.get("", response_model=list[TaskResponse])
async def list_tasks(db: AsyncSession = Depends(get_db), limit: int = 20, offset: int = 0):
    """历史记录列表"""
    stmt = select(TaskModel).order_by(TaskModel.created_at.desc()).limit(limit).offset(offset)
    result = await db.execute(stmt)
    tasks = result.scalars().all()
    return [_task_to_response(t) for t in tasks]
