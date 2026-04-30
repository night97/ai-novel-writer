from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models.models import NovelProject, WorldSetting, Character, Volume, Chapter, ProjectCreativeProfile
from app.models.schemas import VolumeResponse, ChapterResponse, GenerateOutlineRequest
from app.services.llm_service import llm_service
from pydantic import BaseModel
import json

class GenerateVolumeRequest(BaseModel):
    project_id: int
    volume_index: int
    chapters_per_volume: int

router = APIRouter(prefix="/api/outline", tags=["outline"])

def format_world_setting(world):
    """格式化世界观设定为文本"""
    if not world:
        return ""
    parts = []
    if world.background:
        parts.append(f"背景: {world.background}")
    if world.power_system:
        parts.append(f"力量体系: {world.power_system}")
    if world.geography:
        parts.append(f"地理: {world.geography}")
    if world.factions:
        parts.append(f"势力: {world.factions}")
    return "\n".join(parts)

def format_characters(characters):
    """格式化角色列表为文本"""
    if not characters:
        return ""
    parts = []
    for char in characters:
        parts.append(f"- {char.name}: {char.personality or ''} {char.background or ''}")
    return "\n".join(parts)


def format_creative_profile(profile):
    if not profile:
        return ""
    return "\n".join([
        f"核心反差: {profile.core_contrast or ''}",
        f"金手指代价: {profile.cheat_cost or ''}",
        f"读者承诺: {profile.reader_promise or ''}",
        f"独特机制: {profile.unique_mechanism or ''}",
    ]).strip()


def _normalize_master_outline_text(raw: str) -> str:
    text = (raw or "").strip()
    if not text:
        return ""
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            preferred = [
                ("core_promise", "核心承诺"),
                ("target_reader", "目标读者"),
                ("ending", "故事终局"),
                ("ultimate_truth", "世界终极真相"),
                ("character_endings", "角色终局"),
                ("act1", "第一幕"),
                ("act2", "第二幕"),
                ("act3", "第三幕"),
                ("act4", "第四幕"),
                ("act5", "第五幕"),
                ("master_outline", "总纲全文"),
            ]
            parts = []
            for key, label in preferred:
                val = data.get(key)
                if val:
                    parts.append(f"{label}: {val}")
            if parts:
                return "\n".join(parts)
    except Exception:
        pass
    return text

@router.get("/{project_id}/volumes", response_model=List[VolumeResponse])
def get_volumes(project_id: int, db: Session = Depends(get_db)):
    """获取项目所有卷"""
    volumes = db.query(Volume)\
        .filter(Volume.project_id == project_id)\
        .order_by(Volume.volume_index)\
        .all()
    return volumes

@router.get("/{project_id}/volumes/{volume_id}/chapters", response_model=List[ChapterResponse])
def get_chapters(project_id: int, volume_id: int, db: Session = Depends(get_db)):
    """获取卷下所有章节"""
    chapters = db.query(Chapter)\
        .filter(Chapter.project_id == project_id)\
        .filter(Chapter.volume_id == volume_id)\
        .order_by(Chapter.chapter_index)\
        .all()
    return chapters

@router.get("/volumes/{volume_id}", response_model=VolumeResponse)
def get_volume(volume_id: int, db: Session = Depends(get_db)):
    """获取单卷信息"""
    volume = db.query(Volume).filter(Volume.id == volume_id).first()
    if not volume:
        raise HTTPException(status_code=404, detail="卷不存在")
    return volume

