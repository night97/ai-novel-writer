import json
import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import AppConfig
from app.models.schemas import (
    LLMConfigResponse,
    LLMConfigUpdate,
    LLMProfileCreate,
    LLMProfileUpdate,
    LLMProfilesResponse,
)
from app.services.llm_service import llm_service

router = APIRouter(prefix="/api/settings", tags=["settings"])

LLM_KEYS = {
    "provider": "llm.provider",
    "api_key": "llm.api_key",
    "base_url": "llm.base_url",
    "model": "llm.model",
    "max_tokens": "llm.max_tokens",
}

PROFILE_KEYS = {
    "profiles": "llm.profiles",
    "active_profile_id": "llm.active_profile_id",
}


def _get_kv(db: Session, key: str):
    item = db.query(AppConfig).filter(AppConfig.config_key == key).first()
    return item.config_value if item else None


def _set_kv(db: Session, key: str, value: str):
    item = db.query(AppConfig).filter(AppConfig.config_key == key).first()
    if item:
        item.config_value = value
    else:
        item = AppConfig(config_key=key, config_value=value)
        db.add(item)


def _normalize_provider(provider: str) -> str:
    p = (provider or "").strip().lower()
    return p if p in ["anthropic", "openai"] else "anthropic"


def _default_base_url(provider: str) -> str:
    return "https://api.anthropic.com" if provider == "anthropic" else "https://api.openai.com/v1"


def _normalize_profile_meta(profile: dict) -> dict:
    if "enabled" not in profile:
        profile["enabled"] = True
    if "tags" not in profile or not isinstance(profile["tags"], list):
        profile["tags"] = []
    if "last_check" not in profile or not isinstance(profile["last_check"], dict):
        profile["last_check"] = {}
    return profile


def _runtime_to_profile(runtime: dict):
    provider = _normalize_provider(runtime.get("provider", "anthropic"))
    return {
        "id": "default",
        "name": "默认配置",
        "provider": provider,
        "api_key": runtime.get("api_key", ""),
        "base_url": runtime.get("base_url", _default_base_url(provider)),
        "model": runtime.get("model", ""),
        "max_tokens": int(runtime.get("max_tokens", 16384)),
    }


def _legacy_to_profile(db: Session):
    runtime = llm_service.get_runtime_config()
    provider = _get_kv(db, LLM_KEYS["provider"]) or runtime["provider"]
    api_key = _get_kv(db, LLM_KEYS["api_key"]) or runtime["api_key"]
    base_url = _get_kv(db, LLM_KEYS["base_url"]) or runtime["base_url"]
    model = _get_kv(db, LLM_KEYS["model"]) or runtime["model"]
    max_tokens_raw = _get_kv(db, LLM_KEYS["max_tokens"])
    max_tokens = int(max_tokens_raw) if max_tokens_raw else int(runtime["max_tokens"])

    provider = _normalize_provider(provider)
    if not base_url:
        base_url = _default_base_url(provider)

    return {
        "id": "migrated",
        "name": "历史配置",
        "provider": provider,
        "api_key": api_key,
        "base_url": base_url,
        "model": model,
        "max_tokens": max_tokens,
    }


def _load_profiles(db: Session):
    raw = _get_kv(db, PROFILE_KEYS["profiles"])
    active_id = _get_kv(db, PROFILE_KEYS["active_profile_id"])

    profiles = []
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                profiles = [_normalize_profile_meta(p) for p in parsed if isinstance(p, dict)]
        except Exception:
            profiles = []

    if not profiles:
        legacy_profile = _legacy_to_profile(db)
        profiles = [legacy_profile]
        active_id = legacy_profile["id"]
        _save_profiles(db, profiles, active_id)
        db.commit()

    if not active_id or not any(p.get("id") == active_id for p in profiles):
        active_id = profiles[0]["id"]
        _save_profiles(db, profiles, active_id)
        db.commit()

    return profiles, active_id


def _save_profiles(db: Session, profiles, active_id: str):
    _set_kv(db, PROFILE_KEYS["profiles"], json.dumps(profiles, ensure_ascii=False))
    _set_kv(db, PROFILE_KEYS["active_profile_id"], active_id)


def _apply_active_profile(profiles, active_id: str):
    active = next((p for p in profiles if p.get("id") == active_id), None)
    if not active:
        raise HTTPException(status_code=404, detail="活动模型配置不存在")

    provider = _normalize_provider(active.get("provider", "anthropic"))
    if active.get("enabled") is False:
        raise HTTPException(status_code=400, detail="当前活动模型配置已禁用，请先启用或切换配置")
    payload = {
        "provider": provider,
        "api_key": (active.get("api_key") or "").strip(),
        "base_url": (active.get("base_url") or "").strip() or _default_base_url(provider),
        "model": (active.get("model") or "").strip(),
        "max_tokens": int(active.get("max_tokens") or 16384),
    }
    llm_service.set_runtime_config(payload)
    return payload


