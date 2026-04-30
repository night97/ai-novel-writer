from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Dict, Set
from app.database import get_db
import json
from app.models.models import NovelProject, WorldSetting, Character, Chapter, Volume, CharacterRelationship, ProjectCreativeProfile, AppConfig
from app.models.schemas import ChapterResponse, GenerateChapterRequest, RegenerateChapterRequest
from app.services.llm_service import llm_service
from app.services.rag_service import rag_service
from openai import APITimeoutError, APIConnectionError
from app.routes.settings import sync_llm_runtime_with_active_profile

router = APIRouter(prefix="/api/write", tags=["write"])

def _format_character_line(char: Character) -> str:
    parts = [f"- {char.name}"]
    if char.role:
        parts.append(f"({char.role})")
    if char.is_main:
        parts.append("[主角]")
    tail = []
    if char.personality:
        tail.append(char.personality)
    if char.background:
        tail.append(char.background)
    if char.abilities:
        tail.append(f"能力:{char.abilities}")
    if char.relationships:
        tail.append(f"关系速记:{char.relationships}")
    return f"{' '.join(parts)}: {' | '.join(tail)}".strip()


def _build_active_character_ids(db: Session, project_id: int, chapter: Chapter, characters: List[Character]) -> Set[int]:
    """根据POV/主角/章节大纲/关系图筛选本章活跃角色"""
    ids: Set[int] = set()
    name_to_id: Dict[str, int] = {c.name: c.id for c in characters if c.name}

    # 1) POV角色优先
    if chapter.pov and chapter.pov in name_to_id:
        ids.add(name_to_id[chapter.pov])

    # 2) 主角常驻
    for c in characters:
        if c.is_main:
            ids.add(c.id)

    # 3) 大纲文本中提及的人名
    outline_text = (chapter.outline or "") + "\n" + (chapter.goal or "") + "\n" + (chapter.conflict or "")
    for c in characters:
        if c.name and c.name in outline_text:
            ids.add(c.id)

    # 4) 基于关系图扩散一层（高强度）
    if ids:
        edges = db.query(CharacterRelationship).filter(CharacterRelationship.project_id == project_id).all()
        for e in edges:
            if e.intensity is not None and e.intensity < 0.6:
                continue
            if e.source_character_id in ids:
                ids.add(e.target_character_id)
            elif e.target_character_id in ids:
                ids.add(e.source_character_id)

    # 5) 保底：最多取前8个
    if not ids:
        for c in characters[:5]:
            ids.add(c.id)
    return set(list(ids)[:8])


def _build_character_task_cards(chapter: Chapter, active_characters: List[Character]) -> str:
    """群像戏专用：给活跃角色生成本章任务卡，避免在场无用"""
    if not active_characters:
        return ""
    cards = []
    for i, c in enumerate(active_characters):
        if i % 3 == 0:
            mission_type = "推进主线"
            mission = chapter.goal or chapter.outline or "推动本章关键事件发生"
        elif i % 3 == 1:
            mission_type = "制造阻力"
            mission = chapter.conflict or "制造行动阻碍/价值冲突"
        else:
            mission_type = "揭示信息"
            mission = chapter.cost or chapter.hook or "揭示隐藏信息或代价"
        cards.append(
            f"- {c.name}｜任务类型:{mission_type}｜本章必须完成:{mission}｜完成信号:引发明确后果或关系变化"
        )
    return "\n".join(cards)


