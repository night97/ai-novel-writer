from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models.models import NovelProject, Character, CharacterRelationship
from app.models.schemas import (
    CharacterCreate,
    CharacterResponse,
    CharacterRelationshipCreate,
    CharacterRelationshipUpdate,
    CharacterRelationshipResponse,
)
from app.services.llm_service import llm_service

router = APIRouter(prefix="/api/characters", tags=["characters"])

@router.get("/{project_id}", response_model=List[CharacterResponse])
def list_characters(project_id: int, db: Session = Depends(get_db)):
    """获取项目所有角色"""
    characters = db.query(Character)\
        .filter(Character.project_id == project_id)\
        .order_by(Character.is_main.desc())\
        .all()
    return characters

@router.post("/{project_id}", response_model=CharacterResponse)
def add_character(project_id: int, character: CharacterCreate, db: Session = Depends(get_db)):
    """添加角色"""
    project = db.query(NovelProject).filter(NovelProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    db_char = Character(
        project_id=project_id,
        name=character.name,
        role=character.role,
        avatar=character.avatar,
        personality=character.personality,
        background=character.background,
        abilities=character.abilities,
        relationships=character.relationships,
        is_main=character.is_main
    )
    db.add(db_char)
    db.commit()
    db.refresh(db_char)
    return db_char

@router.post("/{project_id}/generate")
def generate_characters(project_id: int, user_prompt: str = "", db: Session = Depends(get_db)):
    """生成角色列表"""
    project = db.query(NovelProject).filter(NovelProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    from app.models.models import WorldSetting
    world = db.query(WorldSetting).filter(WorldSetting.project_id == project_id).first()
    world_text = ""
    if world:
        world_text = f"背景: {world.background}\n力量体系: {world.power_system}"

    # 获取已有角色，传递给AI避免重复创造
    existing_chars = db.query(Character).filter(Character.project_id == project_id).all()
    existing_text = ""
    for c in existing_chars:
        existing_text += f"- {c.name}"
        if c.role:
            existing_text += f" ({c.role})"
        existing_text += "\n"

    combined_prompt = f"{project.description}\n{user_prompt}".strip()
    characters = llm_service.generate_characters(project.genre, world_text, combined_prompt, existing_text)

    saved = []
    # 收集本次生成中所有标记为主角的
    generated_mains = []

    for char in characters:
        name = char.get("name", "")
        is_main = char.get("is_main", False)

        # 检查是否已经有同名角色
        existing = db.query(Character).filter(
            Character.project_id == project_id,
            Character.name == name
        ).first()

        if existing:
            # 同名角色，更新信息
            existing.role = char.get("role", "") or existing.role
            existing.avatar = char.get("avatar", "") or existing.avatar
            existing.personality = char.get("personality", "") or existing.personality
            existing.background = char.get("background", "") or existing.background
            existing.abilities = char.get("abilities", "") or existing.abilities
            existing.relationships = char.get("relationships", "") or existing.relationships
            existing.is_main = is_main
            if is_main:
                generated_mains.append(existing)
            saved.append(existing)
        else:
            # 新角色
            db_char = Character(
                project_id=project_id,
                name=name,
                role=char.get("role", ""),
                avatar=char.get("avatar", ""),
                personality=char.get("personality", ""),
                background=char.get("background", ""),
                abilities=char.get("abilities", ""),
                relationships=char.get("relationships", ""),
                is_main=is_main
            )
            db.add(db_char)
            if is_main:
                generated_mains.append(db_char)
            saved.append(db_char)

    # 最后统一处理主角唯一性：确保项目中只有一个主角
    if len(generated_mains) > 0:
        # 如果本次生成有主角，只保留最后一个，其他都取消
        # 把所有其他主角（包括本次生成之外的）都取消
        all_mains = db.query(Character).filter(
            Character.project_id == project_id,
            Character.is_main == True
        ).all()
        for m in all_mains:
            m.is_main = False
        # 只保留最后一个生成的主角
        generated_mains[-1].is_main = True
    elif len(existing_chars) > 0:
        # 如果本次生成没有主角，但原来有主角，保持原来的不变
        pass

    db.commit()
    for s in saved:
        db.refresh(s)
    return saved

@router.put("/{character_id}", response_model=CharacterResponse)
def update_character(character_id: int, character: CharacterCreate, db: Session = Depends(get_db)):
    """更新角色"""
    db_char = db.query(Character).filter(Character.id == character_id).first()
    if not db_char:
        raise HTTPException(status_code=404, detail="角色不存在")

    db_char.name = character.name
    db_char.role = character.role
    db_char.avatar = character.avatar
    db_char.personality = character.personality
    db_char.background = character.background
    db_char.abilities = character.abilities
    db_char.relationships = character.relationships
    db_char.is_main = character.is_main

    db.commit()
    db.refresh(db_char)
    return db_char

@router.get("/{project_id}/{character_id}", response_model=CharacterResponse)
def get_character(project_id: int, character_id: int, db: Session = Depends(get_db)):
    """获取单个角色详情"""
    db_char = db.query(Character).filter(
        Character.id == character_id,
        Character.project_id == project_id
    ).first()
    if not db_char:
        raise HTTPException(status_code=404, detail="角色不存在")
    return db_char

@router.delete("/{character_id}")
def delete_character(character_id: int, db: Session = Depends(get_db)):
    """删除角色"""
    db_char = db.query(Character).filter(Character.id == character_id).first()
    if not db_char:
        raise HTTPException(status_code=404, detail="角色不存在")

    db.delete(db_char)
    db.commit()
    return {"success": True, "message": "删除成功"}

@router.delete("/{project_id}/all")
def delete_all_characters(project_id: int, db: Session = Depends(get_db)):
    """一键删除所有角色"""
    project = db.query(NovelProject).filter(NovelProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    count = db.query(Character).filter(Character.project_id == project_id).delete()
    db.commit()
    return {"success": True, "message": f"已删除所有 {count} 个角色"}


@router.get("/relationships/{project_id}", response_model=List[CharacterRelationshipResponse])
def list_relationships(project_id: int, db: Session = Depends(get_db)):
    """获取项目角色关系图边列表"""
    edges = db.query(CharacterRelationship)\
        .filter(CharacterRelationship.project_id == project_id)\
        .order_by(CharacterRelationship.updated_at.desc())\
        .all()
    return edges


@router.post("/relationships/{project_id}", response_model=CharacterRelationshipResponse)
def create_relationship(project_id: int, data: CharacterRelationshipCreate, db: Session = Depends(get_db)):
    """新增角色关系边"""
    if data.source_character_id == data.target_character_id:
        raise HTTPException(status_code=400, detail="关系两端不能是同一角色")

    source = db.query(Character).filter(
        Character.id == data.source_character_id,
        Character.project_id == project_id
    ).first()
    target = db.query(Character).filter(
        Character.id == data.target_character_id,
        Character.project_id == project_id
    ).first()
    if not source or not target:
        raise HTTPException(status_code=404, detail="关系角色不存在或不属于该项目")

    existed = db.query(CharacterRelationship).filter(
        CharacterRelationship.project_id == project_id,
        CharacterRelationship.source_character_id == data.source_character_id,
        CharacterRelationship.target_character_id == data.target_character_id
    ).first()
    if existed:
        existed.relation_type = data.relation_type
        existed.intensity = max(0.0, min(1.0, data.intensity))
        existed.status = data.status
        existed.notes = data.notes or ""
        db.commit()
        db.refresh(existed)
        return existed

    edge = CharacterRelationship(
        project_id=project_id,
        source_character_id=data.source_character_id,
        target_character_id=data.target_character_id,
        relation_type=data.relation_type,
        intensity=max(0.0, min(1.0, data.intensity)),
        status=data.status,
        notes=data.notes or "",
    )
    db.add(edge)
    db.commit()
    db.refresh(edge)
    return edge


@router.put("/relationships/{relationship_id}", response_model=CharacterRelationshipResponse)
def update_relationship(relationship_id: int, data: CharacterRelationshipUpdate, db: Session = Depends(get_db)):
    """更新角色关系边"""
    edge = db.query(CharacterRelationship).filter(CharacterRelationship.id == relationship_id).first()
    if not edge:
        raise HTTPException(status_code=404, detail="关系不存在")

    if data.relation_type is not None:
        edge.relation_type = data.relation_type
    if data.intensity is not None:
        edge.intensity = max(0.0, min(1.0, data.intensity))
    if data.status is not None:
        edge.status = data.status
    if data.notes is not None:
        edge.notes = data.notes

    db.commit()
    db.refresh(edge)
    return edge


@router.delete("/relationships/{relationship_id}")
def delete_relationship(relationship_id: int, db: Session = Depends(get_db)):
    """删除角色关系边"""
    edge = db.query(CharacterRelationship).filter(CharacterRelationship.id == relationship_id).first()
    if not edge:
        raise HTTPException(status_code=404, detail="关系不存在")
    db.delete(edge)
    db.commit()
    return {"success": True, "message": "关系已删除"}