def sync_llm_runtime_with_active_profile(db: Session) -> dict:
    """强制将运行时模型配置同步为数据库当前活动配置"""
    profiles, active_id = _load_profiles(db)
    active = next((p for p in profiles if p.get("id") == active_id), None)
    if not active:
        raise HTTPException(status_code=404, detail="活动模型配置不存在")
    runtime = _apply_active_profile(profiles, active_id)
    return {
        "active_profile_id": active_id,
        "active_profile_name": active.get("name", ""),
        "runtime": runtime,
    }


@router.post("/llm/validate")
def validate_llm_config(data: dict):
    provider = (data.get("provider") or "").strip().lower()
    payload = {
        "provider": provider,
        "api_key": (data.get("api_key") or "").strip(),
        "base_url": (data.get("base_url") or "").strip(),
        "model": (data.get("model") or "").strip(),
        "max_tokens": int(data.get("max_tokens") or 1024),
    }
    return llm_service.validate_config(payload)


@router.get("/llm/profiles", response_model=LLMProfilesResponse)
def get_llm_profiles(db: Session = Depends(get_db)):
    profiles, active_id = _load_profiles(db)
    return {"active_profile_id": active_id, "profiles": profiles}


@router.post("/llm/profiles", response_model=LLMProfilesResponse)
def create_llm_profile(data: LLMProfileCreate, db: Session = Depends(get_db)):
    profiles, active_id = _load_profiles(db)

    provider = _normalize_provider(data.provider)
    new_profile = {
        "id": str(uuid.uuid4()),
        "name": data.name.strip() or "未命名配置",
        "provider": provider,
        "api_key": data.api_key.strip(),
        "base_url": (data.base_url or "").strip() or _default_base_url(provider),
        "model": data.model.strip(),
        "max_tokens": int(data.max_tokens),
        "enabled": True,
        "tags": [],
        "last_check": {},
    }
    profiles.append(new_profile)

    _save_profiles(db, profiles, active_id)
    db.commit()
    return {"active_profile_id": active_id, "profiles": profiles}


