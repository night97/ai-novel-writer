import os
import json
from typing import Optional, List
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

        self.anthropic_client = None
        self.openai_client = None
        self._init_clients()

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
            return {"ok": True, "message": "校验通过：模型可调用"}
        except Exception as e:
            msg = str(e)
            if "404" in msg or "not found" in msg.lower():
                return {"ok": False, "message": f"校验失败：模型不存在或 base_url 不匹配（{msg}）"}
            if "401" in msg or "unauthorized" in msg.lower() or "invalid api key" in msg.lower():
                return {"ok": False, "message": f"校验失败：API Key 无效（{msg}）"}
            return {"ok": False, "message": f"校验失败：{msg}"}

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
        if response.choices and response.choices[0].message:
            return response.choices[0].message.content or ""
        return ""

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

        if self.provider == "openai":
            return self._generate_openai(prompt, system_prompt, temperature)
        return self._generate_anthropic(prompt, system_prompt, temperature)

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

    def generate_outline(self, genre: str, title: str, world_setting: str, characters: str,
                        num_volumes: int, chapters_per_volume: int, user_prompt: str) -> List[dict]:
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

        prompt = f"""小说标题：{title}
用户需求：{user_prompt}

世界观设定：
{world_setting}

角色列表：
{characters}

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
                               user_prompt: str) -> List[dict]:
        """在已有卷骨架基础上，生成指定范围的章节"""
        system_prompt = f"""你是专业网络小说大纲设计师。为{genre}类型小说这一卷生成指定范围的章节大纲。

规则：
- 生成 {chapters_count} 章，从第 {start_chapter} 章开始
- 严格遵循卷骨架给定的整体结构和节拍表
- 每3-5章必须有一个小高潮/爽点
- 遵循"防幻觉三定律": 大纲就是法律，后续写作必须严格遵循
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
            prompt_parts.append(f"\n【角色设定】\n{characters}")

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

llm_service = LLMService()
