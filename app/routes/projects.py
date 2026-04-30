from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
import json
from app.database import get_db
from app.models.models import (
    NovelProject, WorldSetting, Character, Volume, Chapter, ProjectCreativeProfile,
    CharacterRelationship, CreativeSession, CreativeMessage, CreativeVersion, AppConfig
)
from app.models.schemas import (
    NovelProjectCreate,
    NovelProjectResponse,
    WorldSettingResponse,
    ProjectCreativeProfileCreate,
    ProjectCreativeProfileResponse,
)
from app.services.llm_service import llm_service

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _serialize_project_bundle(db: Session, project_id: int):
    project = db.query(NovelProject).filter(NovelProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    world = db.query(WorldSetting).filter(WorldSetting.project_id == project_id).first()
    creative_profile = db.query(ProjectCreativeProfile).filter(ProjectCreativeProfile.project_id == project_id).first()
    chars = db.query(Character).filter(Character.project_id == project_id).order_by(Character.id.asc()).all()
    rels = db.query(CharacterRelationship).filter(CharacterRelationship.project_id == project_id).all()
    vols = db.query(Volume).filter(Volume.project_id == project_id).order_by(Volume.volume_index.asc(), Volume.id.asc()).all()
    chapters = db.query(Chapter).filter(Chapter.project_id == project_id).order_by(Chapter.volume_id.asc(), Chapter.chapter_index.asc()).all()
    sessions = db.query(CreativeSession).filter(CreativeSession.project_id == project_id).all()
    session_ids = [s.id for s in sessions]
    messages = db.query(CreativeMessage).filter(CreativeMessage.session_id.in_(session_ids)).all() if session_ids else []
    versions = db.query(CreativeVersion).filter(CreativeVersion.project_id == project_id).all()
    cfgs = db.query(AppConfig).filter(
        (AppConfig.config_key.like(f"official_version:{project_id}:%")) |
        (AppConfig.config_key.like(f"system_profile:{project_id}:%"))
    ).all()

    char_id_to_name = {c.id: c.name for c in chars}

    vol_id_to_idx = {v.id: v.volume_index for v in vols}
    vol_id_to_title = {v.id: v.title for v in vols}
    chapters_json = []
    for c in chapters:
        chapters_json.append({
            "volume_index": vol_id_to_idx.get(c.volume_id, 0),
            "volume_title": vol_id_to_title.get(c.volume_id, ""),
            "chapter_index": c.chapter_index,
            "title": c.title or "",
            "goal": c.goal or "",
            "conflict": c.conflict or "",
            "cost": c.cost or "",
            "strand": c.strand or "",
            "cool_point_type": c.cool_point_type or "",
            "hook": c.hook or "",
            "antagonist_level": c.antagonist_level or "",
            "pov": c.pov or "",
            "outline": c.outline or "",
            "content": c.content or "",
            "word_count": c.word_count or 0,
            "is_generated": bool(c.is_generated),
        })

    session_id_map = {s.id: f"{s.module}:{s.title or ''}:{s.created_at.isoformat() if s.created_at else ''}" for s in sessions}
    messages_json = [{
        "session_key": session_id_map.get(m.session_id, ""),
        "role": m.role,
        "content": m.content,
        "proposal_json": m.proposal_json or "",
        "summary": m.summary or "",
        "created_at": m.created_at.isoformat() if m.created_at else "",
    } for m in messages]
    versions_json = [{
        "module": v.module,
        "version_no": v.version_no,
        "summary": v.summary or "",
        "content_json": v.content_json or "",
        "created_at": v.created_at.isoformat() if v.created_at else "",
    } for v in versions]

    return {
        "schema_version": 1,
        "export_type": "ai_novel_writer_project_bundle",
        "project": {
            "title": project.title,
            "description": project.description or "",
            "genre": project.genre,
            "master_outline": project.master_outline or "",
            "enable_review": bool(project.enable_review),
            "target_words_per_chapter": project.target_words_per_chapter or 2000,
        },
        "creative_profile": {
            "core_contrast": (creative_profile.core_contrast if creative_profile else "") or "",
            "cheat_cost": (creative_profile.cheat_cost if creative_profile else "") or "",
            "reader_promise": (creative_profile.reader_promise if creative_profile else "") or "",
            "unique_mechanism": (creative_profile.unique_mechanism if creative_profile else "") or "",
        },
        "world": {
            "background": (world.background if world else "") or "",
            "power_system": (world.power_system if world else "") or "",
            "geography": (world.geography if world else "") or "",
            "factions": (world.factions if world else "") or "",
            "rules": (world.rules if world else "") or "",
        },
        "characters": [{
            "name": c.name,
            "role": c.role or "",
            "avatar": c.avatar or "",
            "personality": c.personality or "",
            "background": c.background or "",
            "abilities": c.abilities or "",
            "relationships": c.relationships or "",
            "is_main": bool(c.is_main),
        } for c in chars],
        "character_relationships": [{
            "source_name": char_id_to_name.get(r.source_character_id, ""),
            "target_name": char_id_to_name.get(r.target_character_id, ""),
            "relation_type": r.relation_type or "ally",
            "intensity": r.intensity if r.intensity is not None else 0.5,
            "status": r.status or "stable",
            "notes": r.notes or "",
        } for r in rels],
        "volumes": [{
            "volume_index": v.volume_index,
            "title": v.title or "",
            "summary": v.summary or "",
            "beat_sheet": v.beat_sheet or "",
            "core_conflict": v.core_conflict or "",
            "climax": v.climax or "",
        } for v in vols],
        "chapters": chapters_json,
        "workbench": {
            "messages": messages_json,
            "versions": versions_json,
            "configs": [{
                "config_key": c.config_key,
                "config_value": c.config_value
            } for c in cfgs]
        }
    }

@router.get("/", response_model=List[NovelProjectResponse])
def list_projects(db: Session = Depends(get_db)):
    """获取所有项目列表"""
    projects = db.query(NovelProject).order_by(NovelProject.updated_at.desc()).all()
    return projects

@router.post("/", response_model=NovelProjectResponse)
def create_project(project: NovelProjectCreate, db: Session = Depends(get_db)):
    """创建新项目"""
    db_project = NovelProject(
        title=project.title,
        description=project.description,
        genre=project.genre,
        enable_review=project.enable_review,
        target_words_per_chapter=project.target_words_per_chapter
    )
    db.add(db_project)
    db.commit()
    db.refresh(db_project)
    return db_project

@router.get("/{project_id}", response_model=NovelProjectResponse)
def get_project(project_id: int, db: Session = Depends(get_db)):
    """获取项目信息"""
    project = db.query(NovelProject).filter(NovelProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    return project

@router.delete("/{project_id}")
def delete_project(project_id: int, db: Session = Depends(get_db)):
    """删除项目"""
    project = db.query(NovelProject).filter(NovelProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    # 删除关联数据
    db.query(WorldSetting).filter(WorldSetting.project_id == project_id).delete()
    db.query(Character).filter(Character.project_id == project_id).delete()
    db.query(Volume).filter(Volume.project_id == project_id).delete()
    db.query(Chapter).filter(Chapter.project_id == project_id).delete()

    db.delete(project)
    db.commit()
    return {"success": True, "message": "删除成功"}

@router.post("/{project_id}/generate-world")
def generate_world_setting(project_id: int, user_prompt: str = "", db: Session = Depends(get_db)):
    """生成世界观设定"""
    project = db.query(NovelProject).filter(NovelProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    # 检查是否已存在
    existing = db.query(WorldSetting).filter(WorldSetting.project_id == project_id).first()

    combined_prompt = f"{project.description}\n{user_prompt}".strip()
    result = llm_service.generate_world_setting(project.genre, combined_prompt)

    if existing:
        existing.background = result.get("background", existing.background)
        existing.power_system = result.get("power_system", existing.power_system)
        existing.geography = result.get("geography", existing.geography)
        existing.factions = result.get("factions", existing.factions)
        existing.rules = result.get("rules", existing.rules)
    else:
        existing = WorldSetting(
            project_id=project_id,
            background=result.get("background", ""),
            power_system=result.get("power_system", ""),
            geography=result.get("geography", ""),
            factions=result.get("factions", ""),
            rules=result.get("rules", "")
        )
        db.add(existing)

    db.commit()
    db.refresh(existing)
    return existing

@router.get("/{project_id}/world", response_model=WorldSettingResponse)
def get_world_setting(project_id: int, db: Session = Depends(get_db)):
    """获取世界观设定"""
    world = db.query(WorldSetting).filter(WorldSetting.project_id == project_id).first()
    if not world:
        raise HTTPException(status_code=404, detail="世界观设定不存在")
    return world

@router.put("/{project_id}/world", response_model=WorldSettingResponse)
def update_world_setting(project_id: int, data: dict, db: Session = Depends(get_db)):
    """更新世界观设定"""
    world = db.query(WorldSetting).filter(WorldSetting.project_id == project_id).first()
    if not world:
        raise HTTPException(status_code=404, detail="世界观设定不存在")

    if "background" in data:
        world.background = data["background"]
    if "power_system" in data:
        world.power_system = data["power_system"]
    if "geography" in data:
        world.geography = data["geography"]
    if "factions" in data:
        world.factions = data["factions"]
    if "rules" in data:
        world.rules = data["rules"]

    db.commit()
    db.refresh(world)
    return world


@router.get("/{project_id}/creative-profile", response_model=ProjectCreativeProfileResponse)
def get_creative_profile(project_id: int, db: Session = Depends(get_db)):
    """获取题材新颖度结构化配置"""
    profile = db.query(ProjectCreativeProfile).filter(ProjectCreativeProfile.project_id == project_id).first()
    if not profile:
        profile = ProjectCreativeProfile(project_id=project_id)
        db.add(profile)
        db.commit()
        db.refresh(profile)
    return profile


@router.put("/{project_id}/creative-profile", response_model=ProjectCreativeProfileResponse)
def upsert_creative_profile(project_id: int, data: ProjectCreativeProfileCreate, db: Session = Depends(get_db)):
    """更新题材新颖度结构化配置"""
    project = db.query(NovelProject).filter(NovelProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    profile = db.query(ProjectCreativeProfile).filter(ProjectCreativeProfile.project_id == project_id).first()
    if not profile:
        profile = ProjectCreativeProfile(project_id=project_id)
        db.add(profile)

    profile.core_contrast = data.core_contrast or ""
    profile.cheat_cost = data.cheat_cost or ""
    profile.reader_promise = data.reader_promise or ""
    profile.unique_mechanism = data.unique_mechanism or ""
    db.commit()
    db.refresh(profile)
    return profile


@router.get("/{project_id}/export")
def export_project_bundle(project_id: int, db: Session = Depends(get_db)):
    return _serialize_project_bundle(db, project_id)


@router.post("/import")
def import_project_bundle(payload: dict, db: Session = Depends(get_db)):
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="导入JSON格式错误")

    project_data = payload.get("project") or {}
    title = (project_data.get("title") or "导入项目").strip() or "导入项目"
    base_title = f"{title}-导入"
    final_title = base_title
    n = 2
    while db.query(NovelProject).filter(NovelProject.title == final_title).first():
        final_title = f"{base_title}-{n}"
        n += 1

    p = NovelProject(
        title=final_title,
        description=project_data.get("description", "") or "",
        genre=project_data.get("genre", "玄幻") or "玄幻",
        master_outline=project_data.get("master_outline", "") or "",
        enable_review=bool(project_data.get("enable_review", False)),
        target_words_per_chapter=int(project_data.get("target_words_per_chapter", 2000) or 2000),
    )
    db.add(p)
    db.flush()

    world = payload.get("world") or {}
    db.add(WorldSetting(
        project_id=p.id,
        background=world.get("background", "") or "",
        power_system=world.get("power_system", "") or "",
        geography=world.get("geography", "") or "",
        factions=world.get("factions", "") or "",
        rules=world.get("rules", "") or "",
    ))

    cp = payload.get("creative_profile") or {}
    db.add(ProjectCreativeProfile(
        project_id=p.id,
        core_contrast=cp.get("core_contrast", "") or "",
        cheat_cost=cp.get("cheat_cost", "") or "",
        reader_promise=cp.get("reader_promise", "") or "",
        unique_mechanism=cp.get("unique_mechanism", "") or "",
    ))

    char_name_to_id = {}
    for c in (payload.get("characters") or []):
        if not isinstance(c, dict):
            continue
        ch = Character(
            project_id=p.id,
            name=(c.get("name") or "未命名角色").strip() or "未命名角色",
            role=c.get("role", "") or "",
            avatar=c.get("avatar", "") or "",
            personality=c.get("personality", "") or "",
            background=c.get("background", "") or "",
            abilities=c.get("abilities", "") or "",
            relationships=c.get("relationships", "") or "",
            is_main=bool(c.get("is_main", False))
        )
        db.add(ch)
        db.flush()
        char_name_to_id[ch.name] = ch.id

    for r in (payload.get("character_relationships") or []):
        if not isinstance(r, dict):
            continue
        sid = char_name_to_id.get((r.get("source_name") or "").strip())
        tid = char_name_to_id.get((r.get("target_name") or "").strip())
        if not sid or not tid or sid == tid:
            continue
        db.add(CharacterRelationship(
            project_id=p.id,
            source_character_id=sid,
            target_character_id=tid,
            relation_type=r.get("relation_type", "ally") or "ally",
            intensity=float(r.get("intensity", 0.5) or 0.5),
            status=r.get("status", "stable") or "stable",
            notes=r.get("notes", "") or "",
        ))

    vol_idx_to_id = {}
    for v in (payload.get("volumes") or []):
        if not isinstance(v, dict):
            continue
        try:
            vi = int(v.get("volume_index", 1))
        except Exception:
            vi = 1
        vol = Volume(
            project_id=p.id,
            volume_index=vi,
            title=v.get("title", "") or "",
            summary=v.get("summary", "") or "",
            beat_sheet=v.get("beat_sheet", "") or "",
            core_conflict=v.get("core_conflict", "") or "",
            climax=v.get("climax", "") or "",
        )
        db.add(vol)
        db.flush()
        vol_idx_to_id[vi] = vol.id

    for c in (payload.get("chapters") or []):
        if not isinstance(c, dict):
            continue
        try:
            vi = int(c.get("volume_index", 1))
        except Exception:
            vi = 1
        vol_id = vol_idx_to_id.get(vi)
        if not vol_id:
            vol = Volume(project_id=p.id, volume_index=vi, title=c.get("volume_title", "") or "")
            db.add(vol)
            db.flush()
            vol_id = vol.id
            vol_idx_to_id[vi] = vol_id
        try:
            ci = int(c.get("chapter_index", 1))
        except Exception:
            ci = 1
        db.add(Chapter(
            project_id=p.id,
            volume_id=vol_id,
            chapter_index=ci,
            title=c.get("title", "") or "",
            goal=c.get("goal", "") or "",
            conflict=c.get("conflict", "") or "",
            cost=c.get("cost", "") or "",
            strand=c.get("strand", "") or "",
            cool_point_type=c.get("cool_point_type", "") or "",
            hook=c.get("hook", "") or "",
            antagonist_level=c.get("antagonist_level", "") or "",
            pov=c.get("pov", "") or "",
            outline=c.get("outline", "") or "",
            content=c.get("content", "") or "",
            word_count=int(c.get("word_count", 0) or 0),
            is_generated=bool(c.get("is_generated", False)),
        ))

    # 导入工作台版本（可选）
    wb = payload.get("workbench") or {}
    for v in (wb.get("versions") or []):
        if not isinstance(v, dict):
            continue
        db.add(CreativeVersion(
            project_id=p.id,
            module=v.get("module", "") or "",
            version_no=int(v.get("version_no", 1) or 1),
            summary=v.get("summary", "") or "",
            content_json=v.get("content_json", "") or "",
            source_message_id=None,
        ))
    for cfg in (wb.get("configs") or []):
        if not isinstance(cfg, dict):
            continue
        key = (cfg.get("config_key") or "").strip()
        val = cfg.get("config_value", "") or ""
        if not key:
            continue
        # 替换旧project_id前缀
        if key.startswith("official_version:"):
            parts = key.split(":")
            if len(parts) >= 3:
                key = f"official_version:{p.id}:{parts[2]}"
        elif key.startswith("system_profile:"):
            parts = key.split(":")
            if len(parts) >= 3:
                key = f"system_profile:{p.id}:{parts[2]}"
        db.add(AppConfig(config_key=key, config_value=val))

    db.commit()
    db.refresh(p)
    return {"success": True, "project_id": p.id, "title": p.title}
