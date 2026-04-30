import json
import difflib
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import (
    NovelProject,
    ProjectCreativeProfile,
    WorldSetting,
    Character,
    Volume,
    Chapter,
    CreativeSession,
    CreativeMessage,
    CreativeVersion,
    AppConfig,
)
from app.models.schemas import WorkbenchChatRequest, WorkbenchApplyRequest, VersionTuneRequest, ManualVersionSaveRequest
from app.services.llm_service import llm_service

router = APIRouter(prefix="/api/workbench", tags=["workbench"])


def _ensure_session(db: Session, project_id: int, module: str) -> CreativeSession:
    s = db.query(CreativeSession).filter(
        CreativeSession.project_id == project_id,
        CreativeSession.module == module
    ).order_by(CreativeSession.updated_at.desc()).first()
    if s:
        return s
    s = CreativeSession(project_id=project_id, module=module, title=f"{module}-session")
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


def _is_blank(v):
    return v is None or (isinstance(v, str) and not v.strip())


def _sanitize_system_proposal(module: str, proposal, current, cross_ctx):
    """避免角色系统/世界观系统出现全空候选。"""
    if module not in ["character_system", "world_system"]:
        return proposal
    p = proposal if isinstance(proposal, dict) else {}
    if module == "character_system":
        keys = ["arc_design", "ending_plan", "taskcard_rule"]
        if all(_is_blank(p.get(k)) for k in keys):
            cp = (cross_ctx or {}).get("creative_profile", {}) or {}
            mo = (cross_ctx or {}).get("master_outline", {}) or {}
            names = (cross_ctx or {}).get("active_character_names", []) or []
            name_text = "、".join([n for n in names[:8] if n]) if names else "（待补充角色）"
            base = current if isinstance(current, dict) else {}
            return {
                "arc_design": (base.get("arc_design") or "").strip() or f"围绕题材承诺推进成长弧：主角负责主线突破，配角承担阻力与信息揭示。当前角色：{name_text}。",
                "ending_plan": (base.get("ending_plan") or "").strip() or f"角色终局需服务总纲终局与核心冲突，保持与读者承诺一致。总纲摘要：{(mo.get('master_outline') or mo.get('ending') or '')[:80]}",
                "taskcard_rule": (base.get("taskcard_rule") or "").strip() or f"每章至少配置3类任务：推进主线/制造阻力/揭示信息；无角色时先按职能位（主角位/同伴位/对手位）占坑，后续映射到具体角色。",
            }
    if module == "world_system":
        keys = ["rules", "costs", "resources", "limits"]
        if all(_is_blank(p.get(k)) for k in keys):
            cp = (cross_ctx or {}).get("creative_profile", {}) or {}
            base = current if isinstance(current, dict) else {}
            return {
                "rules": (base.get("rules") or "").strip() or "规则要求可执行、可冲突、可追责：每条规则都要能触发剧情后果。",
                "costs": (base.get("costs") or "").strip() or f"代价需与题材定位一致：{(cp.get('cheat_cost') or '能力使用必须附带风险或限制')}。",
                "resources": (base.get("resources") or "").strip() or "资源分层与稀缺性明确：常规资源、稀有资源、一次性战略资源。",
                "limits": (base.get("limits") or "").strip() or "设置边界条件：等级上限、区域限制、冷却/触发条件，防止能力无上限膨胀。",
            }
    return p


def _normalize_name(name):
    return (name or "").strip().lower()


def _merge_characters_proposal(current_chars, proposal_chars):
    """角色模块默认做增量合并：按姓名upsert，避免新版本覆盖丢失旧角色。"""
    current_list = current_chars if isinstance(current_chars, list) else []
    proposal_list = proposal_chars if isinstance(proposal_chars, list) else []
    if not proposal_list:
        return current_list

    merged_map = {}
    order = []

    def _push(item):
        if not isinstance(item, dict):
            return
        name = (item.get("name") or "").strip()
        if not name:
            return
        key = _normalize_name(name)
        if key not in merged_map:
            order.append(key)
            merged_map[key] = {
                "name": name,
                "role": item.get("role", "") or "",
                "avatar": item.get("avatar", "") or "",
                "personality": item.get("personality", "") or "",
                "background": item.get("background", "") or "",
                "abilities": item.get("abilities", "") or "",
                "relationships": item.get("relationships", "") or "",
                "is_main": bool(item.get("is_main", False)),
            }
            return
        base = merged_map[key]
        for f in ["role", "avatar", "personality", "background", "abilities", "relationships"]:
            v = item.get(f)
            if isinstance(v, str) and v.strip():
                base[f] = v
        if item.get("is_main") is True:
            base["is_main"] = True
        if not base.get("name"):
            base["name"] = name

    for it in current_list:
        _push(it)
    for it in proposal_list:
        _push(it)

    return [merged_map[k] for k in order if k in merged_map]


