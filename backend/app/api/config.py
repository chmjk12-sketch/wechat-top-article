from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.models.database import get_db
from app.models.schema import AppConfig as AppConfigModel
from app.api.schemas import ConfigResponse, ConfigUpdate
from typing import List

router = APIRouter(prefix="/api/v1/config", tags=["config"])


@router.get("", response_model=ConfigResponse)
def get_config(db: Session = Depends(get_db)):
    """获取当前配置（敏感字段脱敏）"""
    cfg = db.query(AppConfigModel).filter(AppConfigModel.id == 1).first()
    if not cfg:
        # 返回默认值
        return ConfigResponse(
            llm_rewrite_model="gpt-4o",
            llm_search_model="deepseek-chat",
            llm_validate_model="gpt-4o",
            max_search_results=10,
            search_enabled={"serper": True, "tavily": False},
        )
    return ConfigResponse(
        llm_rewrite_model=cfg.llm_rewrite_model,
        llm_search_model=cfg.llm_search_model,
        llm_validate_model=cfg.llm_validate_model,
        max_search_results=cfg.max_search_results,
        search_enabled=cfg.search_enabled,
        # 敏感字段不返回
        openai_api_key_masked=mask_key(cfg.openai_api_key),
        anthropic_api_key_masked=mask_key(cfg.anthropic_api_key),
        deepseek_api_key_masked=mask_key(cfg.deepseek_api_key),
        serper_api_key_masked=mask_key(cfg.serper_api_key),
    )


@router.put("", response_model=ConfigResponse)
def update_config(payload: ConfigUpdate, db: Session = Depends(get_db)):
    """更新配置（前端界面写入）"""
    cfg = db.query(AppConfigModel).filter(AppConfigModel.id == 1).first()
    if not cfg:
        cfg = AppConfigModel(id=1)
        db.add(cfg)
        db.commit()
        db.refresh(cfg)

    # 只更新非 None 的字段
    updates = payload.model_dump(exclude_unset=True)
    for key, val in updates.items():
        if hasattr(cfg, key) and val is not None:
            setattr(cfg, key, val)

    db.commit()
    db.refresh(cfg)
    return get_config(db)


def mask_key(key: str) -> str:
    """API Key 脱敏显示，如 sk-abc...xyz"""
    if not key:
        return ""
    if len(key) <= 8:
        return "****"
    return key[:6] + "..." + key[-4:]
