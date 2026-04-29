from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models.models import NovelProject, WorldSetting, Character, Volume, Chapter
from app.models.schemas import NovelProjectCreate, NovelProjectResponse, WorldSettingResponse
from app.services.llm_service import llm_service

router = APIRouter(prefix="/api/projects", tags=["projects"])

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