def _merge_outline_proposal(current_outline, incoming_outline):
    """卷纲增量合并：按 volume_index + chapter_index upsert。"""
    cur = current_outline if isinstance(current_outline, list) else []
    inc = incoming_outline if isinstance(incoming_outline, list) else []
    if not inc:
        return cur

    def _safe_int(v, d):
        try:
            return int(v)
        except Exception:
            return d

    vol_map = {}
    vol_order = []

    # 先装入当前卷纲
    for i, v in enumerate(cur, start=1):
        if not isinstance(v, dict):
            continue
        vi = _safe_int(v.get("volume_index", v.get("volume")), i)
        key = vi
        if key not in vol_map:
            vol_order.append(key)
            vol_map[key] = {
                "volume_index": vi,
                "title": v.get("title", "") or "",
                "summary": v.get("summary", "") or "",
                "beat_sheet": v.get("beat_sheet", "") or "",
                "core_conflict": v.get("core_conflict", "") or "",
                "climax": v.get("climax", "") or "",
                "chapters": [],
            }
        base = vol_map[key]
        chapters = v.get("chapters") if isinstance(v.get("chapters"), list) else []
        ch_map = {}
        for j, c in enumerate(chapters, start=1):
            if not isinstance(c, dict):
                continue
            ci = _safe_int(c.get("chapter_index"), j)
            ch_map[ci] = {
                "chapter_index": ci,
                "title": c.get("title", "") or "",
                "goal": c.get("goal", "") or "",
                "conflict": c.get("conflict", "") or "",
                "cost": c.get("cost", "") or "",
                "strand": c.get("strand", "") or "",
                "cool_point_type": c.get("cool_point_type", "") or "",
                "hook": c.get("hook", "") or "",
                "antagonist_level": c.get("antagonist_level", "") or "",
                "pov": c.get("pov", "") or "",
                "outline": c.get("outline", "") or "",
            }
        base["chapters"] = [ch_map[k] for k in sorted(ch_map.keys())]

    # 再把增量内容并入
    for i, v in enumerate(inc, start=1):
        if not isinstance(v, dict):
            continue
        vi = _safe_int(v.get("volume_index", v.get("volume")), i)
        key = vi
        if key not in vol_map:
            vol_order.append(key)
            vol_map[key] = {
                "volume_index": vi,
                "title": "",
                "summary": "",
                "beat_sheet": "",
                "core_conflict": "",
                "climax": "",
                "chapters": [],
            }
        base = vol_map[key]
        if isinstance(v.get("plot_focus"), str) and v.get("plot_focus").strip() and not (v.get("summary") or "").strip():
            v = {**v, "summary": v.get("plot_focus")}
        for f in ["title", "summary", "beat_sheet", "core_conflict", "climax"]:
            val = v.get(f)
            if isinstance(val, str) and val.strip():
                base[f] = val

        existing_chapters = base.get("chapters") if isinstance(base.get("chapters"), list) else []
        ch_map = {}
        for c in existing_chapters:
            if not isinstance(c, dict):
                continue
            ci = _safe_int(c.get("chapter_index"), 1)
            ch_map[ci] = c

        in_chapters = v.get("chapters") if isinstance(v.get("chapters"), list) else []
        for j, c in enumerate(in_chapters, start=1):
            if not isinstance(c, dict):
                continue
            ci = _safe_int(c.get("chapter_index", c.get("chapter")), j)
            if ci not in ch_map:
                ch_map[ci] = {
                    "chapter_index": ci,
                    "title": "",
                    "goal": "",
                    "conflict": "",
                    "cost": "",
                    "strand": "",
                    "cool_point_type": "",
                    "hook": "",
                    "antagonist_level": "",
                    "pov": "",
                    "outline": "",
                }
            tgt = ch_map[ci]
            for f in ["title", "goal", "conflict", "cost", "strand", "cool_point_type", "hook", "antagonist_level", "pov", "outline"]:
                val = c.get(f)
                if isinstance(val, str) and val.strip():
                    tgt[f] = val
            if isinstance(c.get("core_conflict"), str) and c.get("core_conflict").strip() and not (tgt.get("conflict") or "").strip():
                tgt["conflict"] = c.get("core_conflict").strip()
            if isinstance(c.get("summary"), str) and c.get("summary").strip() and not (tgt.get("outline") or "").strip():
                tgt["outline"] = c.get("summary").strip()
            tgt["chapter_index"] = ci

        base["chapters"] = [ch_map[k] for k in sorted(ch_map.keys())]

    return [vol_map[k] for k in sorted(vol_order)]


