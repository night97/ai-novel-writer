from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Dict
from app.database import get_db
from app.models.models import NovelProject, WorldSetting, Character, Volume, Chapter, ProjectCreativeProfile
from app.models.schemas import VolumeResponse, ChapterResponse, GenerateOutlineRequest
from app.services.llm_service import llm_service
from pydantic import BaseModel
import json
import re

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


def _normalize_chapter_target_words(chapter_data: dict, default_target: int) -> tuple[int, str]:
    """从章节JSON中提取目标字数（兼容 int / 范围文本）"""
    fallback = int(default_target or 2000)
    raw_target = chapter_data.get("target_words")
    raw_ref = chapter_data.get("word_count_reference")

    target = None
    ref_text = ""

    if isinstance(raw_target, (int, float)) and int(raw_target) > 0:
        target = int(raw_target)
        ref_text = str(target)

    if target is None and isinstance(raw_ref, (int, float)) and int(raw_ref) > 0:
        target = int(raw_ref)
        ref_text = str(target)

    if target is None:
        txt = str(raw_ref or "").strip()
        if txt:
            ref_text = txt
            norm = txt.replace(",", "").replace("，", "")
            # 3000-5000 / 3000~5000 / 3000至5000
            m = re.search(r"(\d{3,6})\s*[-~～至到]\s*(\d{3,6})", norm)
            if m:
                a, b = int(m.group(1)), int(m.group(2))
                if a > b:
                    a, b = b, a
                target = int(round((a + b) / 2))
            else:
                m2 = re.search(r"(\d{3,6})", norm)
                if m2:
                    target = int(m2.group(1))

    if target is None:
        target = fallback
        if not ref_text:
            ref_text = str(fallback)

    target = max(500, min(20000, int(target)))
    return target, ref_text


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
            target_words, word_count_reference = _normalize_chapter_target_words(
                chapter_data, project.target_words_per_chapter
            )
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
                target_words=target_words,
                word_count_reference=word_count_reference,
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


def _normalize_generated_chapter_items(raw, start_chapter: int, end_chapter: int) -> List[dict]:
    """规范化LLM返回，尽量保证章号连续可落库"""
    items = raw
    if isinstance(raw, dict):
        if isinstance(raw.get("chapters"), list):
            items = raw.get("chapters")
        elif isinstance(raw.get("data"), list):
            items = raw.get("data")
        else:
            items = []
    if not isinstance(items, list):
        items = []

    normalized: Dict[int, dict] = {}
    cursor = start_chapter
    for i, item in enumerate(items):
        if not isinstance(item, dict):
            continue
        idx = item.get("chapter_index")
        try:
            idx = int(idx)
        except Exception:
            idx = start_chapter + i

        if idx < start_chapter or idx > end_chapter:
            if cursor <= end_chapter:
                idx = cursor
            else:
                continue

        if idx not in normalized:
            fixed = dict(item)
            fixed["chapter_index"] = idx
            normalized[idx] = fixed
            cursor = max(cursor, idx + 1)

    return [normalized[k] for k in sorted(normalized.keys())]

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

    # 生成指定范围的章节：自动切分小批次，避免模型一次只返回10章
    prompt_user = (project.description or "") + f"\n\n【项目总纲】\n{master_outline_text}" + (
        "\n题材新颖度配置:\n" + creative_profile_text if creative_profile_text else ""
    )
    target_start = int(request.start_chapter)
    target_end = int(request.end_chapter)
    if target_end < target_start:
        raise HTTPException(status_code=400, detail="章节范围非法：end_chapter 不能小于 start_chapter")

    chunk_size = 10  # 单次最大10章，防止输出截断
    all_generated: List[dict] = []
    current = target_start
    while current <= target_end:
        chunk_end = min(current + chunk_size - 1, target_end)
        count = chunk_end - current + 1
        raw_chunk = llm_service.generate_volume_chapters(
            genre=project.genre,
            title=project.title,
            volume_info=volume_info,
            world_setting=world_text,
            characters=chars_text,
            volume_index=request.volume_index,
            start_chapter=current,
            chapters_count=count,
            total_chapters=request.total_chapters,
            user_prompt=prompt_user
        )
        chunk = _normalize_generated_chapter_items(raw_chunk, current, chunk_end)

        # 若缺章，自动补一次（只补缺口）
        if len(chunk) < count:
            got = {int(x.get("chapter_index")) for x in chunk if x.get("chapter_index") is not None}
            missing = [idx for idx in range(current, chunk_end + 1) if idx not in got]
            for miss_idx in missing:
                patch_raw = llm_service.generate_volume_chapters(
                    genre=project.genre,
                    title=project.title,
                    volume_info=volume_info,
                    world_setting=world_text,
                    characters=chars_text,
                    volume_index=request.volume_index,
                    start_chapter=miss_idx,
                    chapters_count=1,
                    total_chapters=request.total_chapters,
                    user_prompt=prompt_user
                )
                patch = _normalize_generated_chapter_items(patch_raw, miss_idx, miss_idx)
                if patch:
                    chunk.extend(patch)

        chunk = _normalize_generated_chapter_items(chunk, current, chunk_end)
        all_generated.extend(chunk)
        current = chunk_end + 1

    result = _normalize_generated_chapter_items(all_generated, target_start, target_end)
    if not result:
        raise HTTPException(status_code=500, detail="章节生成失败：模型未返回有效章节JSON")

    # 保存章节（同章号存在则覆盖大纲字段，避免重复新增）
    saved_chapters = []
    for chapter_data in result:
        chapter_idx = int(chapter_data.get("chapter_index", request.start_chapter))
        target_words, word_count_reference = _normalize_chapter_target_words(
            chapter_data, project.target_words_per_chapter
        )
        chapter = db.query(Chapter)\
            .filter(Chapter.volume_id == volume.id)\
            .filter(Chapter.chapter_index == chapter_idx)\
            .first()

        if not chapter:
            chapter = Chapter(
                project_id=request.project_id,
                volume_id=volume.id,
                chapter_index=chapter_idx,
                content="",
                is_generated=False
            )
            db.add(chapter)

        chapter.title = chapter_data.get("title", "") or chapter.title
        chapter.goal = chapter_data.get("goal", "")
        chapter.conflict = chapter_data.get("conflict", "")
        chapter.cost = chapter_data.get("cost", "")
        chapter.strand = chapter_data.get("strand", "")
        chapter.cool_point_type = chapter_data.get("cool_point_type", "")
        chapter.hook = chapter_data.get("hook", "")
        chapter.antagonist_level = chapter_data.get("antagonist_level", "")
        chapter.pov = chapter_data.get("pov", "")
        chapter.target_words = target_words
        chapter.word_count_reference = word_count_reference
        chapter.outline = chapter_data.get("outline", "")
        saved_chapters.append(chapter)

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
            target_words, word_count_reference = _normalize_chapter_target_words(
                chapter_data, project.target_words_per_chapter
            )
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
                target_words=target_words,
                word_count_reference=word_count_reference,
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
    if "target_words" in data:
        try:
            tv = int(data.get("target_words") or 0)
            chapter.target_words = max(500, min(20000, tv)) if tv > 0 else None
        except Exception:
            chapter.target_words = chapter.target_words
    if "word_count_reference" in data:
        chapter.word_count_reference = (data.get("word_count_reference") or "").strip()
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
