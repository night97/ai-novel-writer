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


class CharacterRelationshipCreate(BaseModel):
    source_character_id: int
    target_character_id: int
    relation_type: str = "acquaintance"
    intensity: float = 0.5
    status: str = "stable"
    notes: Optional[str] = ""


class CharacterRelationshipUpdate(BaseModel):
    relation_type: Optional[str] = None
    intensity: Optional[float] = None
    status: Optional[str] = None
    notes: Optional[str] = None


class CharacterRelationshipResponse(CharacterRelationshipCreate):
    id: int
    project_id: int
    updated_at: datetime

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
    goal: Optional[str] = None
    conflict: Optional[str] = None
    cost: Optional[str] = None
    strand: Optional[str] = None
    cool_point_type: Optional[str] = None
    hook: Optional[str] = None
    antagonist_level: Optional[str] = None
    pov: Optional[str] = None
    target_words: Optional[int] = None
    word_count_reference: Optional[str] = None
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
    target_words: Optional[int] = None

class RegenerateChapterRequest(BaseModel):
    project_id: int
    chapter_id: Optional[int] = None
    user_prompt: str = ""
    target_words: Optional[int] = None

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
    enabled: Optional[bool] = True
    tags: Optional[List[str]] = []
    last_check: Optional[dict] = {}


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


class ProjectCreativeProfileCreate(BaseModel):
    core_contrast: Optional[str] = ""
    cheat_cost: Optional[str] = ""
    reader_promise: Optional[str] = ""
    unique_mechanism: Optional[str] = ""


class ProjectCreativeProfileResponse(ProjectCreativeProfileCreate):
    id: int
    project_id: int
    updated_at: datetime

    class Config:
        from_attributes = True


class WorkbenchChatRequest(BaseModel):
    message: str
    save_version: bool = True


class WorkbenchApplyRequest(BaseModel):
    message_id: int
    summary: Optional[str] = ""


class VersionTuneRequest(BaseModel):
    instruction: str


class ManualVersionSaveRequest(BaseModel):
    content: dict
    summary: Optional[str] = "手动微调"