def _normalize_outline_payload_for_merge(current_outline, payload):
    """把各种候选格式归一成卷数组，供增量发布合并使用。"""
    cur = current_outline if isinstance(current_outline, list) else []
    first_volume_index = 1
    if cur and isinstance(cur[0], dict):
        try:
            first_volume_index = int(cur[0].get("volume_index", 1))
        except Exception:
            first_volume_index = 1

    def _looks_like_volume_title(title: str) -> bool:
        t = (title or "").strip()
        if not t:
            return False
        prefixes = ["第一卷", "第二卷", "第三卷", "第四卷", "第五卷", "第六卷", "第七卷", "第八卷", "第九卷", "第十卷", "第1卷", "第2卷", "第3卷", "第4卷", "第5卷", "第6卷", "第7卷", "第8卷", "第9卷", "第10卷"]
        return any(t.startswith(p) for p in prefixes)

    def _chapter_list_is_actually_volumes(items) -> bool:
        if not isinstance(items, list) or not items:
            return False
        vol_like = 0
        for it in items:
            if not isinstance(it, dict):
                continue
            # 明确章节信号：只要存在章节索引，就视为章节条目，不能当卷
            if it.get("chapter_index") is not None or it.get("chapter") is not None:
                continue
            title = (it.get("title") or "")
            has_vol_shape = bool(
                _looks_like_volume_title(title) or
                it.get("plot_focus") or
                it.get("core_conflict") or
                it.get("hook")
            )
            has_chapter_shape = bool(
                it.get("summary") or
                it.get("goal") or
                it.get("conflict") or
                it.get("outline") or
                it.get("cost")
            )
            if has_vol_shape and not has_chapter_shape:
                vol_like += 1
        return vol_like >= max(1, int(len(items) * 0.6))

    def _safe_int(v, d):
        try:
            return int(v)
        except Exception:
            return d

    def _normalize_chapter_item(ch, default_idx):
        if not isinstance(ch, dict):
            return None
        ci = _safe_int(ch.get("chapter_index", ch.get("chapter")), default_idx)
        return {
            "chapter_index": ci,
            "title": ch.get("title", "") or "",
            "goal": ch.get("goal", "") or ch.get("summary", "") or "",
            "conflict": ch.get("conflict", "") or ch.get("core_conflict", "") or "",
            "cost": ch.get("cost", "") or "",
            "strand": ch.get("strand", "") or "",
            "cool_point_type": ch.get("cool_point_type", "") or "",
            "hook": ch.get("hook", "") or "",
            "antagonist_level": ch.get("antagonist_level", "") or "",
            "pov": ch.get("pov", "") or "",
            "outline": ch.get("outline", "") or ch.get("summary", "") or "",
        }

    # 标准卷数组
    if isinstance(payload, list):
        if not payload:
            return []
        first = payload[0]
        if isinstance(first, dict):
            # 章节数组 -> 挂到第一卷
            if any(k in first for k in ["chapter_index", "goal", "conflict", "hook"]):
                if _chapter_list_is_actually_volumes(payload):
                    vols = []
                    for idx, it in enumerate(payload, start=1):
                        if not isinstance(it, dict):
                            continue
                        vi = it.get("volume_index", it.get("volume", it.get("chapter_index", idx)))
                        vols.append({
                            "volume_index": vi,
                            "title": it.get("title", f"第{idx}卷"),
                            "summary": it.get("plot_focus", "") or it.get("summary", ""),
                            "beat_sheet": it.get("beat_sheet", ""),
                            "core_conflict": it.get("core_conflict", "") or it.get("conflict", ""),
                            "climax": it.get("climax", "") or it.get("hook", ""),
                            "chapters": []
                        })
                    return vols
                return [{
                    "volume_index": first_volume_index,
                    "chapters": payload
                }]
            # 卷数组
            return payload
        return []

    if isinstance(payload, dict):
        # 兼容中文键：{"卷":[...], "章节":[...]} 或 {"卷":{...}, "章节":{...}}
        if "卷" in payload or "章节" in payload:
            vols_raw = payload.get("卷")
            chs_raw = payload.get("章节")
            vols_list = vols_raw if isinstance(vols_raw, list) else ([vols_raw] if isinstance(vols_raw, dict) else [])
            chs_list = chs_raw if isinstance(chs_raw, list) else ([chs_raw] if isinstance(chs_raw, dict) else [])
            normalized_vols = []
            for idx, v in enumerate(vols_list, start=1):
                if not isinstance(v, dict):
                    continue
                vi = _safe_int(v.get("volume_index", v.get("volume")), idx)
                normalized_vols.append({
                    "volume_index": vi,
                    "title": v.get("title", f"第{vi}卷"),
                    "summary": v.get("summary", "") or v.get("plot_focus", ""),
                    "beat_sheet": v.get("beat_sheet", ""),
                    "core_conflict": v.get("core_conflict", "") or v.get("conflict", ""),
                    "climax": v.get("climax", "") or v.get("hook", ""),
                    "chapters": []
                })
            if not normalized_vols:
                normalized_vols = [{
                    "volume_index": first_volume_index,
                    "title": "",
                    "summary": "",
                    "beat_sheet": "",
                    "core_conflict": "",
                    "climax": "",
                    "chapters": []
                }]

            # 将章节挂到对应卷（按volume/volume_index；无则挂第一卷）
            vol_idx_map = {int(v["volume_index"]): v for v in normalized_vols}
            for cidx, ch in enumerate(chs_list, start=1):
                nch = _normalize_chapter_item(ch, cidx)
                if not nch:
                    continue
                target_vi = _safe_int((ch or {}).get("volume_index", (ch or {}).get("volume")), normalized_vols[0]["volume_index"])
                target = vol_idx_map.get(target_vi) or normalized_vols[0]
                target["chapters"].append(nch)

            return normalized_vols

        # 包裹结构
        if isinstance(payload.get("volumes"), list):
            return payload.get("volumes") or []
        if isinstance(payload.get("outline"), list):
            return payload.get("outline") or []
        if isinstance(payload.get("proposal"), list):
            return payload.get("proposal") or []

        # 单卷对象
        if any(k in payload for k in ["volume_index", "title", "summary", "chapters", "core_conflict", "beat_sheet", "climax"]):
            # 特判：该卷下chapters其实是多卷条目
            chs = payload.get("chapters")
            if _chapter_list_is_actually_volumes(chs):
                vols = []
                for idx, it in enumerate(chs, start=1):
                    if not isinstance(it, dict):
                        continue
                    vi = it.get("volume_index", it.get("volume", it.get("chapter_index", idx)))
                    vols.append({
                        "volume_index": vi,
                        "title": it.get("title", f"第{idx}卷"),
                        "summary": it.get("plot_focus", "") or it.get("summary", ""),
                        "beat_sheet": it.get("beat_sheet", ""),
                        "core_conflict": it.get("core_conflict", "") or it.get("conflict", ""),
                        "climax": it.get("climax", "") or it.get("hook", ""),
                        "chapters": []
                    })
                return vols
            return [payload]

        # 单章对象
        if any(k in payload for k in ["chapter_index", "goal", "conflict", "hook", "outline"]):
            return [{
                "volume_index": first_volume_index,
                "chapters": [payload]
            }]
    return []


def _outline_merge_preview(current_outline, incoming_outline):
    cur = current_outline if isinstance(current_outline, list) else []
    inc = incoming_outline if isinstance(incoming_outline, list) else []
    cur_map = {}
    for v in cur:
        if not isinstance(v, dict):
            continue
        try:
            vi = int(v.get("volume_index", v.get("volume")))
        except Exception:
            continue
        chs = v.get("chapters") if isinstance(v.get("chapters"), list) else []
        cur_map[vi] = set()
        for c in chs:
            try:
                cur_map[vi].add(int(c.get("chapter_index", c.get("chapter"))))
            except Exception:
                continue

    items = []
    total_add = 0
    total_update = 0
    for v in inc:
        if not isinstance(v, dict):
            continue
        try:
            vi = int(v.get("volume_index", v.get("volume")))
        except Exception:
            continue
        title = v.get("title", "") or f"第{vi}卷"
        chs = v.get("chapters") if isinstance(v.get("chapters"), list) else []
        add_cnt = 0
        upd_cnt = 0
        existed = cur_map.get(vi, set())
        for c in chs:
            try:
                ci = int(c.get("chapter_index", c.get("chapter")))
            except Exception:
                continue
            if ci in existed:
                upd_cnt += 1
            else:
                add_cnt += 1
        total_add += add_cnt
        total_update += upd_cnt
        items.append({
            "volume_index": vi,
            "volume_title": title,
            "incoming_chapters": len(chs),
            "add_chapters": add_cnt,
            "update_chapters": upd_cnt
        })
    return {
        "volumes": sorted(items, key=lambda x: x["volume_index"]),
        "total_add_chapters": total_add,
        "total_update_chapters": total_update
    }


def _world_to_json(world: WorldSetting):
    if not world:
        return {"background": "", "power_system": "", "geography": "", "factions": "", "rules": ""}
    return {
        "background": world.background or "",
        "power_system": world.power_system or "",
        "geography": world.geography or "",
        "factions": world.factions or "",
        "rules": world.rules or "",
    }