def get_project_info(project, db, chapter: Chapter = None, volume_id=None):
    """获取项目完整信息文本"""
    world = db.query(WorldSetting).filter(WorldSetting.project_id == project.id).first()
    characters = db.query(Character).filter(Character.project_id == project.id).all()

    world_text = ""
    if world:
        if world.background:
            world_text += f"背景: {world.background}\n"
        if world.power_system:
            world_text += f"力量体系: {world.power_system}\n"
        if world.geography:
            world_text += f"地理: {world.geography}\n"
        if world.factions:
            world_text += f"势力: {world.factions}\n"

    # 群像增强：全量角色 + 活跃角色分层注入
    all_chars_text = "\n".join([_format_character_line(c) for c in characters]).strip()
    active_chars_text = ""
    active_chars = []
    if chapter:
        active_ids = _build_active_character_ids(db, project.id, chapter, characters)
        active_chars = [c for c in characters if c.id in active_ids]
        active_chars_text = "\n".join([_format_character_line(c) for c in active_chars]).strip()

    creative = db.query(ProjectCreativeProfile).filter(ProjectCreativeProfile.project_id == project.id).first()
    creative_profile_text = ""
    if creative:
        creative_profile_text = "\n".join([
            f"核心反差: {creative.core_contrast or ''}",
            f"金手指代价: {creative.cheat_cost or ''}",
            f"读者承诺: {creative.reader_promise or ''}",
            f"独特机制: {creative.unique_mechanism or ''}",
        ]).strip()

    task_cards = _build_character_task_cards(chapter, active_chars) if chapter else ""

    # 角色系统 / 世界观系统（结构化工作台正式版）约束注入
    character_system_text = ""
    world_system_text = ""
    cs = db.query(AppConfig).filter(AppConfig.config_key == f"system_profile:{project.id}:character_system").first()
    ws = db.query(AppConfig).filter(AppConfig.config_key == f"system_profile:{project.id}:world_system").first()
    if cs and cs.config_value:
        try:
            d = json.loads(cs.config_value)
            character_system_text = "\n".join([
                f"主配角成长弧: {d.get('arc_design','')}",
                f"角色终局规划: {d.get('ending_plan','')}",
                f"群像出场任务规则: {d.get('taskcard_rule','')}",
            ]).strip()
        except Exception:
            character_system_text = cs.config_value
    if ws and ws.config_value:
        try:
            d = json.loads(ws.config_value)
            world_system_text = "\n".join([
                f"世界规则: {d.get('rules','')}",
                f"力量代价: {d.get('costs','')}",
                f"资源系统: {d.get('resources','')}",
                f"限制条件: {d.get('limits','')}",
            ]).strip()
        except Exception:
            world_system_text = ws.config_value

    volume_info = ""
    if volume_id:
        volume = db.query(Volume).filter(Volume.id == volume_id).first()
        if volume:
            if volume.title:
                volume_info += f"本卷标题：{volume.title}\n"
            if volume.summary:
                volume_info += f"本卷概要：{volume.summary}\n"
            if volume.beat_sheet:
                volume_info += f"节拍表：{volume.beat_sheet}\n"
            if volume.core_conflict:
                volume_info += f"核心冲突：{volume.core_conflict}\n"
            if volume.climax:
                volume_info += f"卷高潮：{volume.climax}\n"

    return {
        "title": project.title,
        "genre": project.genre,
        "world_setting": world_text.strip(),
        "characters": all_chars_text,
        "active_characters": active_chars_text,
        "character_task_cards": task_cards,
        "creative_profile": creative_profile_text,
        "character_system": character_system_text,
        "world_system": world_system_text,
        "volume_info": volume_info.strip(),
        "enable_review": project.enable_review,
        "target_words_per_chapter": project.target_words_per_chapter
    }

