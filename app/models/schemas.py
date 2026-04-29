from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

class NovelProjectCreate(BaseModel):
    title: str
    description: Optional[str] = None
    genre: str
    user_prompt: str  # 用户输入的创作需求
    enable_review: bool = False
    target_words_per_chapter: int = 2000

class NovelProjectResponse(BaseModel):
    id: int
    title: str
    description: Optional[str]
    master_outline: Optional[str]
    genre: str
    created_at: datetime
    updated_at: datetime
    enable_review: bool
    target_words_per_chapter: int

    class Config:
        from_attributes = True

class WorldSettingCreate(BaseModel):
    background: Optional[str] = None
    power_system: Optional[str] = None
    geography: Optional[str] = None
    factions: Optional[str] = None
    rules: Optional[str] = None

class WorldSettingResponse(WorldSettingCreate):
    id: int
    project_id: int

    class Config:
        from_attributes = True

class CharacterCreate(BaseModel):
    name: str
    role: Optional[str] = None
    avatar: Optional[str] = None
    personality: Optional[str] = None
    background: Optional[str] = None
    abilities: Optional[str] = None
    relationships: Optional[str] = None
    is_main: bool = False

class CharacterResponse(CharacterCreate):
    id: int
    project_id: int

    class Config:
        from_attributes = True

class VolumeCreate(BaseModel):
    title: Optional[str] = None
    summary: Optional[str] = None
    beat_sheet: Optional[str] = None
    core_conflict: Optional[str] = None
    climax: Optional[str] = None
    volume_index: int

class VolumeResponse(VolumeCreate):
    id: int
    project_id: int
    created_at: datetime

    class Config:
        from_attributes = True

class ChapterCreate(BaseModel):
    title: Optional[str] = None
    outline: Optional[str] = None
    chapter_index: int
    volume_id: int

class ChapterResponse(ChapterCreate):
    id: int
    project_id: int
    volume_id: int
    content: Optional[str]
    word_count: int
    is_generated: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class GenerateOutlineRequest(BaseModel):
    project_id: int
    num_volumes: int = 1
    chapters_per_volume: int = 10

class GenerateChapterRequest(BaseModel):
    project_id: int
    chapter_id: int

class RegenerateChapterRequest(BaseModel):
    project_id: int
    chapter_id: Optional[int] = None
    user_prompt: str = ""

class GenerateRequest(BaseModel):
    prompt: str
    system_prompt: Optional[str] = None

class GenerationResponse(BaseModel):
    success: bool
    content: str
    message: Optional[str] = None


class LLMConfigResponse(BaseModel):
    provider: str
    api_key: str
    base_url: str
    model: str
    max_tokens: int


class LLMConfigUpdate(BaseModel):
    provider: str
    api_key: str
    base_url: Optional[str] = ""
    model: str
    max_tokens: int = 16384


class LLMProfile(BaseModel):
    id: str
    name: str
    provider: str
    api_key: str
    base_url: str
    model: str
    max_tokens: int


class LLMProfileCreate(BaseModel):
    name: str
    provider: str
    api_key: str
    base_url: Optional[str] = ""
    model: str
    max_tokens: int = 16384


class LLMProfileUpdate(LLMProfileCreate):
    pass


class LLMProfilesResponse(BaseModel):
    active_profile_id: str
    profiles: List[LLMProfile]