@router.post("/generate")
def generate_outline(request: GenerateOutlineRequest, db: Session = Depends(get_db)):
    """生成完整大纲"""
    project = db.query(NovelProject).filter(NovelProject.id == request.project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    if not (project.master_outline and project.master_outline.strip()):
        raise HTTPException(status_code=400, detail="请先在“总纲工作台”沉淀并发布项目总纲，再生成卷纲")
    master_outline_text = _normalize_master_outline_text(project.master_outline)

    # 获取世界观和角色
    world = db.query(WorldSetting).filter(WorldSetting.project_id == request.project_id).first()
    characters = db.query(Character).filter(Character.project_id == request.project_id).all()
    creative_profile = db.query(ProjectCreativeProfile).filter(ProjectCreativeProfile.project_id == request.project_id).first()

    world_text = format_world_setting(world)
    chars_text = format_characters(characters)
    creative_profile_text = format_creative_profile(creative_profile)

    result = llm_service.generate_outline(
        genre=project.genre,
        title=project.title,
        world_setting=world_text,
        characters=chars_text,
        num_volumes=request.num_volumes,
        chapters_per_volume=request.chapters_per_volume,
        user_prompt=(project.description or "") + f"\n\n【项目总纲】\n{master_outline_text}",
        creative_profile=creative_profile_text
    )

    if not result:
        raise HTTPException(status_code=500, detail="大纲生成失败")

    # 保存到数据库
    saved_volumes = []
    for volume_data in result:
        volume = Volume(
            project_id=request.project_id,
            volume_index=volume_data.get("volume_index", 1),
            title=volume_data.get("title", ""),
            summary=volume_data.get("summary", ""),
            beat_sheet=volume_data.get("beat_sheet", ""),
            core_conflict=volume_data.get("core_conflict", ""),
            climax=volume_data.get("climax", "")
        )
        db.add(volume)
        db.flush()
        db.refresh(volume)

        # 保存章节
        for chapter_data in volume_data.get("chapters", []):
            chapter = Chapter(
                project_id=request.project_id,
                volume_id=volume.id,
                chapter_index=chapter_data.get("chapter_index", 1),
                title=chapter_data.get("title", ""),
                goal=chapter_data.get("goal", ""),
                conflict=chapter_data.get("conflict", ""),
                cost=chapter_data.get("cost", ""),
                strand=chapter_data.get("strand", ""),
                cool_point_type=chapter_data.get("cool_point_type", ""),
                hook=chapter_data.get("hook", ""),
                antagonist_level=chapter_data.get("antagonist_level", ""),
                pov=chapter_data.get("pov", ""),
                outline=chapter_data.get("outline", ""),
                content="",
                is_generated=False
            );
            db.add(chapter);

        saved_volumes.append(volume)

    db.commit()
    for v in saved_volumes:
        db.refresh(v)

    return {
        "success": True,
        "volumes": saved_volumes,
        "message": f"成功生成 {len(saved_volumes)} 卷，共 {sum(len(v.chapters) for v in saved_volumes)} 章"
    }

class GenerateVolumeSkeletonRequest(BaseModel):
    project_id: int
    volume_index: int
    total_chapters: int

@router.post("/generate-volume-skeleton")
def generate_volume_skeleton(request: GenerateVolumeSkeletonRequest, db: Session = Depends(get_db)):
    """生成卷骨架（只生成卷结构，不生成章节，适合大批量分批次生成）"""
    project = db.query(NovelProject).filter(NovelProject.id == request.project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    if not (project.master_outline and project.master_outline.strip()):
        raise HTTPException(status_code=400, detail="请先在“总纲工作台”沉淀并发布项目总纲，再生成卷骨架")
    master_outline_text = _normalize_master_outline_text(project.master_outline)

    # 获取世界观和角色
    world = db.query(WorldSetting).filter(WorldSetting.project_id == request.project_id).first()
    characters = db.query(Character).filter(Character.project_id == request.project_id).all()
    creative_profile = db.query(ProjectCreativeProfile).filter(ProjectCreativeProfile.project_id == request.project_id).first()

    world_text = format_world_setting(world)
    chars_text = format_characters(characters)
    creative_profile_text = format_creative_profile(creative_profile)

    # 只生成卷骨架，不生成完整章节
    result = llm_service.generate_volume_skeleton(
        genre=project.genre,
        title=project.title,
        world_setting=world_text,
        characters=chars_text,
        total_chapters=request.total_chapters,
        user_prompt=(project.description or "")
        + f"\n\n【项目总纲】\n{master_outline_text}"
        + ("\n题材新颖度配置:\n" + creative_profile_text if creative_profile_text else "")
    )

    if not result:
        raise HTTPException(status_code=500, detail="卷骨架生成失败")

    # 修正卷号
    for volume_data in result:
        volume_data["volume_index"] = request.volume_index

    # 保存到数据库 - 只保存卷结构，不保存章节
    saved_volumes = []
    for volume_data in result:
        volume = Volume(
            project_id=request.project_id,
            volume_index=volume_data.get("volume_index", request.volume_index),
            title=volume_data.get("title", ""),
            summary=volume_data.get("summary", ""),
            beat_sheet=volume_data.get("beat_sheet", ""),
            core_conflict=volume_data.get("core_conflict", ""),
            climax=volume_data.get("climax", "")
        )
        db.add(volume)
        saved_volumes.append(volume)

    db.commit()
    for v in saved_volumes:
        db.refresh(v)

    return {
        "success": True,
        "volumes": saved_volumes,
        "message": f"成功生成第 {request.volume_index} 卷骨架，请分批生成章节"
    }

class GenerateVolumeChaptersRequest(BaseModel):
    project_id: int
    volume_id: int
    volume_index: int
    start_chapter: int
    end_chapter: int
    total_chapters: int

@router.post("/generate-volume-chapters")
def generate_volume_chapters(request: GenerateVolumeChaptersRequest, db: Session = Depends(get_db)):
    """在已有卷骨架中，分批生成指定范围的章节"""
    project = db.query(NovelProject).filter(NovelProject.id == request.project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    if not (project.master_outline and project.master_outline.strip()):
        raise HTTPException(status_code=400, detail="请先在“总纲工作台”沉淀并发布项目总纲，再生成章节大纲")
    master_outline_text = _normalize_master_outline_text(project.master_outline)

    volume = db.query(Volume).filter(Volume.id == request.volume_id).first()
    if not volume:
        raise HTTPException(status_code=404, detail="卷不存在")

    # 获取世界观和角色
    world = db.query(WorldSetting).filter(WorldSetting.project_id == request.project_id).first()
    characters = db.query(Character).filter(Character.project_id == request.project_id).all()
    creative_profile = db.query(ProjectCreativeProfile).filter(ProjectCreativeProfile.project_id == request.project_id).first()

    world_text = format_world_setting(world)
    chars_text = format_characters(characters)
    creative_profile_text = format_creative_profile(creative_profile)

    # 获取卷骨架信息一起传给LLM
    volume_info = f"""
卷标题：{volume.title}
卷概要：{volume.summary}
节拍表：{volume.beat_sheet}
核心冲突：{volume.core_conflict}
高潮：{volume.climax}
"""

    # 生成指定范围的章节
    chapters_count = request.end_chapter - request.start_chapter + 1
    result = llm_service.generate_volume_chapters(
        genre=project.genre,
        title=project.title,
        volume_info=volume_info,
        world_setting=world_text,
        characters=chars_text,
        volume_index=request.volume_index,
        start_chapter=request.start_chapter,
        chapters_count=chapters_count,
        total_chapters=request.total_chapters,
        user_prompt=(project.description or "")
        + f"\n\n【项目总纲】\n{master_outline_text}"
        + ("\n题材新颖度配置:\n" + creative_profile_text if creative_profile_text else "")
    )

    if not result:
        raise HTTPException(status_code=500, detail="章节生成失败")

    # 保存章节
    saved_chapters = []
    for chapter_data in result:
        # 修正章节号
        if "chapter_index" not in chapter_data:
            chapter_data["chapter_index"] = request.start_chapter + chapter_data.get("i", 0)

        chapter = Chapter(
            project_id=request.project_id,
            volume_id=volume.id,
            chapter_index=chapter_data.get("chapter_index", request.start_chapter),
            title=chapter_data.get("title", ""),
            goal=chapter_data.get("goal", ""),
            conflict=chapter_data.get("conflict", ""),
            cost=chapter_data.get("cost", ""),
            strand=chapter_data.get("strand", ""),
            cool_point_type=chapter_data.get("cool_point_type", ""),
            hook=chapter_data.get("hook", ""),
            antagonist_level=chapter_data.get("antagonist_level", ""),
            pov=chapter_data.get("pov", ""),
            outline=chapter_data.get("outline", ""),
            content="",
            is_generated=False
        );
        db.add(chapter);
        saved_chapters.append(chapter);

    db.commit()
    for c in saved_chapters:
        db.refresh(c)

    return {
        "success": True,
        "chapters": saved_chapters,
        "message": f"成功生成 {len(saved_chapters)} 章（{request.start_chapter}-{request.end_chapter}章）"
    }

@router.post("/generate-volume")
def generate_single_volume(request: GenerateVolumeRequest, db: Session = Depends(get_db)):
    """生成单卷大纲（逐卷生成，适合长篇）"""
    project = db.query(NovelProject).filter(NovelProject.id == request.project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    if not (project.master_outline and project.master_outline.strip()):
        raise HTTPException(status_code=400, detail="请先在“总纲工作台”沉淀并发布项目总纲，再生成卷纲")
    master_outline_text = _normalize_master_outline_text(project.master_outline)

    # 获取世界观和角色
    world = db.query(WorldSetting).filter(WorldSetting.project_id == request.project_id).first()
    characters = db.query(Character).filter(Character.project_id == request.project_id).all()
    creative_profile = db.query(ProjectCreativeProfile).filter(ProjectCreativeProfile.project_id == request.project_id).first()

    world_text = format_world_setting(world)
    chars_text = format_characters(characters)
    creative_profile_text = format_creative_profile(creative_profile)

    # 只生成一卷
    result = llm_service.generate_outline(
        genre=project.genre,
        title=project.title,
        world_setting=world_text,
        characters=chars_text,
        num_volumes=1,
        chapters_per_volume=request.chapters_per_volume,
        user_prompt=(project.description or "") + f"\n\n【项目总纲】\n{master_outline_text}",
        creative_profile=creative_profile_text
    )

    if not result:
        raise HTTPException(status_code=500, detail="大纲生成失败")

    # 修正卷号
    for volume_data in result:
        volume_data["volume_index"] = request.volume_index
        # 修正章节号
        start_chapter = (request.volume_index - 1) * request.chapters_per_volume + 1
        for i, chapter_data in enumerate(volume_data.get("chapters", [])):
            chapter_data["chapter_index"] = start_chapter + i

    # 保存到数据库
    saved_volumes = []
    for volume_data in result:
        volume = Volume(
            project_id=request.project_id,
            volume_index=volume_data.get("volume_index", request.volume_index),
            title=volume_data.get("title", ""),
            summary=volume_data.get("summary", ""),
            beat_sheet=volume_data.get("beat_sheet", ""),
            core_conflict=volume_data.get("core_conflict", ""),
            climax=volume_data.get("climax", "")
        )
        db.add(volume)
        db.flush()
        db.refresh(volume)

        # 保存章节
        for chapter_data in volume_data.get("chapters", []):
            chapter = Chapter(
                project_id=request.project_id,
                volume_id=volume.id,
                chapter_index=chapter_data.get("chapter_index", 1),
                title=chapter_data.get("title", ""),
                goal=chapter_data.get("goal", ""),
                conflict=chapter_data.get("conflict", ""),
                cost=chapter_data.get("cost", ""),
                strand=chapter_data.get("strand", ""),
                cool_point_type=chapter_data.get("cool_point_type", ""),
                hook=chapter_data.get("hook", ""),
                antagonist_level=chapter_data.get("antagonist_level", ""),
                pov=chapter_data.get("pov", ""),
                outline=chapter_data.get("outline", ""),
                content="",
                is_generated=False
            );
            db.add(chapter);

        saved_volumes.append(volume);

    db.commit();
    for v in saved_volumes:
        db.refresh(v);

    return {
        "success": True,
        "volumes": saved_volumes,
        "message": f"成功生成第 {request.volume_index} 卷，共 {len(saved_volumes[0].chapters)} 章"
    }

@router.put("/volumes/{volume_id}", response_model=VolumeResponse)
def update_volume(volume_id: int, data: dict, db: Session = Depends(get_db)):
    """更新卷信息"""
    volume = db.query(Volume).filter(Volume.id == volume_id).first()
    if not volume:
        raise HTTPException(status_code=404, detail="卷不存在")

    if "title" in data:
        volume.title = data["title"]
    if "summary" in data:
        volume.summary = data["summary"]
    if "beat_sheet" in data:
        volume.beat_sheet = data["beat_sheet"]
    if "core_conflict" in data:
        volume.core_conflict = data["core_conflict"]
    if "climax" in data:
        volume.climax = data["climax"]

    db.commit()
    db.refresh(volume)
    return volume

@router.delete("/volumes/{volume_id}")
def delete_volume(volume_id: int, db: Session = Depends(get_db)):
    """删除卷"""
    volume = db.query(Volume).filter(Volume.id == volume_id).first()
    if not volume:
        raise HTTPException(status_code=404, detail="卷不存在")

    db.query(Chapter).filter(Chapter.volume_id == volume_id).delete()
    db.delete(volume)
    db.commit()
    return {"success": True, "message": "删除成功"}

@router.put("/chapters/{chapter_id}", response_model=ChapterResponse)
def update_chapter(chapter_id: int, data: dict, db: Session = Depends(get_db)):
    """更新章节信息"""
    chapter = db.query(Chapter).filter(Chapter.id == chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")

    if "title" in data:
        chapter.title = data["title"]
    if "goal" in data:
        chapter.goal = data["goal"]
    if "conflict" in data:
        chapter.conflict = data["conflict"]
    if "cost" in data:
        chapter.cost = data["cost"]
    if "strand" in data:
        chapter.strand = data["strand"]
    if "cool_point_type" in data:
        chapter.cool_point_type = data["cool_point_type"]
    if "hook" in data:
        chapter.hook = data["hook"]
    if "antagonist_level" in data:
        chapter.antagonist_level = data["antagonist_level"]
    if "pov" in data:
        chapter.pov = data["pov"]
    if "outline" in data:
        chapter.outline = data["outline"]
    if "content" in data:
        chapter.content = data["content"]
        chapter.word_count = len(data["content"])

    db.commit()
    db.refresh(chapter)
    return chapter

@router.delete("/chapters/{chapter_id}")
def delete_chapter(chapter_id: int, db: Session = Depends(get_db)):
    """删除章节"""
    chapter = db.query(Chapter).filter(Chapter.id == chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")

    db.delete(chapter)
    db.commit()
    return {"success": True, "message": "删除成功"}