@router.post("/chapter", response_model=ChapterResponse)
def generate_chapter(request: GenerateChapterRequest, db: Session = Depends(get_db)):
    """生成章节正文"""
    chapter = db.query(Chapter).filter(Chapter.id == request.chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")

    project = db.query(NovelProject).filter(NovelProject.id == request.project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    # 强制同步运行时模型配置，避免“页面配置”和“实际调用”不一致
    sync_llm_runtime_with_active_profile(db)

    # 获取RAG上下文 - 用本章大纲作为query搜索相关历史（失败时降级）
    try:
        context = rag_service.get_relevant_context(db, request.project_id, chapter.outline)
    except Exception as e:
        print(f"RAG检索失败，降级为无上下文继续生成: {e}")
        context = ""

    # 获取项目完整信息（包含本卷骨架信息）
    project_info = get_project_info(project, db, chapter=chapter, volume_id=chapter.volume_id)

    # 生成正文 - 传递完整章节信息
    chapter_dict = {
        "chapter_index": chapter.chapter_index,
        "title": chapter.title,
        "goal": chapter.goal,
        "conflict": chapter.conflict,
        "cost": chapter.cost,
        "strand": chapter.strand,
        "cool_point_type": chapter.cool_point_type,
        "hook": chapter.hook,
        "antagonist_level": chapter.antagonist_level,
        "pov": chapter.pov,
        "outline": chapter.outline
    }
    try:
        content = llm_service.generate_chapter_with_pipeline(
            project_info=project_info,
            chapter=chapter_dict,
            context=context,
            target_words=project.target_words_per_chapter,
            chapter_index=chapter.chapter_index
        )
    except APITimeoutError:
        raise HTTPException(status_code=504, detail="模型请求超时：请降低每章字数、切换更快模型，或稍后重试")
    except APIConnectionError:
        raise HTTPException(status_code=502, detail="模型连接失败：请检查 base_url、网络连通性或切换模型来源")

    # 保存
    chapter.content = content
    chapter.word_count = len(content)
    chapter.is_generated = True

    # 构建RAG索引
    try:
        rag_service.index_chapter(db, request.project_id, request.chapter_id, content)
        rag_service.extract_entities(db, request.project_id, request.chapter_id, content, llm_service)
    except Exception as e:
        print(f"构建RAG索引失败: {e}")

    db.commit()
    db.refresh(chapter)
    return chapter

@router.post("/chapter/{chapter_id}/regenerate", response_model=ChapterResponse)
def regenerate_chapter(chapter_id: int, request: RegenerateChapterRequest, db: Session = Depends(get_db)):
    """重新生成章节"""
    chapter = db.query(Chapter).filter(Chapter.id == chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")

    project = db.query(NovelProject).filter(NovelProject.id == request.project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    sync_llm_runtime_with_active_profile(db)

    # 如果有用户提示，修改大纲
    if request.user_prompt and request.user_prompt.strip():
        chapter.outline = chapter.outline + "\n\n用户修改要求: " + request.user_prompt

    # 获取RAG上下文 - 用本章大纲作为query搜索相关历史（失败时降级）
    try:
        context = rag_service.get_relevant_context(db, request.project_id, chapter.outline)
    except Exception as e:
        print(f"RAG检索失败，降级为无上下文继续生成: {e}")
        context = ""

    # 获取项目完整信息（包含本卷骨架信息）
    project_info = get_project_info(project, db, chapter=chapter, volume_id=chapter.volume_id)

    # 生成正文 - 传递完整章节信息
    chapter_dict = {
        "chapter_index": chapter.chapter_index,
        "title": chapter.title,
        "goal": chapter.goal,
        "conflict": chapter.conflict,
        "cost": chapter.cost,
        "strand": chapter.strand,
        "cool_point_type": chapter.cool_point_type,
        "hook": chapter.hook,
        "antagonist_level": chapter.antagonist_level,
        "pov": chapter.pov,
        "outline": chapter.outline
    }
    content = llm_service.generate_chapter_with_pipeline(
        project_info=project_info,
        chapter=chapter_dict,
        context=context,
        target_words=project.target_words_per_chapter,
        chapter_index=chapter.chapter_index
    )

    chapter.content = content
    chapter.word_count = len(content)
    chapter.is_generated = True

    # 重新构建RAG索引
    try:
        rag_service.index_chapter(db, request.project_id, chapter_id, content)
    except Exception as e:
        print(f"构建RAG索引失败: {e}")

    db.commit()
    db.refresh(chapter)
    return chapter

@router.get("/chapter/{chapter_id}", response_model=ChapterResponse)
def get_chapter(chapter_id: int, db: Session = Depends(get_db)):
    """获取章节详情"""
    chapter = db.query(Chapter).filter(Chapter.id == chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    return chapter

@router.get("/full-text/{project_id}")
def get_full_text(project_id: int, db: Session = Depends(get_db)):
    """获取全书完整文本"""
    project = db.query(NovelProject).filter(NovelProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    chapters = db.query(Chapter)\
        .filter(Chapter.project_id == project_id)\
        .filter(Chapter.is_generated == True)\
        .join(Volume)\
        .order_by(Volume.volume_index, Chapter.chapter_index)\
        .all()

    if not chapters:
        raise HTTPException(status_code=404, detail="还没有生成任何章节")

    full_text = [f"# {project.title}\n\n"]

    current_volume_id = None
    for chapter in chapters:
        if chapter.volume_id != current_volume_id:
            volume = db.query(Volume).filter(Volume.id == chapter.volume_id).first()
            if volume:
                full_text.append(f"\n\n## {volume.title}\n\n")
            current_volume_id = chapter.volume_id

        full_text.append(f"### {chapter.title}\n\n")
        if chapter.content:
            full_text.append(chapter.content)
            full_text.append("\n\n")

    return {
        "title": project.title,
        "full_text": "".join(full_text),
        "word_count": sum(c.word_count for c in chapters),
        "chapter_count": len(chapters)
    }

@router.delete("/chapter/{chapter_id}/content")
def clear_chapter_content(chapter_id: int, db: Session = Depends(get_db)):
    """清空章节内容"""
    chapter = db.query(Chapter).filter(Chapter.id == chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")

    from app.models.models import TextChunk, Entity
    # 删除RAG索引
    db.query(TextChunk).filter(TextChunk.chapter_id == chapter_id).delete()
    db.query(Entity).filter(Entity.chapter_id == chapter_id).delete()

    chapter.content = ""
    chapter.word_count = 0
    chapter.is_generated = False

    db.commit()
    return {"success": True, "message": "内容已清空"}

class OptimizeChapterRequest(BaseModel):
    project_id: int
    chapter_id: int
    optimize_type: str


class ChapterQualityRequest(BaseModel):
    project_id: int
    chapter_id: int

@router.post("/optimize-chapter", response_model=ChapterResponse)
def optimize_chapter(request: OptimizeChapterRequest, db: Session = Depends(get_db)):
    """AI优化章节正文"""
    chapter = db.query(Chapter).filter(Chapter.id == request.chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")

    project = db.query(NovelProject).filter(NovelProject.id == request.project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    sync_llm_runtime_with_active_profile(db)

    # 获取RAG上下文（失败时降级）
    try:
        context = rag_service.get_relevant_context(db, request.project_id, chapter.outline)
    except Exception as e:
        print(f"RAG检索失败，降级为无上下文继续优化: {e}")
        context = ""

    # 获取项目完整信息
    project_info = get_project_info(project, db, chapter=chapter, volume_id=chapter.volume_id)

    # 章节信息
    chapter_dict = {
        "title": chapter.title,
        "goal": chapter.goal,
        "conflict": chapter.conflict,
        "cost": chapter.cost,
        "strand": chapter.strand,
        "cool_point_type": chapter.cool_point_type,
        "hook": chapter.hook,
        "antagonist_level": chapter.antagonist_level,
        "pov": chapter.pov,
        "outline": chapter.outline
    }

    # 根据优化类型生成提示
    optimize_prompts = {
        "deepen_conflict": "深化冲突：加强本章的核心冲突，增加张力，让对立更加尖锐",
        "add_foreshadowing": "增加伏笔：在文中添加更多伏笔，为后续剧情做铺垫，保持悬念",
        "strengthen_emotion": "强化感情线：深化人物感情互动，增加情感共鸣",
        "optimize_pacing": "优化节奏：调整情节节奏，加快推进，去除冗余",
        "expand_details": "扩充细节：增加环境描写、动作描写，让内容更丰富",
        "enhance_climax": "提升高潮：强化本章高潮部分，让冲突爆发更有力",
        "deepen_plot": "深化情节：进一步挖掘本章主题，让情节更有深度",
        "strengthen_conflict": "强化冲突：增强主角面临的阻力和压力",
        "improve_structure": "优化结构：调整段落结构，让逻辑更清晰",
        "improve_dialogue": "完善对话：让对话更符合人物身份，更自然生动",
        "polish": "润色升华：优化文笔，提升文采，让结尾更有韵味",
        "optimize_style": "优化文笔：改进语言风格，让文字更流畅优美",
        "change_pov": "改写视角：调整本章叙事视角保持一致性",
        "remove_lecturing": "去除说教：把说教改成通过情节自然展现观点"
    }

    optimize_instruction = optimize_prompts.get(request.optimize_type, "润色优化全文")

    content = llm_service.optimize_chapter_content(
        project_info=project_info,
        chapter=chapter_dict,
        original_content=chapter.content,
        optimize_instruction=optimize_instruction,
        context=context,
        target_words=len(chapter.content) + 200
    )

    chapter.content = content
    chapter.word_count = len(content)

    # 重新构建RAG索引
    try:
        rag_service.index_chapter(db, request.project_id, request.chapter_id, content)
    except Exception as e:
        print(f"重建RAG索引失败: {e}")

    db.commit()
    db.refresh(chapter)
    return chapter


@router.post("/chapter-quality")
def chapter_quality(request: ChapterQualityRequest, db: Session = Depends(get_db)):
    """分析章节质量，返回7维评分"""
    chapter = db.query(Chapter).filter(Chapter.id == request.chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    project = db.query(NovelProject).filter(NovelProject.id == request.project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    if not (chapter.content or "").strip():
        raise HTTPException(status_code=400, detail="章节内容为空，无法分析")

    project_info = get_project_info(project, db, chapter=chapter, volume_id=chapter.volume_id)
    chapter_dict = {
        "chapter_index": chapter.chapter_index,
        "title": chapter.title,
        "goal": chapter.goal,
        "conflict": chapter.conflict,
        "cost": chapter.cost,
        "strand": chapter.strand,
        "cool_point_type": chapter.cool_point_type,
        "hook": chapter.hook,
        "antagonist_level": chapter.antagonist_level,
        "pov": chapter.pov,
        "outline": chapter.outline
    }
    quality = llm_service.score_chapter_quality(
        project_info=project_info,
        chapter=chapter_dict,
        content=chapter.content,
        chapter_index=chapter.chapter_index or 1
    )
    return quality


@router.post("/optimize-low-score", response_model=ChapterResponse)
def optimize_low_score(request: ChapterQualityRequest, db: Session = Depends(get_db)):
    """按质量评分自动做低分段落增强（局部重写优先）"""
    chapter = db.query(Chapter).filter(Chapter.id == request.chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    project = db.query(NovelProject).filter(NovelProject.id == request.project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    if not (chapter.content or "").strip():
        raise HTTPException(status_code=400, detail="章节内容为空，无法优化")

    project_info = get_project_info(project, db, chapter=chapter, volume_id=chapter.volume_id)
    chapter_dict = {
        "chapter_index": chapter.chapter_index,
        "title": chapter.title,
        "goal": chapter.goal,
        "conflict": chapter.conflict,
        "cost": chapter.cost,
        "strand": chapter.strand,
        "cool_point_type": chapter.cool_point_type,
        "hook": chapter.hook,
        "antagonist_level": chapter.antagonist_level,
        "pov": chapter.pov,
        "outline": chapter.outline
    }

    quality = llm_service.score_chapter_quality(
        project_info=project_info,
        chapter=chapter_dict,
        content=chapter.content,
        chapter_index=chapter.chapter_index or 1
    )
    content = llm_service.rewrite_chapter_by_feedback(
        project_info=project_info,
        chapter=chapter_dict,
        content=chapter.content,
        quality=quality,
        target_words=max(project.target_words_per_chapter, len(chapter.content)),
        chapter_index=chapter.chapter_index or 1
    )
    chapter.content = content
    chapter.word_count = len(content)

    try:
        rag_service.index_chapter(db, request.project_id, request.chapter_id, content)
    except Exception as e:
        print(f"重建RAG索引失败: {e}")

    db.commit()
    db.refresh(chapter)
    return chapter