def _characters_to_json(chars):
    return [{
        "name": c.name,
        "role": c.role or "",
        "avatar": c.avatar or "",
        "personality": c.personality or "",
        "background": c.background or "",
        "abilities": c.abilities or "",
        "relationships": c.relationships or "",
        "is_main": bool(c.is_main),
    } for c in chars]


def _outline_to_json(volumes, chapters_map):
    out = []
    for v in volumes:
        out.append({
            "volume_index": v.volume_index,
            "title": v.title or "",
            "summary": v.summary or "",
            "beat_sheet": v.beat_sheet or "",
            "core_conflict": v.core_conflict or "",
            "climax": v.climax or "",
            "chapters": chapters_map.get(v.id, []),
        })
    return out


def _build_cross_module_context(db: Session, project_id: int):
    """聚合跨模块上下文，供聊天模块（尤其总纲）注入约束。"""
    project = db.query(NovelProject).filter(NovelProject.id == project_id).first()
    cp = db.query(ProjectCreativeProfile).filter(ProjectCreativeProfile.project_id == project_id).first()
    world = db.query(WorldSetting).filter(WorldSetting.project_id == project_id).first()
    chars = db.query(Character).filter(Character.project_id == project_id).order_by(Character.id.asc()).all()
    char_sys_cfg = db.query(AppConfig).filter(AppConfig.config_key == f"system_profile:{project_id}:character_system").first()
    world_sys_cfg = db.query(AppConfig).filter(AppConfig.config_key == f"system_profile:{project_id}:world_system").first()

    def _parse_cfg(cfg):
        if not cfg or not cfg.config_value:
            return {}
        try:
            data = json.loads(cfg.config_value)
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    master_outline = {}
    if project and (project.master_outline or "").strip():
        raw_outline = (project.master_outline or "").strip()
        try:
            parsed = json.loads(raw_outline)
            if isinstance(parsed, dict):
                master_outline = parsed
            else:
                master_outline = {"master_outline": raw_outline}
        except Exception:
            master_outline = {"master_outline": raw_outline}

    active_character_names = [c.name for c in chars[:20] if c.name]
    return {
        "project_meta": {
            "title": project.title if project else "",
            "genre": project.genre if project else "",
            "description": (project.description if project else "") or "",
        },
        "master_outline": master_outline,
        "creative_profile": {
            "core_contrast": (cp.core_contrast if cp else "") or "",
            "cheat_cost": (cp.cheat_cost if cp else "") or "",
            "reader_promise": (cp.reader_promise if cp else "") or "",
            "unique_mechanism": (cp.unique_mechanism if cp else "") or "",
        },
        "world_setting": _world_to_json(world),
        "character_system": _parse_cfg(char_sys_cfg),
        "world_system": _parse_cfg(world_sys_cfg),
        "active_character_names": active_character_names,
        "active_characters_preview": _characters_to_json(chars[:8]),
    }


def _current_module_json(db: Session, project_id: int, module: str):
    if module == "master_outline":
        p = db.query(NovelProject).filter(NovelProject.id == project_id).first()
        raw = (p.master_outline or "") if p else ""
        if not raw:
            return {
                "core_promise": "",
                "target_reader": "",
                "ending": "",
                "ultimate_truth": "",
                "character_endings": "",
                "act1": "",
                "act2": "",
                "act3": "",
                "act4": "",
                "act5": "",
                "master_outline": "",
            }
        try:
            data = json.loads(raw)
            if isinstance(data, dict):
                # 兼容缺省字段
                data.setdefault("core_promise", "")
                data.setdefault("target_reader", "")
                data.setdefault("ending", "")
                data.setdefault("ultimate_truth", "")
                data.setdefault("character_endings", "")
                data.setdefault("act1", "")
                data.setdefault("act2", "")
                data.setdefault("act3", "")
                data.setdefault("act4", "")
                data.setdefault("act5", "")
                data.setdefault("master_outline", "")
                return data
        except Exception:
            pass
        return {"master_outline": raw}
    if module == "creative_profile":
        cp = db.query(ProjectCreativeProfile).filter(ProjectCreativeProfile.project_id == project_id).first()
        if not cp:
            return {
                "core_contrast": "",
                "cheat_cost": "",
                "reader_promise": "",
                "unique_mechanism": "",
            }
        return {
            "core_contrast": cp.core_contrast or "",
            "cheat_cost": cp.cheat_cost or "",
            "reader_promise": cp.reader_promise or "",
            "unique_mechanism": cp.unique_mechanism or "",
        }
    if module == "character_system":
        cfg = db.query(AppConfig).filter(AppConfig.config_key == f"system_profile:{project_id}:character_system").first()
        if cfg and cfg.config_value:
            try:
                data = json.loads(cfg.config_value)
                if isinstance(data, dict):
                    data.setdefault("arc_design", "")
                    data.setdefault("ending_plan", "")
                    data.setdefault("taskcard_rule", "")
                    return data
            except Exception:
                pass
        return {"arc_design": "", "ending_plan": "", "taskcard_rule": ""}
    if module == "world_system":
        cfg = db.query(AppConfig).filter(AppConfig.config_key == f"system_profile:{project_id}:world_system").first()
        if cfg and cfg.config_value:
            try:
                data = json.loads(cfg.config_value)
                if isinstance(data, dict):
                    data.setdefault("rules", "")
                    data.setdefault("costs", "")
                    data.setdefault("resources", "")
                    data.setdefault("limits", "")
                    return data
            except Exception:
                pass
        return {"rules": "", "costs": "", "resources": "", "limits": ""}
    if module == "world":
        world = db.query(WorldSetting).filter(WorldSetting.project_id == project_id).first()
        return _world_to_json(world)
    if module == "characters":
        chars = db.query(Character).filter(Character.project_id == project_id).order_by(Character.id.asc()).all()
        return _characters_to_json(chars)
    if module == "outline":
        vols = db.query(Volume).filter(Volume.project_id == project_id).order_by(Volume.volume_index.asc()).all()
        chapters_map = {}
        for v in vols:
            chs = db.query(Chapter).filter(Chapter.volume_id == v.id).order_by(Chapter.chapter_index.asc()).all()
            chapters_map[v.id] = [{
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
            } for c in chs]
        return _outline_to_json(vols, chapters_map)
    raise HTTPException(status_code=400, detail="不支持的模块")


