import os
import json
from typing import Optional, List
from collections import deque
from datetime import datetime
import time
from anthropic import Anthropic
from openai import OpenAI
from openai import APITimeoutError
from dotenv import load_dotenv
import numpy as np
import httpx

load_dotenv()

class LLMService:
    def __init__(self):
        provider = os.getenv("LLM_PROVIDER", "anthropic").strip().lower()
        if provider not in ["anthropic", "openai"]:
            provider = "anthropic"

        self.provider = provider
        if self.provider == "anthropic":
            self.api_key = os.getenv("ANTHROPIC_API_KEY", "")
            self.base_url = os.getenv("ANTHROPIC_BASE_URL", "https://api.anthropic.com")
            self.model = os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022")
        else:
            self.api_key = os.getenv("OPENAI_API_KEY", "")
            self.base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
            self.model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
        self.max_tokens = int(os.getenv("MAX_TOKENS", "16384"))
        self.request_timeout = float(os.getenv("LLM_REQUEST_TIMEOUT", "90"))
        self.trust_env = os.getenv("LLM_TRUST_ENV", "false").strip().lower() == "true"
        self.auth_mode = os.getenv("LLM_AUTH_MODE", "bearer").strip().lower()

        self.anthropic_client = None
        self.openai_client = None
        self.call_logs = deque(maxlen=120)
        self._init_clients()

    def _append_call_log(self, ok: bool, latency_ms: int, error: str = ""):
        self.call_logs.appendleft({
            "time": datetime.utcnow().isoformat() + "Z",
            "provider": self.provider,
            "model": self.model,
            "base_url": self.base_url,
            "ok": ok,
            "latency_ms": latency_ms,
            "error": error[:300] if error else "",
        })

    def get_call_logs(self, limit: int = 50):
        lim = max(1, min(200, int(limit)))
        return list(self.call_logs)[:lim]

    def _init_clients(self):
        self.anthropic_client = None
        self.openai_client = None
        if self.provider == "anthropic":
            self.anthropic_client = Anthropic(api_key=self.api_key, base_url=self.base_url)
        elif self.provider == "openai":
            http_client = httpx.Client(timeout=self.request_timeout, trust_env=self.trust_env)
            self.openai_client = OpenAI(
                api_key=self.api_key,
                base_url=self.base_url,
                timeout=self.request_timeout,
                http_client=http_client
            )

    def get_runtime_config(self) -> dict:
        return {
            "provider": self.provider,
            "api_key": self.api_key,
            "base_url": self.base_url,
            "model": self.model,
            "max_tokens": self.max_tokens,
        }

    def set_runtime_config(self, config: dict):
        self.provider = (config.get("provider") or self.provider).strip().lower()
        if self.provider not in ["anthropic", "openai"]:
            self.provider = "anthropic"
        self.api_key = config.get("api_key", self.api_key)
        base_url = config.get("base_url", self.base_url)
        if not base_url:
            base_url = "https://api.anthropic.com" if self.provider == "anthropic" else "https://api.openai.com/v1"
        self.base_url = base_url
        self.model = config.get("model", self.model)
        self.max_tokens = int(config.get("max_tokens", self.max_tokens))
        self._init_clients()

    def validate_config(self, config: dict) -> dict:
        """校验模型配置是否可用，不会改动当前运行时配置"""
        provider = (config.get("provider") or "anthropic").strip().lower()
        if provider not in ["anthropic", "openai"]:
            provider = "anthropic"

        api_key = (config.get("api_key") or "").strip()
        base_url = (config.get("base_url") or "").strip()
        model = (config.get("model") or "").strip()
        max_tokens = int(config.get("max_tokens") or 1024)

        if not api_key:
            return {"ok": False, "message": "API Key 不能为空"}
        if not model:
            return {"ok": False, "message": "Model 不能为空"}
        if not base_url:
            base_url = "https://api.anthropic.com" if provider == "anthropic" else "https://api.openai.com/v1"

        start = time.time()
        try:
            if provider == "anthropic":
                client = Anthropic(api_key=api_key, base_url=base_url)
                client.messages.create(
                    model=model,
                    max_tokens=min(max_tokens, 64),
                    temperature=0,
                    messages=[{"role": "user", "content": "ping"}],
                )
            else:
                http_client = httpx.Client(timeout=self.request_timeout, trust_env=self.trust_env)
                client = OpenAI(api_key=api_key, base_url=base_url, http_client=http_client)
                client.chat.completions.create(
                    model=model,
                    messages=[{"role": "user", "content": "ping"}],
                    temperature=0,
                    max_tokens=min(max_tokens, 64),
                )
            return {"ok": True, "message": "校验通过：模型可调用", "latency_ms": int((time.time() - start) * 1000)}
        except Exception as e:
            if provider == "openai":
                try:
                    tmp_headers = self._build_openai_auth_headers(api_key)
                    tmp_payload = {
                        "model": model,
                        "messages": [{"role": "user", "content": "ping"}],
                        "temperature": 0,
                        "max_tokens": min(max_tokens, 64),
                    }
                    with httpx.Client(timeout=self.request_timeout, trust_env=self.trust_env) as client:
                        for url in self._candidate_chat_completion_urls(base_url):
                            r = client.post(url, headers=tmp_headers, json=tmp_payload)
                            if r.status_code < 400:
                                return {"ok": True, "message": f"校验通过（HTTP兼容路径）: {url}", "latency_ms": int((time.time() - start) * 1000)}
                except Exception:
                    pass
            msg = str(e)
            if "404" in msg or "not found" in msg.lower():
                return {"ok": False, "message": f"校验失败：模型不存在或 base_url 不匹配（{msg}）", "latency_ms": int((time.time() - start) * 1000)}
            if "401" in msg or "unauthorized" in msg.lower() or "invalid api key" in msg.lower():
                return {"ok": False, "message": f"校验失败：API Key 无效（{msg}）", "latency_ms": int((time.time() - start) * 1000)}
            return {"ok": False, "message": f"校验失败：{msg}", "latency_ms": int((time.time() - start) * 1000)}

    def _generate_anthropic(self, prompt: str, system_prompt: Optional[str], temperature: float) -> str:
        messages = [{"role": "user", "content": prompt}]
        if system_prompt:
            response = self.anthropic_client.messages.create(
                model=self.model,
                max_tokens=self.max_tokens,
                temperature=temperature,
                system=system_prompt,
                messages=messages
            )
        else:
            response = self.anthropic_client.messages.create(
                model=self.model,
                max_tokens=self.max_tokens,
                temperature=temperature,
                messages=messages
            )

        result_parts = []
        for block in response.content:
            if hasattr(block, "type") and block.type == "text" and hasattr(block, "text"):
                result_parts.append(block.text)
        if result_parts:
            return "\n".join(result_parts)

        content_block = response.content[0]
        if hasattr(content_block, "text") and content_block.text:
            return content_block.text
        return str(content_block)

    def _generate_openai(self, prompt: str, system_prompt: Optional[str], temperature: float) -> str:
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})
        try:
            response = self.openai_client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=temperature,
                max_tokens=self.max_tokens
            )
        except APITimeoutError:
            # 超时后自动降载重试一次，减少长输出导致的超时概率
            retry_max_tokens = min(self.max_tokens, 4096)
            print(f"OpenAI请求超时，自动重试：max_tokens {self.max_tokens} -> {retry_max_tokens}")
            response = self.openai_client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=temperature,
                max_tokens=retry_max_tokens
            )
        except Exception as e:
            print(f"OpenAI SDK调用失败，尝试原生HTTP兼容重试: {e}")
            return self._generate_openai_http_fallback(
                messages=messages,
                temperature=temperature,
                max_tokens=min(self.max_tokens, 4096)
            )
        if response.choices and response.choices[0].message:
            msg = response.choices[0].message
            content = (msg.content or "").strip() if hasattr(msg, "content") else ""
            if content:
                return content
            # 兼容部分网关返回 reasoning_content 而 content 为空
            rc = getattr(msg, "reasoning_content", None)
            return (rc or "")
        return ""

    def _build_openai_auth_headers(self, api_key: str) -> dict:
        headers = {"Content-Type": "application/json"}
        mode = self.auth_mode
        if mode in ["bearer", "both", "auto", ""]:
            headers["Authorization"] = f"Bearer {api_key}"
        if mode in ["x-api-key", "both"]:
            headers["x-api-key"] = api_key
        return headers

    def _candidate_chat_completion_urls(self, base_url: str) -> List[str]:
        base = (base_url or "").rstrip("/")
        urls = [f"{base}/chat/completions"]
        if not base.endswith("/v1"):
            urls.append(f"{base}/v1/chat/completions")
        urls.append(f"{base}/openai/v1/chat/completions")
        seen = set()
        uniq = []
        for u in urls:
            if u not in seen:
                seen.add(u)
                uniq.append(u)
        return uniq

    def _generate_openai_http_fallback(self, messages: List[dict], temperature: float, max_tokens: int) -> str:
        headers = self._build_openai_auth_headers(self.api_key)
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        last_err = ""
        with httpx.Client(timeout=self.request_timeout, trust_env=self.trust_env) as client:
            for url in self._candidate_chat_completion_urls(self.base_url):
                try:
                    resp = client.post(url, headers=headers, json=payload)
                    if resp.status_code >= 400:
                        last_err = f"{resp.status_code} {resp.text[:300]}"
                        continue
                    data = resp.json()
                    choices = data.get("choices") if isinstance(data, dict) else None
                    if choices and isinstance(choices, list) and isinstance(choices[0], dict):
                        msg = choices[0].get("message") or {}
                        content = msg.get("content")
                        if content:
                            print(f"HTTP兼容重试成功: {url}")
                            return content
                        rc = msg.get("reasoning_content")
                        if rc:
                            print(f"HTTP兼容重试成功(仅reasoning_content): {url}")
                            return rc
                    if isinstance(data, dict) and data.get("output_text"):
                        print(f"HTTP兼容重试成功(非标准output_text): {url}")
                        return str(data.get("output_text"))
                    last_err = f"unexpected_response {str(data)[:200]}"
                except Exception as e:
                    last_err = str(e)
                    continue
        raise RuntimeError(f"OpenAI兼容HTTP重试失败: {last_err}")

    def _parse_json_maybe(self, result: str, fallback):
        text = (result or "").strip()
        if text.startswith("```json"):
            text = text[7:].strip()
            if text.endswith("```"):
                text = text[:-3].strip()
        elif text.startswith("```"):
            text = text[3:].strip()
            if text.endswith("```"):
                text = text[:-3].strip()
        try:
            return json.loads(text)
        except Exception:
            return fallback

    def _extract_master_outline_act_count(self, external_context: Optional[dict]) -> int:
        if not isinstance(external_context, dict):
            return 0
        mo = external_context.get("master_outline")
        if not isinstance(mo, dict):
            return 0
        if isinstance(mo.get("acts"), list):
            return len([x for x in mo.get("acts") if str(x).strip()])
        count = 0
        for k, v in mo.items():
            if isinstance(k, str) and k.lower().startswith("act") and str(v).strip():
                try:
                    int(k[3:])
                    count += 1
                except Exception:
                    continue
        return count

    def _hook_rules_for_early_chapters(self, chapter_index: int) -> str:
        if chapter_index <= 0:
            return ""
        if chapter_index <= 5:
            return f"""【前5章爆点强化规则（当前第{chapter_index}章）】
- 必须在前30%篇幅给出本章核心冲突/诱发事件
- 必须至少有1个“代价明确”的抉择时刻
- 每400-600字至少推进一次（信息增量/关系变化/危险升级）
- 章末必须留强钩子，且与下一章主冲突直接相关
- 避免说明文铺陈，优先行动-反应-后果链"""
        return ""

    def generate_chapter_beats(self, project_info: dict, chapter: dict, context: str, chapter_index: int) -> List[dict]:
        genre = project_info.get("genre", "")
        hook_rules = self._hook_rules_for_early_chapters(chapter_index)
        system_prompt = f"""你是{genre}网文策划编辑。请把章节拆成5-8个高推进度的场景Beat，用于后续扩写。
只输出JSON数组，不要解释。"""
        prompt = f"""小说标题：{project_info.get('title','')}
【本卷规划】
{project_info.get('volume_info','')}

【世界观】
{project_info.get('world_setting','')}

【本章活跃角色（优先）】
{project_info.get('active_characters','')}

【群像出场任务卡（必须落实）】
{project_info.get('character_task_cards','')}

【题材新颖度配置】
{project_info.get('creative_profile','')}

【角色系统约束】
{project_info.get('character_system','')}

【世界观系统约束】
{project_info.get('world_system','')}

【本章大纲】
标题：{chapter.get('title','')}
目标：{chapter.get('goal','')}
冲突：{chapter.get('conflict','')}
代价：{chapter.get('cost','')}
钩子：{chapter.get('hook','')}
概要：{chapter.get('outline','')}

{hook_rules}

请输出JSON数组，每项字段：
- beat_index: 序号
- objective: 本Beat目标
- conflict: 本Beat冲突
- turn: 反转/推进点
- cliff: 小钩子
"""
        result = self.generate(prompt, system_prompt, temperature=0.5)
        beats = self._parse_json_maybe(result, [])
        if isinstance(beats, list) and len(beats) >= 3:
            return beats[:8]
        return [
            {"beat_index": 1, "objective": "开场冲突触发", "conflict": chapter.get("conflict", ""), "turn": "局势升级", "cliff": "危机逼近"},
            {"beat_index": 2, "objective": "角色应对", "conflict": "代价压力上升", "turn": "出现意外", "cliff": "更大麻烦"},
            {"beat_index": 3, "objective": "强抉择", "conflict": "必须付出代价", "turn": "做出选择", "cliff": chapter.get("hook", "留下悬念")},
        ]

    def generate_chapter_from_beats(self, project_info: dict, chapter: dict, beats: List[dict], context: str, target_words: int, chapter_index: int) -> str:
        genre = project_info.get("genre", "")
        hook_rules = self._hook_rules_for_early_chapters(chapter_index)
        system_prompt = f"""你是一个专业的{genre}网络小说作者。根据提供的Beat扩写为完整章节。
要求：节奏紧凑、冲突明确、少说教、多行动与对话。"""
        prompt = f"""小说标题：{project_info.get('title','')}
【本卷规划】\n{project_info.get('volume_info','')}
【世界观】\n{project_info.get('world_setting','')}
【角色设定（全量）】\n{project_info.get('characters','')}
【本章活跃角色（优先）】\n{project_info.get('active_characters','')}
【群像出场任务卡（必须落实）】\n{project_info.get('character_task_cards','')}
【题材新颖度配置】\n{project_info.get('creative_profile','')}
【角色系统约束】\n{project_info.get('character_system','')}
【世界观系统约束】\n{project_info.get('world_system','')}
【前文回顾】\n{context}
【本章信息】
标题：{chapter.get('title','')}
目标：{chapter.get('goal','')}
冲突：{chapter.get('conflict','')}
代价：{chapter.get('cost','')}
钩子：{chapter.get('hook','')}

【Beat清单（必须按顺序落实）】
{json.dumps(beats, ensure_ascii=False, indent=2)}

{hook_rules}
{self._word_limit_rules_text(target_words)}

请输出正文，约{target_words}字。"""
        return self.generate(prompt, system_prompt, temperature=0.7)

    def score_chapter_quality(self, project_info: dict, chapter: dict, content: str, chapter_index: int) -> dict:
        hook_rules = self._hook_rules_for_early_chapters(chapter_index)
        system_prompt = """你是网文质量审校器。对章节进行结构化打分，只输出JSON。"""
        prompt = f"""请给以下维度打分(1-5)：hook_strength, pacing, conflict_intensity, info_gain, ending_cliff, character_arc_consistency, world_rule_consistency。
并返回：
{{
  "scores": {{"hook_strength":0,"pacing":0,"conflict_intensity":0,"info_gain":0,"ending_cliff":0,"character_arc_consistency":0,"world_rule_consistency":0}},
  "weak_dimensions": ["..."],
  "feedback": "一句话改进建议"
}}

{hook_rules}

【角色系统约束】
{project_info.get('character_system','')}
【世界观系统约束】
{project_info.get('world_system','')}

章节标题：{chapter.get('title','')}
正文：
{content[:6000]}
"""
        result = self.generate(prompt, system_prompt, temperature=0.2)
        parsed = self._parse_json_maybe(result, {})
        if not isinstance(parsed, dict) or "scores" not in parsed:
            return {"scores": {"hook_strength": 3, "pacing": 3, "conflict_intensity": 3, "info_gain": 3, "ending_cliff": 3, "character_arc_consistency": 3, "world_rule_consistency": 3}, "weak_dimensions": [], "feedback": ""}
        return parsed

    def _split_content_sections(self, content: str):
        paras = [p for p in (content or "").split("\n\n") if p.strip()]
        if len(paras) < 3:
            n = len(content or "")
            a = int(n * 0.33)
            b = int(n * 0.66)
            return (content[:a], content[a:b], content[b:])
        n = len(paras)
        i = max(1, int(n * 0.33))
        j = max(i + 1, int(n * 0.66))
        opening = "\n\n".join(paras[:i])
        middle = "\n\n".join(paras[i:j])
        ending = "\n\n".join(paras[j:])
        return (opening, middle, ending)

    def _word_limit_bounds(self, target_words: int):
        t = max(500, int(target_words or 2000))
        low = max(300, int(t * 0.9))
        high = max(low + 80, int(t * 1.1))
        return t, low, high

    def _word_limit_rules_text(self, target_words: int) -> str:
        t, low, high = self._word_limit_bounds(target_words)
        return f"【字数硬约束】目标字数={t}，允许范围={low}-{high}。必须落在该区间内。"

    def _enforce_word_count_hard(self, chapter: dict, content: str, target_words: int, chapter_index: int) -> str:
        _, low, high = self._word_limit_bounds(target_words)
        cur = len((content or "").replace("\n", ""))
        if low <= cur <= high:
            return content
        action = "扩写补足有效信息与动作" if cur < low else "压缩删冗"
        hook_rules = self._hook_rules_for_early_chapters(chapter_index)
        system_prompt = "你是网文改稿编辑。仅做字数校正，不改主线事件。"
        prompt = f"""请对正文做{action}，并强制控制在 {low}-{high} 字。
要求：
1) 保持主线事件顺序、核心冲突、章末钩子不变；
2) 不新增大支线，不删除关键设定；
3) 仅输出校正后的正文。

{hook_rules}
{self._word_limit_rules_text(target_words)}

【章节标题】{chapter.get('title','')}
【正文】
{content}
"""
        adjusted = self.generate(prompt, system_prompt, temperature=0.4)
        return adjusted if adjusted and adjusted.strip() else content

    def _rewrite_chapter_partially(self, project_info: dict, chapter: dict, content: str, weak: List[str], feedback: str, chapter_index: int) -> str:
        hook_rules = self._hook_rules_for_early_chapters(chapter_index)
        opening, middle, ending = self._split_content_sections(content)
        system_prompt = """你是网文改稿编辑。做“局部重写”而不是整章重写。仅输出JSON。"""
        prompt = f"""请根据弱项做局部增强，只返回JSON：
{{
  "revised_opening": "若无需改开头可返回空字符串",
  "revised_middle": "若无需改中段可返回空字符串",
  "revised_ending": "若无需改结尾可返回空字符串"
}}

弱项：{weak}
改进建议：{feedback}
{hook_rules}

【角色系统约束】
{project_info.get('character_system','')}
【世界观系统约束】
{project_info.get('world_system','')}

【开头段】
{opening}

【中段】
{middle}

【结尾段】
{ending}
"""
        parsed = self._parse_json_maybe(self.generate(prompt, system_prompt, temperature=0.5), {})
        if not isinstance(parsed, dict):
            return content
        new_opening = (parsed.get("revised_opening") or "").strip()
        new_middle = (parsed.get("revised_middle") or "").strip()
        new_ending = (parsed.get("revised_ending") or "").strip()
        merged = [
            new_opening if new_opening else opening,
            new_middle if new_middle else middle,
            new_ending if new_ending else ending,
        ]
        return "\n\n".join([s for s in merged if (s or "").strip()]).strip()

    def rewrite_chapter_by_feedback(self, project_info: dict, chapter: dict, content: str, quality: dict, target_words: int, chapter_index: int) -> str:
        weak = quality.get("weak_dimensions", [])
        feedback = quality.get("feedback", "")
        # 优先局部重写，降低整章重写漂移风险
        partial = self._rewrite_chapter_partially(project_info, chapter, content, weak, feedback, chapter_index)
        if partial and len(partial) > int(len(content or "") * 0.6):
            return partial
        hook_rules = self._hook_rules_for_early_chapters(chapter_index)
        system_prompt = "你是网文改稿编辑。保持主线与设定不变，只针对弱项做加强，输出完整新正文。"
        prompt = f"""请基于原文做定向增强，弱项：{weak}。
改进建议：{feedback}
{hook_rules}
{self._word_limit_rules_text(target_words)}

【原文】
{content}

输出约{target_words}字完整改写正文。"""
        return self.generate(prompt, system_prompt, temperature=0.6)

    def generate_chapter_with_pipeline(self, project_info: dict, chapter: dict, context: str, target_words: int, chapter_index: int) -> str:
        beats = self.generate_chapter_beats(project_info, chapter, context, chapter_index)
        content = self.generate_chapter_from_beats(project_info, chapter, beats, context, target_words, chapter_index)
        quality = self.score_chapter_quality(project_info, chapter, content, chapter_index)
        scores = quality.get("scores", {}) if isinstance(quality, dict) else {}
        # 闸门：任一维度低于3.5时自动重写一次
        weak = [k for k, v in scores.items() if isinstance(v, (int, float)) and float(v) < 3.5]
        if weak:
            quality["weak_dimensions"] = weak
            content = self.rewrite_chapter_by_feedback(project_info, chapter, content, quality, target_words, chapter_index)
        content = self._enforce_word_count_hard(chapter, content, target_words, chapter_index)
        return content

    def generate(self, prompt: str, system_prompt: Optional[str] = None, temperature: float = 0.7) -> str:
        """调用配置的大模型生成文本"""

        # 打印请求参数
        print("\n" + "="*60)
        print("【LLM API 调用参数】")
        print(f"Model: {self.model}")
        print(f"Max Tokens: {self.max_tokens}")
        print(f"Temperature: {temperature}")
        print(f"Base URL: {self.base_url}")
        if system_prompt:
            print(f"\n【System Prompt】:\n{system_prompt[:500]}{'...' if len(system_prompt) > 500 else ''}")
        print(f"\n【User Prompt】:\n{prompt[:1000]}{'...' if len(prompt) > 1000 else ''}")
        print("="*60 + "\n")

        start = time.time()
        try:
            if self.provider == "openai":
                result = self._generate_openai(prompt, system_prompt, temperature)
            else:
                result = self._generate_anthropic(prompt, system_prompt, temperature)
            self._append_call_log(True, int((time.time() - start) * 1000))
            return result
        except Exception as e:
            self._append_call_log(False, int((time.time() - start) * 1000), str(e))
            raise

    def generate_world_setting(self, genre: str, user_prompt: str) -> dict:
        """生成世界观设定"""
        system_prompt = f"""你是一个专业的网络小说世界观设计师。
用户正在创作一部{genre}类型的网络小说，请根据用户的需求生成完整的世界观设定。

请严格按照以下JSON格式返回：
{{
  "background": "完整的背景历史描述",
  "power_system": "力量体系详细说明，包括等级划分等",
  "geography": "地理环境和主要区域介绍",
  "factions": "主要势力组织介绍",
  "rules": "这个世界的基本规则"
}}

只返回JSON，不要其他文字。"""

        prompt = f"""用户需求：{user_prompt}

请生成世界观设定，返回JSON格式。"""

        result = self.generate(prompt, system_prompt, temperature=0.6)
        result = result.strip()
        if result.startswith("```json"):
            result = result[7:-3]
        elif result.startswith("```"):
            result = result[3:-3]

        try:
            return json.loads(result)
        except:
            # 如果解析失败，返回纯文本
            return {
                "background": result,
                "power_system": "",
                "geography": "",
                "factions": "",
                "rules": ""
            }

    def generate_characters(self, genre: str, world_setting: str, user_prompt: str, existing_characters: str = "") -> List[dict]:
        """生成角色列表"""
        system_prompt = f"""你是一个专业的网络小说角色设计师。
用户正在创作一部{genre}类型的网络小说，请根据世界观和用户需求生成主角和主要配角。

⚠️ **非常重要**：你必须严格返回合法的JSON格式，不要输出任何其他文字、说明、markdown标记。只返回JSON数组。

请严格按照以下JSON格式返回：
[
  {{
    "name": "角色姓名",
    "role": "角色定位/身份，比如：主角/男主角/反派/主角父亲/宗门长老...",
    "avatar": "外貌描述",
    "personality": "性格特点",
    "background": "背景故事",
    "abilities": "能力特长",
    "relationships": "与其他角色的关系",
    "is_main": true/false
  }}
]

要求：
1. 一般生成1个主角，2-4个主要配角
2. 必须填写role字段说明这个角色的定位身份
3. 如果已有同名角色，请不要重复创造，可以合并设定或者调整
4. is_main的值必须是true或false（小写，不要加引号）
5. **只返回JSON，不要任何其他内容**，不要用```包裹，不要说明文字"""

        prompt = f"""世界观设定：
{world_setting}

用户需求：{user_prompt}"""

        if existing_characters and existing_characters.strip():
            prompt += f"""

【已有角色列表，请避免重复创造同名角色】：
{existing_characters}"""

        prompt += "\n\n请生成角色列表，记住只返回合法JSON，不要其他内容："""

        result = self.generate(prompt, system_prompt, temperature=0.6)
        result = result.strip()
        if result.startswith("```json"):
            result = result[7:-3]
        elif result.startswith("```"):
            result = result[3:-3]

        try:
            return json.loads(result)
        except Exception as e:
            print(f"解析角色列表失败: {e}")
            # 尝试修复不完整的JSON
            result_fixed = result.strip()
            # 如果被截断，尝试找到最后一个完整的JSON结构
            # 补齐可能缺失的括号
            open_brackets = result_fixed.count('[') - result_fixed.count(']')
            open_braces = result_fixed.count('{') - result_fixed.count('}')
            for _ in range(open_braces):
                result_fixed += '}'
            for _ in range(open_brackets):
                result_fixed += ']'
            # 尝试重新解析
            try:
                parsed = json.loads(result_fixed)
                print(f"修复成功，得到 {len(parsed)} 个角色")
                return parsed
            except:
                print("修复失败，返回空列表")
                return []

    def generate_novelty_seed(self, genre: str, title: str, world_setting: str, characters: str, user_prompt: str, creative_profile: str = "") -> dict:
        """先生成卖点一句话 + 三个独特规则"""
        system_prompt = f"""你是{genre}网文策划总编。请先完成题材卖点定位。
只输出JSON：
{{
  "one_liner": "一句话卖点（20~40字）",
  "unique_rules": ["规则1","规则2","规则3"]
}}
规则：
- one_liner必须包含反差与代价
- unique_rules必须可落地到剧情推进
- 不要使用固定主角姓名占位，避免写死人名"""
        prompt = f"""小说标题：{title}
用户需求：{user_prompt}
世界观：
{world_setting}
角色：
{characters}
题材新颖度结构化输入：
{creative_profile}
请生成卖点一句话和三个独特规则。"""
        result = self.generate(prompt, system_prompt, temperature=0.5)
        parsed = self._parse_json_maybe(result, {})
        if not isinstance(parsed, dict):
            return {"one_liner": "", "unique_rules": []}
        one_liner = parsed.get("one_liner", "") or ""
        unique_rules = parsed.get("unique_rules", []) or []
        if not isinstance(unique_rules, list):
            unique_rules = []
        return {"one_liner": one_liner, "unique_rules": unique_rules[:3]}

    def generate_outline(self, genre: str, title: str, world_setting: str, characters: str,
                        num_volumes: int, chapters_per_volume: int, user_prompt: str, creative_profile: str = "") -> List[dict]:
        """生成全书大纲"""
        system_prompt = f"""你是专业网络小说大纲设计师。为{genre}类型小说生成这一卷大纲。

遵循**Fichtean危机链叙事结构**：
1. 【开卷承诺】开篇明确给出读者期待，金手指尽早出现
2. 【催化事件】第1-3章必须有触发事件，改变主角现状，不可逆
3. 【升级危机链】每3-5章一个危机，危机逐步升级，风险越来越大
4. 【中段反转】大约过半要有反转，打破读者预期
5. 【卷末最低谷】主角陷入绝境，所有希望破灭
6. 【高潮兑现+新钩子】解决本卷危机，留下钩子引向卷

通用规则：
- 生成这一卷，共 {chapters_per_volume} 章
- 每3-5章必须有一个小高潮/爽点
- 遵循"防幻觉三定律": 大纲就是法律，后续写作必须严格遵循
- 金手指第一卷就要进入主线
- 先落实“卖点一句话+三个独特规则”，并持续体现在章节目标/冲突/代价中
- 每章必须标记：
  * strand: Quest(主线推进)/Fire(感情线)/Constellation(世界观扩展)
  * cool_point_type: 悬念爽/反转爽/智斗爽/打脸爽/升级爽/选择爽/绝境求生爽
  * antagonist_level: 小/中/大，反派强度
  * 每章末尾必须留钩子吸引读者追更

JSON格式：
[
  {{
    "volume_index": 1,
    "title": "卷标题",
    "summary": "本卷内容概要(100字以内)",
    "beat_sheet": "本卷节拍表简述：催化事件 → 危机1 → 危机2 → 反转 → 低谷 → 高潮",
    "core_conflict": "本卷核心冲突是什么",
    "climax": "卷高潮简述",
    "chapters": [
      {{
        "chapter_index": 1,
        "title": "第一章标题",
        "goal": "本章目标是什么",
        "conflict": "本章阻力/冲突是什么",
        "cost": "主角要付出什么代价",
        "strand": "Quest / Fire / Constellation",
        "cool_point_type": "爽点类型",
        "hook": "章末钩子",
        "antagonist_level": "小 / 中 / 大",
        "pov": "主角姓名",
        "outline": "本章内容简短总结，30-80字"
      }}
    ]
  }}
]

⚠️ 只返回JSON，不要任何其他文字。"""

        novelty = self.generate_novelty_seed(
            genre=genre,
            title=title,
            world_setting=world_setting,
            characters=characters,
            user_prompt=user_prompt,
            creative_profile=creative_profile
        )
        one_liner = novelty.get("one_liner", "")
        rules = novelty.get("unique_rules", [])
        rules_text = "\n".join([f"- {r}" for r in rules]) if rules else "- 规则待在章节中自行补全"

        prompt = f"""小说标题：{title}
用户需求：{user_prompt}
题材新颖度结构化输入：
{creative_profile}

世界观设定：
{world_setting}

角色列表：
{characters}

【先验卖点】
卖点一句话：{one_liner}
三个独特规则：
{rules_text}

请生成 {num_volumes} 卷，每卷 {chapters_per_volume} 章的完整大纲。返回JSON格式。"""

        result = self.generate(prompt, system_prompt, temperature=0.5)
        result = result.strip()
        if result.startswith("```json"):
            result = result[7:-3]
        elif result.startswith("```"):
            result = result[3:-3]

        try:
            return json.loads(result)
        except Exception as e:
            print(f"解析大纲失败: {e}")
            # 尝试修复不完整的JSON
            import re
            # 如果被截断，尝试找到最后一个完整的JSON结构
            result_fixed = result.rstrip()
            # 补齐可能缺失的括号
            open_brackets = result_fixed.count('[') - result_fixed.count(']')
            open_braces = result_fixed.count('{') - result_fixed.count('}')
            for _ in range(open_braces):
                result_fixed += '}'
            for _ in range(open_brackets):
                result_fixed += ']'
            # 尝试重新解析
            try:
                parsed = json.loads(result_fixed)
                print(f"修复成功，得到 {len(parsed)} 卷")
                return parsed
            except:
                print("修复失败")
                return []

    def generate_volume_skeleton(self, genre: str, title: str, world_setting: str, characters: str,
                               total_chapters: int, user_prompt: str) -> List[dict]:
        """生成卷骨架（只生成卷结构，不生成具体章节）"""
        system_prompt = f"""你是专业网络小说大纲设计师。为{genre}类型小说生成这一卷的骨架结构。

遵循**Fichtean危机链叙事结构**：
1. 【开卷承诺】开篇明确给出读者期待，金手指尽早出现
2. 【催化事件】必须有触发事件，改变主角现状，不可逆
3. 【升级危机链】危机逐步升级，风险越来越大
4. 【中段反转】大约过半要有反转，打破读者预期
5. 【卷末最低谷】主角陷入绝境，所有希望破灭
6. 【高潮兑现+新钩子】解决本卷危机，留下钩子引向下一卷

本卷总共 {total_chapters} 章，请规划好整体结构。

JSON格式：
[
  {{
    "volume_index": 1,
    "title": "卷标题",
    "summary": "本卷内容概要(100字以内)",
    "beat_sheet": "简述节拍表：催化事件 → 危机1 → 危机2 → 反转 → 低谷 → 高潮",
    "core_conflict": "本卷核心冲突是什么",
    "climax": "卷高潮简述"
  }}
]

⚠️ 只返回JSON，不要任何其他文字。"""

        prompt = f"""小说标题：{title}
用户需求：{user_prompt}

世界观设定：
{world_setting}

角色列表：
{characters}

请生成本卷骨架结构，总章节数 {total_chapters} 章。记住只返回JSON："""

        result = self.generate(prompt, system_prompt, temperature=0.5)
        result = result.strip()
        if result.startswith("```json"):
            result = result[7:-3]
        elif result.startswith("```"):
            result = result[3:-3]

        try:
            return json.loads(result)
        except Exception as e:
            print(f"解析卷骨架失败: {e}")
            # 尝试修复不完整的JSON
            result_fixed = result.rstrip()
            # 补齐可能缺失的括号
            open_brackets = result_fixed.count('[') - result_fixed.count(']')
            open_braces = result_fixed.count('{') - result_fixed.count('}')
            for _ in range(open_braces):
                result_fixed += '}'
            for _ in range(open_brackets):
                result_fixed += ']'
            # 尝试重新解析
            try:
                parsed = json.loads(result_fixed)
                print(f"修复成功，得到 {len(parsed)} 卷")
                return parsed
            except:
                print("修复失败")
                return []

    def generate_volume_chapters(self, genre: str, title: str, volume_info: str, world_setting: str, characters: str,
                               volume_index: int, start_chapter: int, chapters_count: int, total_chapters: int,
                               user_prompt: str, existing_context: str = "") -> List[dict]:
        """在已有卷骨架基础上，生成指定范围的章节"""
        system_prompt = f"""你是专业网络小说大纲设计师。为{genre}类型小说这一卷生成指定范围的章节大纲。

规则：
- 生成 {chapters_count} 章，从第 {start_chapter} 章开始
- 严格遵循卷骨架给定的整体结构和节拍表
- 每3-5章必须有一个小高潮/爽点
- 遵循"防幻觉三定律": 大纲就是法律，后续写作必须严格遵循
- 严禁重复已发生事件：同样的场景+目标+敌人组合不能再次出现
- 每章必须有“信息增量”：至少推进一个新情报/新代价/新关系变化
- 每章必须标记：
  * strand: Quest(主线推进)/Fire(感情线)/Constellation(世界观扩展)
  * cool_point_type: 悬念爽/反转爽/智斗爽/打脸爽/升级爽/选择爽/绝境求生爽
  * antagonist_level: 小/中/大，反派强度
  * 每章末尾必须留钩子吸引读者追更

JSON格式：
[
  {{
    "chapter_index": {start_chapter},
    "title": "章节标题",
    "goal": "本章目标是什么",
    "conflict": "本章阻力/冲突是什么",
    "cost": "主角要付出什么代价",
    "strand": "Quest / Fire / Constellation",
    "cool_point_type": "爽点类型",
    "hook": "章末钩子",
    "antagonist_level": "小 / 中 / 大",
    "pov": "主角姓名",
    "outline": "本章内容简短总结，30-80字"
  }}
]

⚠️ 只返回JSON，不要任何其他文字。"""

        prompt = f"""小说标题：{title}
用户需求：{user_prompt}

【本卷整体信息】
{volume_info}

世界观设定：
{world_setting}

角色列表：
{characters}

【已生成章节上下文与去重约束】
{existing_context}

请生成第 {volume_index} 卷的第 {start_chapter} - {start_chapter + chapters_count - 1} 章，共 {chapters_count} 章。
本卷总共 {total_chapters} 章。记住只返回JSON："""

        result = self.generate(prompt, system_prompt, temperature=0.5)
        result = result.strip()
        if result.startswith("```json"):
            result = result[7:-3]
        elif result.startswith("```"):
            result = result[3:-3]

        try:
            return json.loads(result)
        except Exception as e:
            print(f"解析章节列表失败: {e}")
            # 尝试修复不完整的JSON
            result_fixed = result.rstrip()
            # 补齐可能缺失的括号
            open_brackets = result_fixed.count('[') - result_fixed.count(']')
            open_braces = result_fixed.count('{') - result_fixed.count('}')
            for _ in range(open_braces):
                result_fixed += '}'
            for _ in range(open_brackets):
                result_fixed += ']'
            # 尝试重新解析
            try:
                parsed = json.loads(result_fixed)
                print(f"修复成功，得到 {len(parsed)} 章")
                return parsed
            except:
                print("修复失败")
                return []

    def generate_chapter(self, project_info: dict, chapter: dict,
                         context: str, target_words: int) -> str:
        """生成章节正文"""
        genre = project_info.get("genre", "")
        world_setting = project_info.get("world_setting", "")
        characters = project_info.get("characters", "")
        active_characters = project_info.get("active_characters", "")
        volume_info = project_info.get("volume_info", "")
        enable_review = project_info.get("enable_review", False)

        system_prompt = f"""你是一个专业的网络小说作家，正在创作一部{genre}类型的网络小说。

请严格遵守：
1. **大纲即法律**：必须严格按照给定的本章大纲规划来写，不得偏离
2. **设定即物理**：必须严格遵守已有的世界观设定和人物设定，不得矛盾
3. **遵循整体结构**：必须符合本卷的整体规划和核心冲突走向
4. 本章节字数控制在 {target_words} 字左右
5. 保持流畅的行文节奏，符合网络小说阅读习惯
6. 对话要符合人物身份
7. 按照规划安排好冲突和爽点，节奏要紧凑
8. 结尾一定要留下规划好的钩子吸引读者"""

        prompt_parts = []
        prompt_parts.append(f"""小说标题：{project_info['title']}""")

        if volume_info:
            prompt_parts.append(f"\n【本卷整体规划】\n{volume_info}")

        if world_setting:
            prompt_parts.append(f"\n【世界观设定】\n{world_setting}")

        if characters:
            prompt_parts.append(f"\n【角色设定（全量）】\n{characters}")

        if active_characters:
            prompt_parts.append(f"\n【本章活跃角色（优先遵循）】\n{active_characters}")

        if context:
            prompt_parts.append(f"\n【前文回顾】\n{context}")

        # 添加本章详细规划
        prompt_parts.append("\n【本章详细规划】")
        if chapter.get("goal") and chapter.get("goal").strip():
            prompt_parts.append(f"- 本章目标：{chapter['goal']}")
        if chapter.get("conflict") and chapter.get("conflict").strip():
            prompt_parts.append(f"- 核心冲突：{chapter['conflict']}")
        if chapter.get("cost") and chapter.get("cost").strip():
            prompt_parts.append(f"- 需要付出的代价：{chapter['cost']}")
        if chapter.get("strand") and chapter.get("strand").strip():
            prompt_parts.append(f"- 剧情线分类：{chapter['strand']}")
        if chapter.get("cool_point_type") and chapter.get("cool_point_type").strip():
            prompt_parts.append(f"- 本章爽点类型：{chapter['cool_point_type']}")
        if chapter.get("antagonist_level") and chapter.get("antagonist_level").strip():
            prompt_parts.append(f"- 反派层级：{chapter['antagonist_level']}")
        if chapter.get("pov") and chapter.get("pov").strip():
            prompt_parts.append(f"- 本章视角：{chapter['pov']}")
        if chapter.get("hook") and chapter.get("hook").strip():
            prompt_parts.append(f"- 章末钩子要求：{chapter['hook']}")
        if chapter.get("outline") and chapter.get("outline").strip():
            prompt_parts.append(f"- 内容概要：{chapter['outline']}")

        prompt_parts.append(f"\n请开始写正文，字数约 {target_words} 字：")

        prompt = "\n".join(prompt_parts)

        return self.generate(prompt, system_prompt, temperature=0.7)

    def optimize_chapter_content(self, project_info: dict, chapter: dict, original_content: str,
                               optimize_instruction: str, context: str, target_words: int) -> str:
        """优化已生成的章节正文"""
        genre = project_info.get("genre", "")
        world_setting = project_info.get("world_setting", "")
        characters = project_info.get("characters", "")
        volume_info = project_info.get("volume_info", "")

        system_prompt = f"""你是一个专业的网络小说编辑，正在对{genre}小说进行润色优化。

要求：
1. 严格遵循大纲设定，不得改变原有剧情走向
2. 根据优化指令进行改进
3. 保持整体文风一致性
4. 字数保持在大约 {target_words} 字
5. 改进后质量必须比原文更好"""

        prompt_parts = []
        prompt_parts.append(f"""小说标题：{project_info['title']}""")

        if volume_info:
            prompt_parts.append(f"\n【本卷整体规划】\n{volume_info}")

        if world_setting:
            prompt_parts.append(f"\n【世界观设定】\n{world_setting}")

        if characters:
            prompt_parts.append(f"\n【角色设定】\n{characters}")

        if context:
            prompt_parts.append(f"\n【前文回顾】\n{context}")

        prompt_parts.append("\n【本章详细规划】")
        if chapter.get("goal") and chapter.get("goal").strip():
            prompt_parts.append(f"- 本章目标：{chapter['goal']}")
        if chapter.get("conflict") and chapter.get("conflict").strip():
            prompt_parts.append(f"- 核心冲突：{chapter['conflict']}")
        if chapter.get("outline") and chapter.get("outline").strip():
            prompt_parts.append(f"- 内容概要：{chapter['outline']}")

        prompt_parts.append(f"\n【优化指令】\n{optimize_instruction}")

        prompt_parts.append(f"\n【原文】\n{original_content}")

        prompt_parts.append(f"\n\n请给出优化后的全文，字数约 {target_words}：")

        prompt = "\n".join(prompt_parts)

        return self.generate(prompt, system_prompt, temperature=0.6)

    def continue_chapter(self, existing_content: str, project_info: dict,
                       chapter: dict, target_words: int, remaining_words: int) -> str:
        """续写章节"""
        genre = project_info.get("genre", "")

        system_prompt = f"""你是一个专业的网络小说作家。
请根据前文内容，按照大纲继续写完本章。

要求：
1. 严格遵循大纲，保持剧情连贯
2. 保持文风一致
3. 再写大约 {remaining_words} 字
4. 符合{genre}类型小说的风格
5. 结尾要留下规划好的钩子"""

        prompt_parts = []
        prompt_parts.append(f"""小说信息：{project_info['title']}""")

        prompt_parts.append("\n【本章详细规划】")
        if chapter.get("goal") and chapter.get("goal").strip():
            prompt_parts.append(f"- 本章目标：{chapter['goal']}")
        if chapter.get("conflict") and chapter.get("conflict").strip():
            prompt_parts.append(f"- 核心冲突：{chapter['conflict']}")
        if chapter.get("cool_point_type") and chapter.get("cool_point_type").strip():
            prompt_parts.append(f"- 爽点类型：{chapter['cool_point_type']}")
        if chapter.get("hook") and chapter.get("hook").strip():
            prompt_parts.append(f"- 章末钩子：{chapter['hook']}")
        if chapter.get("outline") and chapter.get("outline").strip():
            prompt_parts.append(f"- 内容概要：{chapter['outline']}")

        prompt_parts.append(f"\n前文：\n{existing_content}")
        prompt_parts.append("\n请继续写完：")

        prompt = "\n".join(prompt_parts)

        return self.generate(prompt, system_prompt, temperature=0.7)

    def workbench_optimize(self, module: str, project_title: str, genre: str, project_description: str,
                           current_content, baseline_content, history: list, user_message: str, external_context: Optional[dict] = None) -> dict:
        """世界观/角色/大纲 对话式优化，返回可落地候选结构"""
        edit_mode_hint = ""
        trigger_words = ["以上个", "上一版", "在此基础上", "基于上", "不要重写", "微调", "小改", "延续"]
        msg = (user_message or "")
        if any(w in msg for w in trigger_words):
            edit_mode_hint = """\n【编辑模式：强增量】
- 必须基于“上一版候选内容”做增量编辑，不得整稿推翻重来
- 未被用户明确要求修改的字段必须保持不变
- 若是长文本，保留原结构与核心段落，仅改动用户指定点
- 若发现需求冲突，优先保留上一版主结构并最小化改动"""

        act_count = self._extract_master_outline_act_count(external_context)
        outline_act_guard = ""
        if module == "outline" and act_count > 0:
            outline_act_guard = f"""
- module=outline 额外硬约束：总纲当前为{act_count}幕，卷纲必须保持该幕数与阶段顺序，不得擅自合并为更少幕数"""

        system_prompt = f"""你是网络小说项目的开发编辑，负责对话式迭代优化。
当前模块：{module}
必须输出JSON对象：
{{
  "reply": "给用户的人类可读回复，简洁说明改了什么",
  "summary": "本次改动摘要（20字内）",
  "proposal": <结构化候选内容>
}}

proposal规则：
- module=master_outline: proposal必须是对象，优先字段：
  core_promise/target_reader/ending/ultimate_truth/character_endings/act1...actN（建议5-8幕）
  可附带 master_outline 作为全文串联
- module=creative_profile: proposal必须是对象，字段 core_contrast/cheat_cost/reader_promise/unique_mechanism
- module=character_system: proposal必须是对象，字段 arc_design/ending_plan/taskcard_rule
- module=world_system: proposal必须是对象，字段 rules/costs/resources/limits
- module=world: proposal必须是对象，字段 background/power_system/geography/factions/rules
- module=characters: proposal必须是数组，每项含 name/role/avatar/personality/background/abilities/relationships/is_main
- module=outline: proposal必须是卷数组，字段参考 volume+chapter 结构
- 不要写死主角名字，除非用户明确指定
- 在保持设定一致性的前提下，尽量提升冲突密度与可读性
- 默认采用“增量修改”，不要无故重建全新方案
{outline_act_guard}
{edit_mode_hint}"""

        prompt = f"""项目：{project_title}（{genre}）
项目描述：{project_description}

【上一版候选内容（优先蓝本）】
{json.dumps(baseline_content, ensure_ascii=False, indent=2)}

【当前内容JSON】
{json.dumps(current_content, ensure_ascii=False, indent=2)}

【最近对话】
{json.dumps(history, ensure_ascii=False)}

【用户本轮要求】
{user_message}

【跨模块上下文（必须作为硬约束参考）】
{json.dumps(external_context or {}, ensure_ascii=False, indent=2)}

请返回JSON对象。"""
        result = self.generate(prompt, system_prompt, temperature=0.5)
        parsed = self._parse_json_maybe(result, {})
        if not isinstance(parsed, dict):
            return {"reply": "我已根据要求生成候选修改，请查看版本并应用。", "summary": "生成候选", "proposal": current_content}
        if "proposal" not in parsed:
            parsed["proposal"] = current_content
        if "reply" not in parsed:
            parsed["reply"] = "已生成候选修改。"
        if "summary" not in parsed:
            parsed["summary"] = "候选优化"
        return parsed

    def workbench_finalize_from_conversation(self, module: str, project_title: str, genre: str,
                                             project_description: str, current_content, history: list, external_context: Optional[dict] = None) -> dict:
        """将多轮对话整理为一版可落地内容（重点用于outline）"""
        act_count = self._extract_master_outline_act_count(external_context)
        outline_act_guard = ""
        if module == "outline" and act_count > 0:
            outline_act_guard = f"\n- 对outline：总纲当前为{act_count}幕，整理结果必须保持该幕数与阶段顺序，不得合并幕。"
        system_prompt = f"""你是网络小说主编。请把多轮对话需求整理为一版完整可执行稿。
当前模块：{module}
仅输出JSON对象：
{{
  "summary": "本版摘要（20字内）",
  "proposal": <结构化内容>
}}
要求：
- proposal必须完整可落地，不是补丁
- 对master_outline：优先输出“多幕结构（建议5-8幕）+终局+角色终局+终极真相”
- 对outline：输出完整卷+章结构数组
- 对outline：若总纲已有明确幕数，必须保持一致，禁止擅自压缩幕数
- 不要写死主角名字，除非对话明确指定
- 保证前后设定一致，冲突和钩子要明确{outline_act_guard}"""
        prompt = f"""项目：{project_title}（{genre}）
项目描述：{project_description}

【当前内容JSON】
{json.dumps(current_content, ensure_ascii=False, indent=2)}

【对话记录】
{json.dumps(history, ensure_ascii=False)}

【跨模块上下文（必须作为硬约束参考）】
{json.dumps(external_context or {}, ensure_ascii=False, indent=2)}

请输出整理后的完整proposal。"""
        result = self.generate(prompt, system_prompt, temperature=0.4)
        parsed = self._parse_json_maybe(result, {})
        if not isinstance(parsed, dict) or "proposal" not in parsed:
            return {"summary": "对话整理草案", "proposal": current_content}
        if "summary" not in parsed:
            parsed["summary"] = "对话整理草案"
        return parsed

    def workbench_tune_version(self, module: str, project_title: str, genre: str, project_description: str,
                               base_content, instruction: str) -> dict:
        """基于某个历史版本做微调，返回新候选"""
        system_prompt = f"""你是网络小说项目编辑，负责“在既有版本上微调”。
当前模块：{module}
必须输出JSON对象：
{{
  "summary": "微调摘要（20字内）",
  "proposal": <结构化内容>
}}

强约束：
- 必须基于输入的 base_content 做最小必要改动
- 未提及修改的字段保持不变
- 禁止重建全新方案、禁止大幅改写结构"""
        prompt = f"""项目：{project_title}（{genre}）
项目描述：{project_description}

【base_content（必须作为蓝本）】
{json.dumps(base_content, ensure_ascii=False, indent=2)}

【微调指令】
{instruction}

请输出JSON对象。"""
        result = self.generate(prompt, system_prompt, temperature=0.4)
        parsed = self._parse_json_maybe(result, {})
        if not isinstance(parsed, dict) or "proposal" not in parsed:
            return {"summary": "微调候选", "proposal": base_content}
        if "summary" not in parsed:
            parsed["summary"] = "微调候选"
        return parsed

llm_service = LLMService()