@router.put("/llm/profiles/{profile_id}", response_model=LLMProfilesResponse)
def update_llm_profile(profile_id: str, data: LLMProfileUpdate, db: Session = Depends(get_db)):
    profiles, active_id = _load_profiles(db)

    target = next((p for p in profiles if p.get("id") == profile_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="模型配置不存在")

    provider = _normalize_provider(data.provider)
    target["name"] = data.name.strip() or target.get("name") or "未命名配置"
    target["provider"] = provider
    target["api_key"] = data.api_key.strip()
    target["base_url"] = (data.base_url or "").strip() or _default_base_url(provider)
    target["model"] = data.model.strip()
    target["max_tokens"] = int(data.max_tokens)
    _normalize_profile_meta(target)

    _save_profiles(db, profiles, active_id)
    db.commit()

    if active_id == profile_id:
        _apply_active_profile(profiles, active_id)

    return {"active_profile_id": active_id, "profiles": profiles}


@router.put("/llm/profiles/{profile_id}/meta", response_model=LLMProfilesResponse)
def update_llm_profile_meta(profile_id: str, data: dict, db: Session = Depends(get_db)):
    profiles, active_id = _load_profiles(db)
    target = next((p for p in profiles if p.get("id") == profile_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="模型配置不存在")

    if "enabled" in data:
        target["enabled"] = bool(data.get("enabled"))
    if "tags" in data and isinstance(data.get("tags"), list):
        target["tags"] = [str(x).strip() for x in data.get("tags") if str(x).strip()]
    _normalize_profile_meta(target)

    if active_id == profile_id and target.get("enabled") is False:
        raise HTTPException(status_code=400, detail="不能禁用当前活动配置，请先切换其他配置")

    _save_profiles(db, profiles, active_id)
    db.commit()
    return {"active_profile_id": active_id, "profiles": profiles}


@router.delete("/llm/profiles/{profile_id}", response_model=LLMProfilesResponse)
def delete_llm_profile(profile_id: str, db: Session = Depends(get_db)):
    profiles, active_id = _load_profiles(db)
    if len(profiles) <= 1:
        raise HTTPException(status_code=400, detail="至少保留一个模型配置")

    next_profiles = [p for p in profiles if p.get("id") != profile_id]
    if len(next_profiles) == len(profiles):
        raise HTTPException(status_code=404, detail="模型配置不存在")

    if active_id == profile_id:
        active_id = next_profiles[0]["id"]

    _save_profiles(db, next_profiles, active_id)
    db.commit()
    _apply_active_profile(next_profiles, active_id)

    return {"active_profile_id": active_id, "profiles": next_profiles}


@router.put("/llm/active/{profile_id}", response_model=LLMProfilesResponse)
def switch_active_profile(profile_id: str, db: Session = Depends(get_db)):
    profiles, _active_id = _load_profiles(db)
    if not any(p.get("id") == profile_id for p in profiles):
        raise HTTPException(status_code=404, detail="模型配置不存在")
    target = next((p for p in profiles if p.get("id") == profile_id), None)
    if target and target.get("enabled") is False:
        raise HTTPException(status_code=400, detail="该配置已禁用，无法切换为活动配置")

    _save_profiles(db, profiles, profile_id)
    db.commit()
    _apply_active_profile(profiles, profile_id)

    return {"active_profile_id": profile_id, "profiles": profiles}


@router.post("/llm/profiles/{profile_id}/check", response_model=LLMProfilesResponse)
def check_profile(profile_id: str, db: Session = Depends(get_db)):
    profiles, active_id = _load_profiles(db)
    target = next((p for p in profiles if p.get("id") == profile_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="模型配置不存在")

    result = llm_service.validate_config({
        "provider": target.get("provider", ""),
        "api_key": target.get("api_key", ""),
        "base_url": target.get("base_url", ""),
        "model": target.get("model", ""),
        "max_tokens": target.get("max_tokens", 1024),
    })
    target["last_check"] = result
    _normalize_profile_meta(target)
    _save_profiles(db, profiles, active_id)
    db.commit()
    return {"active_profile_id": active_id, "profiles": profiles}


@router.get("/llm/runtime")
def get_llm_runtime(db: Session = Depends(get_db)):
    """查看当前运行时到底在用哪个模型（用于排查不一致）"""
    profiles, active_id = _load_profiles(db)
    active = next((p for p in profiles if p.get("id") == active_id), None)
    runtime = llm_service.get_runtime_config()
    return {
        "active_profile_id": active_id,
        "active_profile_name": active.get("name", "") if active else "",
        "active_profile_provider": active.get("provider", "") if active else "",
        "active_profile_model": active.get("model", "") if active else "",
        "runtime_provider": runtime.get("provider", ""),
        "runtime_model": runtime.get("model", ""),
        "runtime_base_url": runtime.get("base_url", ""),
        "is_consistent": bool(active) and active.get("provider", "") == runtime.get("provider", "") and active.get("model", "") == runtime.get("model", ""),
    }


@router.get("/llm/call-logs")
def get_llm_call_logs(limit: int = 50):
    return {"logs": llm_service.get_call_logs(limit=limit)}


# 兼容旧接口（默认读/写当前活动配置）
@router.get("/llm", response_model=LLMConfigResponse)
def get_llm_settings(db: Session = Depends(get_db)):
    profiles, active_id = _load_profiles(db)
    active = next((p for p in profiles if p.get("id") == active_id), None)
    if not active:
        active = _runtime_to_profile(llm_service.get_runtime_config())
    return {
        "provider": active["provider"],
        "api_key": active["api_key"],
        "base_url": active["base_url"],
        "model": active["model"],
        "max_tokens": int(active["max_tokens"]),
    }


@router.put("/llm", response_model=LLMConfigResponse)
def update_llm_settings(data: LLMConfigUpdate, db: Session = Depends(get_db)):
    profiles, active_id = _load_profiles(db)
    active = next((p for p in profiles if p.get("id") == active_id), None)
    if not active:
        raise HTTPException(status_code=404, detail="活动模型配置不存在")

    provider = _normalize_provider(data.provider)
    active.update({
        "provider": provider,
        "api_key": data.api_key.strip(),
        "base_url": (data.base_url or "").strip() or _default_base_url(provider),
        "model": data.model.strip(),
        "max_tokens": int(data.max_tokens),
    })

    _save_profiles(db, profiles, active_id)
    db.commit()
    _apply_active_profile(profiles, active_id)

    return {
        "provider": active["provider"],
        "api_key": active["api_key"],
        "base_url": active["base_url"],
        "model": active["model"],
        "max_tokens": int(active["max_tokens"]),
    }