def _apply_module_json(db: Session, project_id: int, module: str, data):
    if module == "master_outline":
        p = db.query(NovelProject).filter(NovelProject.id == project_id).first()
        if not p:
            raise HTTPException(status_code=404, detail="项目不存在")
        payload = data or {}
        if isinstance(payload, dict):
            p.master_outline = json.dumps(payload, ensure_ascii=False)
        else:
            p.master_outline = str(payload)
        db.commit()
        return
    if module == "world":
        world = db.query(WorldSetting).filter(WorldSetting.project_id == project_id).first()
        if not world:
            world = WorldSetting(project_id=project_id)
            db.add(world)
        world.background = data.get("background", "")
        world.power_system = data.get("power_system", "")
        world.geography = data.get("geography", "")
        world.factions = data.get("factions", "")
        world.rules = data.get("rules", "")
        db.commit()
        return
    if module == "creative_profile":
        cp = db.query(ProjectCreativeProfile).filter(ProjectCreativeProfile.project_id == project_id).first()
        if not cp:
            cp = ProjectCreativeProfile(project_id=project_id)
            db.add(cp)
        cp.core_contrast = (data or {}).get("core_contrast", "")
        cp.cheat_cost = (data or {}).get("cheat_cost", "")
        cp.reader_promise = (data or {}).get("reader_promise", "")
        cp.unique_mechanism = (data or {}).get("unique_mechanism", "")
        db.commit()
        return
    if module == "character_system":
        cfg = db.query(AppConfig).filter(AppConfig.config_key == f"system_profile:{project_id}:character_system").first()
        payload = data or {}
        if not cfg:
            cfg = AppConfig(config_key=f"system_profile:{project_id}:character_system", config_value=json.dumps(payload, ensure_ascii=False))
            db.add(cfg)
        else:
            cfg.config_value = json.dumps(payload, ensure_ascii=False)
        db.commit()
        return
    if module == "world_system":
        cfg = db.query(AppConfig).filter(AppConfig.config_key == f"system_profile:{project_id}:world_system").first()
        payload = data or {}
        if not cfg:
            cfg = AppConfig(config_key=f"system_profile:{project_id}:world_system", config_value=json.dumps(payload, ensure_ascii=False))
            db.add(cfg)
        else:
            cfg.config_value = json.dumps(payload, ensure_ascii=False)
        db.commit()
        return

    if module == "characters":
        db.query(Character).filter(Character.project_id == project_id).delete()
        for item in data or []:
            db.add(Character(
                project_id=project_id,
                name=item.get("name", "未命名角色"),
                role=item.get("role", ""),
                avatar=item.get("avatar", ""),
                personality=item.get("personality", ""),
                background=item.get("background", ""),
                abilities=item.get("abilities", ""),
                relationships=item.get("relationships", ""),
                is_main=bool(item.get("is_main", False)),
            ))
        db.commit()
        return

    if module == "outline":
        # 先缓存旧章节正文/生成状态，避免重建卷纲时丢失已写内容
        existing_chapter_state = {}
        existing_vols = db.query(Volume).filter(Volume.project_id == project_id).all()
        for ev in existing_vols:
            old_chs = db.query(Chapter).filter(Chapter.volume_id == ev.id).all()
            for oc in old_chs:
                key = (int(ev.volume_index or 0), int(oc.chapter_index or 0))
                existing_chapter_state[key] = {
                    "content": oc.content or "",
                    "is_generated": bool(oc.is_generated),
                }

        old_vols = db.query(Volume).filter(Volume.project_id == project_id).all()
        old_ids = [v.id for v in old_vols]
        if old_ids:
            db.query(Chapter).filter(Chapter.volume_id.in_(old_ids)).delete(synchronize_session=False)
            db.query(Volume).filter(Volume.id.in_(old_ids)).delete(synchronize_session=False)

        used_volume_index = set()
        for idx, vdata in enumerate(data or [], start=1):
            raw_vi = vdata.get("volume_index", idx)
            try:
                vi = int(raw_vi)
            except Exception:
                vi = idx
            if vi <= 0 or vi in used_volume_index:
                vi = idx
            used_volume_index.add(vi)
            vol = Volume(
                project_id=project_id,
                volume_index=vi,
                title=vdata.get("title", ""),
                summary=vdata.get("summary", "") or vdata.get("plot_focus", ""),
                beat_sheet=vdata.get("beat_sheet", ""),
                core_conflict=vdata.get("core_conflict", ""),
                climax=vdata.get("climax", "") or vdata.get("hook", ""),
            )
            db.add(vol)
            db.flush()
            used_chapter_index = set()
            for cidx, c in enumerate((vdata.get("chapters") or []), start=1):
                raw_ci = c.get("chapter_index", cidx)
                try:
                    ci = int(raw_ci)
                except Exception:
                    ci = cidx
                if ci <= 0 or ci in used_chapter_index:
                    ci = cidx
                used_chapter_index.add(ci)
                old_state = existing_chapter_state.get((vi, ci), {"content": "", "is_generated": False})
                db.add(Chapter(
                    project_id=project_id,
                    volume_id=vol.id,
                    chapter_index=ci,
                    title=c.get("title", ""),
                    goal=c.get("goal", "") or c.get("summary", ""),
                    conflict=c.get("conflict", "") or c.get("core_conflict", ""),
                    cost=c.get("cost", ""),
                    strand=c.get("strand", ""),
                    cool_point_type=c.get("cool_point_type", ""),
                    hook=c.get("hook", ""),
                    antagonist_level=c.get("antagonist_level", ""),
                    pov=c.get("pov", ""),
                    outline=c.get("outline", "") or c.get("summary", ""),
                    content=old_state.get("content", ""),
                    is_generated=bool(old_state.get("is_generated", False)),
                ))
        db.commit()
        return

    raise HTTPException(status_code=400, detail="不支持的模块")


