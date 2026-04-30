import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Boolean, Float
from sqlalchemy.orm import relationship
from app.database import Base

class NovelProject(Base):
    """小说项目"""
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    description = Column(Text)
    genre = Column(String(50), nullable=False)  # 流派：玄幻、都市、穿越等
    master_outline = Column(Text)  # 项目总纲 - 整体构思、主角成长弧线、核心主题
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    # 关系
    world_setting = relationship("WorldSetting", back_populates="project", uselist=False)
    characters = relationship("Character", back_populates="project")
    volumes = relationship("Volume", back_populates="project")
    chapters = relationship("Chapter", back_populates="project")

    # 配置
    enable_review = Column(Boolean, default=False)  # 是否启用审查
    target_words_per_chapter = Column(Integer, default=2000)


class ProjectCreativeProfile(Base):
    """题材新颖度结构化配置"""
    __tablename__ = "project_creative_profiles"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), unique=True, index=True, nullable=False)
    core_contrast = Column(Text, default="")  # 核心反差
    cheat_cost = Column(Text, default="")  # 金手指代价
    reader_promise = Column(Text, default="")  # 读者承诺
    unique_mechanism = Column(Text, default="")  # 独特机制
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

class WorldSetting(Base):
    """世界观设定"""
    __tablename__ = "world_settings"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"))
    background = Column(Text)  # 背景历史
    power_system = Column(Text)  # 力量体系
    geography = Column(Text)  # 地理设定
    factions = Column(Text)  # 势力设定
    rules = Column(Text)  # 世界规则

    project = relationship("NovelProject", back_populates="world_setting")

class Character(Base):
    """角色"""
    __tablename__ = "characters"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"))
    name = Column(String(100), nullable=False)
    role = Column(String(200))  # 角色定位/身份
    avatar = Column(String(500))  # 外貌描述
    personality = Column(Text)  # 性格
    background = Column(Text)  # 背景故事
    abilities = Column(Text)  # 能力
    relationships = Column(Text)  # 与其他角色的关系
    is_main = Column(Boolean, default=False)  # 是否主角

    project = relationship("NovelProject", back_populates="characters")


class CharacterRelationship(Base):
    """角色关系边（群像关系图）"""
    __tablename__ = "character_relationships"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), index=True, nullable=False)
    source_character_id = Column(Integer, ForeignKey("characters.id"), index=True, nullable=False)
    target_character_id = Column(Integer, ForeignKey("characters.id"), index=True, nullable=False)
    relation_type = Column(String(50), nullable=False, default="acquaintance")  # ally/enemy/family/love/master_rival...
    intensity = Column(Float, default=0.5)  # 0~1
    status = Column(String(100), default="stable")  # current status: trust-broken/cooperate/hostile...
    notes = Column(Text, default="")
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

class Volume(Base):
    """卷"""
    __tablename__ = "volumes"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"))
    volume_index = Column(Integer, nullable=False)  # 卷号
    title = Column(String(200))
    summary = Column(Text)  # 卷概要
    beat_sheet = Column(Text)  # 节拍表 - 情节推进节点
    core_conflict = Column(Text)  # 核心冲突
    climax = Column(Text)  # 卷高潮
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    project = relationship("NovelProject", back_populates="volumes")
    chapters = relationship("Chapter", back_populates="volume")

class Chapter(Base):
    """章节"""
    __tablename__ = "chapters"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"))
    volume_id = Column(Integer, ForeignKey("volumes.id"))
    chapter_index = Column(Integer, nullable=False)  # 章节号
    title = Column(String(200))

    # 精细大纲结构，参考专业实践
    goal = Column(Text)  # 本章目标
    conflict = Column(Text)  # 本章阻力/冲突
    cost = Column(Text)  # 本章代价
    strand = Column(String(20))  # Quest(主线) / Fire(感情线) / Constellation(世界观扩展)
    cool_point_type = Column(String(50))  # 爽点类型
    hook = Column(Text)  # 本章钩子
    antagonist_level = Column(String(20))  # 反派层级：小/中/大
    pov = Column(String(50))  # 视角主角

    outline = Column(Text)  # 本章综合大纲
    content = Column(Text)  # 正文

    word_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)
    is_generated = Column(Boolean, default=False)

    project = relationship("NovelProject", back_populates="chapters")
    volume = relationship("Volume", back_populates="chapters")

class Entity(Base):
    """实体（用于RAG检索）"""
    __tablename__ = "entities"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"))
    entity_type = Column(String(50))  # character, location, faction, item
    entity_name = Column(String(100))
    description = Column(Text)
    embedding = Column(Text)  # 存储向量JSON
    chapter_id = Column(Integer, ForeignKey("chapters.id"))

    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class TextChunk(Base):
    """文本块，用于RAG向量检索"""
    __tablename__ = "text_chunks"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"))
    chapter_id = Column(Integer, ForeignKey("chapters.id"))
    chunk_index = Column(Integer, nullable=False)
    content = Column(Text, nullable=False)
    embedding = Column(Text, nullable=False)  # 存储向量JSON

    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class AppConfig(Base):
    """应用级配置（键值存储）"""
    __tablename__ = "app_configs"

    id = Column(Integer, primary_key=True, index=True)
    config_key = Column(String(100), unique=True, nullable=False, index=True)
    config_value = Column(Text, nullable=False, default="")
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class CreativeSession(Base):
    """创作工作台会话"""
    __tablename__ = "creative_sessions"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), index=True, nullable=False)
    module = Column(String(30), index=True, nullable=False)  # world/characters/outline
    title = Column(String(200), default="")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class CreativeMessage(Base):
    """会话消息记录"""
    __tablename__ = "creative_messages"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("creative_sessions.id"), index=True, nullable=False)
    role = Column(String(20), nullable=False)  # user/assistant
    content = Column(Text, nullable=False, default="")
    proposal_json = Column(Text, default="")  # assistant可附带结构化候选内容
    summary = Column(String(300), default="")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class CreativeVersion(Base):
    """模块版本快照，可回滚对比"""
    __tablename__ = "creative_versions"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), index=True, nullable=False)
    module = Column(String(30), index=True, nullable=False)  # world/characters/outline
    version_no = Column(Integer, nullable=False, default=1)
    summary = Column(String(300), default="")
    content_json = Column(Text, nullable=False, default="")
    source_message_id = Column(Integer, ForeignKey("creative_messages.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