@router.get("/{project_id}/{module}")
def get_workbench_state(project_id: int, module: str, db: Session = Depends(get_db)):
    project = db.query(NovelProject).filter(NovelProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    session = _ensure_session(db, project_id, module)
    messages = db.query(CreativeMessage).filter(CreativeMessage.session_id == session.id).order_by(CreativeMessage.created_at.asc()).all()
    versions = db.query(CreativeVersion).filter(
        CreativeVersion.project_id == project_id,
        CreativeVersion.module == module
    ).order_by(CreativeVersion.version_no.desc()).limit(30).all()
    current = _current_module_json(db, project_id, module)
    official_key = f"official_version:{project_id}:{module}"
    official_cfg = db.query(AppConfig).filter(AppConfig.config_key == official_key).first()
    official_version_id = int(official_cfg.config_value) if (official_cfg and str(official_cfg.config_value).isdigit()) else None
    cross_ctx = _build_cross_module_context(db, project_id)
    return {
        "session_id": session.id,
        "module": module,
        "current": current,
        "injected_context": cross_ctx,
        "messages": [{
            "id": m.id,
            "role": m.role,
            "content": m.content,
            "summary": m.summary,
            "has_proposal": bool(m.proposal_json),
            "proposal_json": m.proposal_json or "",
            "created_at": m.created_at.isoformat() + "Z"
        } for m in messages],
        "versions": [{
            "id": v.id,
            "version_no": v.version_no,
            "summary": v.summary,
            "created_at": v.created_at.isoformat() + "Z",
            "is_official": (official_version_id == v.id),
        } for v in versions]
    }


@router.post("/{project_id}/{module}/chat")
def workbench_chat(project_id: int, module: str, req: WorkbenchChatRequest, db: Session = Depends(get_db)):
    project = db.query(NovelProject).filter(NovelProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    session = _ensure_session(db, project_id, module)

    db.add(CreativeMessage(session_id=session.id, role="user", content=req.message))
    db.commit()

    history = db.query(CreativeMessage).filter(CreativeMessage.session_id == session.id).order_by(CreativeMessage.created_at.asc()).all()
    current = _current_module_json(db, project_id, module)

    # 上下文增强：保留更多轮次，并把assistant摘要拼入内容，减少“像重新开始”的断档感
    hist_payload = []
    for m in history[-30:]:
        text = m.content or ""
        if m.role == "assistant" and m.summary:
            text = f"{text}\n\n[候选摘要] {m.summary}"
        hist_payload.append({"role": m.role, "content": text})

    # 上一版候选（即使未应用也可作为蓝本）
    last_assistant_with_proposal = db.query(CreativeMessage).filter(
        CreativeMessage.session_id == session.id,
        CreativeMessage.role == "assistant",
        CreativeMessage.proposal_json != ""
    ).order_by(CreativeMessage.created_at.desc()).first()
    baseline_content = current
    if last_assistant_with_proposal and last_assistant_with_proposal.proposal_json:
        try:
            baseline_content = json.loads(last_assistant_with_proposal.proposal_json)
        except Exception:
            baseline_content = current

    cross_ctx = _build_cross_module_context(db, project_id)

    result = llm_service.workbench_optimize(
        module=module,
        project_title=project.title,
        genre=project.genre,
        project_description=project.description or "",
        current_content=current,
        baseline_content=baseline_content,
        history=hist_payload,
        user_message=req.message,
        external_context=cross_ctx,
    )

    proposal = result.get("proposal")
    proposal = _sanitize_system_proposal(module, proposal, current, cross_ctx)
    if module == "characters":
        proposal = _merge_characters_proposal(current, proposal)
    summary = result.get("summary", "")
    reply = result.get("reply", "已生成候选修改。")

    msg = CreativeMessage(
        session_id=session.id,
        role="assistant",
        content=reply,
        proposal_json=json.dumps(proposal, ensure_ascii=False) if proposal is not None else "",
        summary=summary or "",
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)

    if req.save_version and proposal is not None:
        last_v = db.query(CreativeVersion).filter(
            CreativeVersion.project_id == project_id,
            CreativeVersion.module == module
        ).order_by(CreativeVersion.version_no.desc()).first()
        next_no = (last_v.version_no + 1) if last_v else 1
        ver = CreativeVersion(
            project_id=project_id,
            module=module,
            version_no=next_no,
            summary=summary or f"{module}优化候选",
            content_json=json.dumps(proposal, ensure_ascii=False),
            source_message_id=msg.id,
        )
        db.add(ver)
        db.commit()

    return {
        "assistant_message": {
            "id": msg.id,
            "content": msg.content,
            "summary": msg.summary,
            "has_proposal": bool(msg.proposal_json)
        }
    }


@router.post("/{project_id}/{module}/apply")
def apply_from_message(project_id: int, module: str, req: WorkbenchApplyRequest, db: Session = Depends(get_db)):
    msg = db.query(CreativeMessage).filter(CreativeMessage.id == req.message_id).first()
    if not msg or not msg.proposal_json:
        raise HTTPException(status_code=404, detail="未找到可应用的候选内容")
    data = json.loads(msg.proposal_json)
    if module == "characters":
        current = _current_module_json(db, project_id, module)
        data = _merge_characters_proposal(current, data)
    if module == "outline":
        current = _current_module_json(db, project_id, module)
        data = _normalize_outline_payload_for_merge(current, data)
    _apply_module_json(db, project_id, module, data)

    last_v = db.query(CreativeVersion).filter(
        CreativeVersion.project_id == project_id,
        CreativeVersion.module == module
    ).order_by(CreativeVersion.version_no.desc()).first()
    next_no = (last_v.version_no + 1) if last_v else 1
    db.add(CreativeVersion(
        project_id=project_id,
        module=module,
        version_no=next_no,
        summary=req.summary or msg.summary or "应用候选版本",
        content_json=json.dumps(data, ensure_ascii=False),
        source_message_id=msg.id,
    ))
    db.commit()
    return {"success": True}


@router.post("/{project_id}/{module}/versions/{version_id}/restore")
def restore_version(project_id: int, module: str, version_id: int, db: Session = Depends(get_db)):
    ver = db.query(CreativeVersion).filter(
        CreativeVersion.id == version_id,
        CreativeVersion.project_id == project_id,
        CreativeVersion.module == module
    ).first()
    if not ver:
        raise HTTPException(status_code=404, detail="版本不存在")
    data = json.loads(ver.content_json or "{}")
    if module == "characters":
        current = _current_module_json(db, project_id, module)
        data = _merge_characters_proposal(current, data)
    if module == "outline":
        current = _current_module_json(db, project_id, module)
        data = _normalize_outline_payload_for_merge(current, data)
    _apply_module_json(db, project_id, module, data)
    return {"success": True, "summary": ver.summary}


@router.get("/{project_id}/{module}/versions/{version_id}/diff")
def version_diff(project_id: int, module: str, version_id: int, db: Session = Depends(get_db)):
    ver = db.query(CreativeVersion).filter(
        CreativeVersion.id == version_id,
        CreativeVersion.project_id == project_id,
        CreativeVersion.module == module
    ).first()
    if not ver:
        raise HTTPException(status_code=404, detail="版本不存在")

    current = _current_module_json(db, project_id, module)
    old_text = json.dumps(current, ensure_ascii=False, indent=2).splitlines()
    new_text = json.dumps(json.loads(ver.content_json or "{}"), ensure_ascii=False, indent=2).splitlines()
    diff = "\n".join(difflib.unified_diff(old_text, new_text, fromfile="current", tofile=f"version-{ver.version_no}", lineterm=""))
    return {"diff": diff}


@router.get("/{project_id}/{module}/versions/{version_id}")
def get_version_detail(project_id: int, module: str, version_id: int, db: Session = Depends(get_db)):
    """获取历史版本完整内容"""
    ver = db.query(CreativeVersion).filter(
        CreativeVersion.id == version_id,
        CreativeVersion.project_id == project_id,
        CreativeVersion.module == module
    ).first()
    if not ver:
        raise HTTPException(status_code=404, detail="版本不存在")
    payload = {}
    try:
        payload = json.loads(ver.content_json or "{}")
    except Exception:
        payload = {"raw_text": ver.content_json or ""}
    return {
        "id": ver.id,
        "version_no": ver.version_no,
        "summary": ver.summary,
        "created_at": ver.created_at.isoformat() + "Z",
        "content": payload,
        "raw_json": ver.content_json or ""
    }


@router.post("/{project_id}/{module}/finalize")
def finalize_from_conversation(project_id: int, module: str, db: Session = Depends(get_db)):
    """将当前会话整理为一版完整候选，并自动入版本"""
    project = db.query(NovelProject).filter(NovelProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    session = _ensure_session(db, project_id, module)
    history = db.query(CreativeMessage).filter(CreativeMessage.session_id == session.id).order_by(CreativeMessage.created_at.asc()).all()
    if not history:
        raise HTTPException(status_code=400, detail="当前会话没有可整理的对话")
    current = _current_module_json(db, project_id, module)
    cross_ctx = _build_cross_module_context(db, project_id)
    result = llm_service.workbench_finalize_from_conversation(
        module=module,
        project_title=project.title,
        genre=project.genre,
        project_description=project.description or "",
        current_content=current,
        history=[{"role": m.role, "content": m.content} for m in history[-30:]],
        external_context=cross_ctx,
    )
    proposal = result.get("proposal", current)
    if module == "characters":
        proposal = _merge_characters_proposal(current, proposal)
    summary = result.get("summary", "对话整理草案")

    last_v = db.query(CreativeVersion).filter(
        CreativeVersion.project_id == project_id,
        CreativeVersion.module == module
    ).order_by(CreativeVersion.version_no.desc()).first()
    next_no = (last_v.version_no + 1) if last_v else 1

    ver = CreativeVersion(
        project_id=project_id,
        module=module,
        version_no=next_no,
        summary=summary,
        content_json=json.dumps(proposal, ensure_ascii=False),
        source_message_id=None,
    )
    db.add(ver)
    db.commit()
    db.refresh(ver)

    return {"success": True, "version_id": ver.id, "version_no": ver.version_no, "summary": ver.summary}


@router.post("/{project_id}/{module}/versions/{version_id}/publish")
def publish_version(project_id: int, module: str, version_id: int, db: Session = Depends(get_db)):
    """将某版本标记为正式版，并应用到当前模块内容"""
    ver = db.query(CreativeVersion).filter(
        CreativeVersion.id == version_id,
        CreativeVersion.project_id == project_id,
        CreativeVersion.module == module
    ).first()
    if not ver:
        raise HTTPException(status_code=404, detail="版本不存在")

    data = json.loads(ver.content_json or "{}")
    if module == "characters":
        current = _current_module_json(db, project_id, module)
        data = _merge_characters_proposal(current, data)
    if module == "outline":
        current = _current_module_json(db, project_id, module)
        data = _normalize_outline_payload_for_merge(current, data)
    _apply_module_json(db, project_id, module, data)

    key = f"official_version:{project_id}:{module}"
    cfg = db.query(AppConfig).filter(AppConfig.config_key == key).first()
    if not cfg:
        cfg = AppConfig(config_key=key, config_value=str(version_id))
        db.add(cfg)
    else:
        cfg.config_value = str(version_id)
    db.commit()
    return {"success": True, "official_version_id": version_id}


@router.post("/{project_id}/{module}/versions/{version_id}/publish-merge")
def publish_version_merge(project_id: int, module: str, version_id: int, db: Session = Depends(get_db)):
    """卷纲专用：将版本增量合并到当前内容后设为正式版。"""
    if module != "outline":
        raise HTTPException(status_code=400, detail="仅卷纲模块支持增量设正式版")
    ver = db.query(CreativeVersion).filter(
        CreativeVersion.id == version_id,
        CreativeVersion.project_id == project_id,
        CreativeVersion.module == module
    ).first()
    if not ver:
        raise HTTPException(status_code=404, detail="版本不存在")

    current = _current_module_json(db, project_id, module)
    incoming_raw = json.loads(ver.content_json or "[]")
    incoming = _normalize_outline_payload_for_merge(current, incoming_raw)
    merged = _merge_outline_proposal(current, incoming)
    _apply_module_json(db, project_id, module, merged)

    key = f"official_version:{project_id}:{module}"
    cfg = db.query(AppConfig).filter(AppConfig.config_key == key).first()
    if not cfg:
        cfg = AppConfig(config_key=key, config_value=str(version_id))
        db.add(cfg)
    else:
        cfg.config_value = str(version_id)
    db.commit()
    return {"success": True, "official_version_id": version_id, "mode": "merge"}


@router.get("/{project_id}/{module}/versions/{version_id}/publish-merge-preview")
def publish_version_merge_preview(project_id: int, module: str, version_id: int, db: Session = Depends(get_db)):
    """卷纲专用：增量发布预览（不落库）。"""
    if module != "outline":
        raise HTTPException(status_code=400, detail="仅卷纲模块支持增量发布预览")
    ver = db.query(CreativeVersion).filter(
        CreativeVersion.id == version_id,
        CreativeVersion.project_id == project_id,
        CreativeVersion.module == module
    ).first()
    if not ver:
        raise HTTPException(status_code=404, detail="版本不存在")

    current = _current_module_json(db, project_id, module)
    incoming_raw = json.loads(ver.content_json or "[]")
    incoming = _normalize_outline_payload_for_merge(current, incoming_raw)
    preview = _outline_merge_preview(current, incoming)
    return {"success": True, "preview": preview}


@router.post("/{project_id}/{module}/versions/{version_id}/tune")
def tune_version(project_id: int, module: str, version_id: int, req: VersionTuneRequest, db: Session = Depends(get_db)):
    """基于历史版本微调，并产出新历史版本"""
    project = db.query(NovelProject).filter(NovelProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    ver = db.query(CreativeVersion).filter(
        CreativeVersion.id == version_id,
        CreativeVersion.project_id == project_id,
        CreativeVersion.module == module
    ).first()
    if not ver:
        raise HTTPException(status_code=404, detail="版本不存在")
    if not (req.instruction or "").strip():
        raise HTTPException(status_code=400, detail="微调指令不能为空")

    try:
        base_content = json.loads(ver.content_json or "{}")
    except Exception:
        base_content = {"raw_text": ver.content_json or ""}

    tuned = llm_service.workbench_tune_version(
        module=module,
        project_title=project.title,
        genre=project.genre,
        project_description=project.description or "",
        base_content=base_content,
        instruction=req.instruction.strip()
    )
    proposal = tuned.get("proposal", base_content)
    if module == "characters":
        proposal = _merge_characters_proposal(base_content, proposal)
    summary = tuned.get("summary", "版本微调")

    last_v = db.query(CreativeVersion).filter(
        CreativeVersion.project_id == project_id,
        CreativeVersion.module == module
    ).order_by(CreativeVersion.version_no.desc()).first()
    next_no = (last_v.version_no + 1) if last_v else 1
    new_ver = CreativeVersion(
        project_id=project_id,
        module=module,
        version_no=next_no,
        summary=f"{summary}（基于v{ver.version_no}）",
        content_json=json.dumps(proposal, ensure_ascii=False),
        source_message_id=None,
    )
    db.add(new_ver)
    db.commit()
    db.refresh(new_ver)
    return {
        "success": True,
        "base_version_no": ver.version_no,
        "new_version_id": new_ver.id,
        "new_version_no": new_ver.version_no,
        "summary": new_ver.summary
    }


@router.post("/{project_id}/{module}/tune-current")
def tune_current(project_id: int, module: str, req: VersionTuneRequest, db: Session = Depends(get_db)):
    """基于当前模块内容微调，生成新版本并直接应用为正式版"""
    project = db.query(NovelProject).filter(NovelProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    if not (req.instruction or "").strip():
        raise HTTPException(status_code=400, detail="微调指令不能为空")

    base_content = _current_module_json(db, project_id, module)
    tuned = llm_service.workbench_tune_version(
        module=module,
        project_title=project.title,
        genre=project.genre,
        project_description=project.description or "",
        base_content=base_content,
        instruction=req.instruction.strip()
    )
    proposal = tuned.get("proposal", base_content)
    if module == "characters":
        proposal = _merge_characters_proposal(base_content, proposal)
    summary = tuned.get("summary", "当前内容微调")

    last_v = db.query(CreativeVersion).filter(
        CreativeVersion.project_id == project_id,
        CreativeVersion.module == module
    ).order_by(CreativeVersion.version_no.desc()).first()
    next_no = (last_v.version_no + 1) if last_v else 1
    new_ver = CreativeVersion(
        project_id=project_id,
        module=module,
        version_no=next_no,
        summary=summary,
        content_json=json.dumps(proposal, ensure_ascii=False),
        source_message_id=None,
    )
    db.add(new_ver)
    db.flush()

    # 直接应用 + 标记正式版
    _apply_module_json(db, project_id, module, proposal)
    key = f"official_version:{project_id}:{module}"
    cfg = db.query(AppConfig).filter(AppConfig.config_key == key).first()
    if not cfg:
        cfg = AppConfig(config_key=key, config_value=str(new_ver.id))
        db.add(cfg)
    else:
        cfg.config_value = str(new_ver.id)
    db.commit()
    db.refresh(new_ver)
    return {
        "success": True,
        "new_version_id": new_ver.id,
        "new_version_no": new_ver.version_no,
        "summary": new_ver.summary
    }


@router.post("/{project_id}/{module}/save-current-version")
def save_current_version(project_id: int, module: str, req: ManualVersionSaveRequest, db: Session = Depends(get_db)):
    """手动编辑后保存为新版本，并应用为正式版"""
    project = db.query(NovelProject).filter(NovelProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    content = req.content or {}
    if module == "characters":
        current = _current_module_json(db, project_id, module)
        content = _merge_characters_proposal(current, content)

    last_v = db.query(CreativeVersion).filter(
        CreativeVersion.project_id == project_id,
        CreativeVersion.module == module
    ).order_by(CreativeVersion.version_no.desc()).first()
    next_no = (last_v.version_no + 1) if last_v else 1
    new_ver = CreativeVersion(
        project_id=project_id,
        module=module,
        version_no=next_no,
        summary=(req.summary or "手动微调").strip() or "手动微调",
        content_json=json.dumps(content, ensure_ascii=False),
        source_message_id=None,
    )
    db.add(new_ver)
    db.flush()

    _apply_module_json(db, project_id, module, content)
    key = f"official_version:{project_id}:{module}"
    cfg = db.query(AppConfig).filter(AppConfig.config_key == key).first()
    if not cfg:
        cfg = AppConfig(config_key=key, config_value=str(new_ver.id))
        db.add(cfg)
    else:
        cfg.config_value = str(new_ver.id)
    db.commit()
    db.refresh(new_ver)
    return {
        "success": True,
        "new_version_id": new_ver.id,
        "new_version_no": new_ver.version_no,
        "summary": new_ver.summary
    }
