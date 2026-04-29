import json
import numpy as np
import re
import os
from typing import List, Dict, Any, Tuple
from sqlalchemy.orm import Session
from app.models.models import Entity, Chapter

# 使用 ModelScope
os.environ['MODELSCOPE_SDK_TYPE'] = 'hf'
os.environ['HF_ENDPOINT'] = 'https://hf-mirror.com'

class RAGService:
    """增强版RAG服务，支持长篇检索，适合100-200万字小说"""

    def __init__(self):
        # 使用轻量模型做embedding，本地运行不需要API
        self.model = None
        self.embedding_dim = 384  # for all-MiniLM-L6-v2

    def _load_model(self):
        """延迟加载模型，使用 ModelScope"""
        if self.model is None:
            from modelscope import snapshot_download
            from sentence_transformers import SentenceTransformer
            
            try:
                # 先尝试从 ModelScope 下载并加载
                model_dir = snapshot_download('AI-ModelScope/all-MiniLM-L6-v2')
                self.model = SentenceTransformer(model_dir)
                print(f"模型加载成功: {model_dir}")
            except Exception as e:
                print(f"从 ModelScope 加载失败: {e}")
                # 备选：直接使用模型名
                self.model = SentenceTransformer('all-MiniLM-L6-v2')

    def cosine_similarity(self, a: np.ndarray, b: np.ndarray) -> float:
        """计算余弦相似度"""
        if np.linalg.norm(a) == 0 or np.linalg.norm(b) == 0:
            return 0.0
        return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))

    def split_chunks(self, text: str, chunk_size: int = 500, overlap: int = 50) -> List[str]:
        """将文本分割成小块，适合embedding"""
        paragraphs = re.split(r'\n+', text)
        chunks = []
        current = ""

        for para in paragraphs:
            para = para.strip()
            if not para:
                continue

            if len(current) + len(para) <= chunk_size:
                current += para + "\n"
            else:
                if current:
                    chunks.append(current.strip())
                current = para + "\n"

        if current:
            chunks.append(current.strip())

        return chunks

    def get_embedding(self, text: str) -> List[float]:
        """获取文本embedding"""
        self._load_model()
        embedding = self.model.encode(text)
        return embedding.tolist()

    def index_chapter(self, db: Session, project_id: int, chapter_id: int, content: str):
        """索引章节内容，分块存入数据库"""
        # 先删除该章节已有的块
        from app.models.models import TextChunk
        db.query(TextChunk).filter(TextChunk.chapter_id == chapter_id).delete()

        chunks = self.split_chunks(content)
        for i, chunk in enumerate(chunks):
            embedding = self.get_embedding(chunk)
            text_chunk = TextChunk(
                project_id=project_id,
                chapter_id=chapter_id,
                chunk_index=i,
                content=chunk,
                embedding=json.dumps(embedding)
            )
            db.add(text_chunk)

        db.commit()

    def search_relevant(self, db: Session, project_id: int, query: str, top_k: int = 10) -> List[str]:
        """搜索与query相关的内容"""
        from app.models.models import TextChunk
        self._load_model()

        # 获取query embedding
        query_embedding = np.array(self.get_embedding(query))

        # 获取所有chunks
        chunks = db.query(TextChunk).filter(TextChunk.project_id == project_id).all()

        if not chunks:
            return []

        # 计算相似度
        similarities = []
        for chunk in chunks:
            chunk_embedding = np.array(json.loads(chunk.embedding))
            sim = self.cosine_similarity(query_embedding, chunk_embedding)
            similarities.append((sim, chunk.content))

        # 排序取top_k
        similarities.sort(reverse=True, key=lambda x: x[0])
        return [content for sim, content in similarities[:top_k]]

    def get_relevant_context(self, db: Session, project_id: int,
                            current_chapter_outline: str, top_k: int = 8) -> str:
        """获取相关上下文，用于生成新章节"""
        # 1. 向量检索相关历史内容
        relevant_chunks = self.search_relevant(db, project_id, current_chapter_outline, top_k)

        # 2. 同时加上最近3章完整内容，保证连贯性
        recent_chapters = db.query(Chapter)\
            .filter(Chapter.project_id == project_id)\
            .filter(Chapter.is_generated == True)\
            .order_by(Chapter.chapter_index.desc())\
            .limit(3)\
            .all()

        context_parts = []

        # 向量检索到的相关内容（可能包括很久以前的伏笔）
        if relevant_chunks:
            context_parts.append("【相关历史内容参考】\n（以下是从全书中检索到与本章相关的内容，请确保设定和剧情连贯）\n")
            for i, chunk in enumerate(relevant_chunks):
                context_parts.append(f"{i+1}. {chunk[:300]}..." if len(chunk) > 300 else chunk)
            context_parts.append("")

        # 最近章节内容
        if recent_chapters:
            context_parts.append("【最近章节内容】\n")
            for chap in reversed(recent_chapters):
                content = chap.content
                if len(content) > 800:
                    content = content[-800:] + "...(上文省略)"
                context_parts.append(f"第{chap.chapter_index}章《{chap.title}》:\n{content}\n")

        context = "\n".join(context_parts).strip()
        return context if context else ""

    def extract_entities(self, db: Session, project_id: int, chapter_id: int,
                        content: str, llm_service) -> List[Dict]:
        """从章节内容中提取实体"""
        # 简化版本：由LLM提取实体
        prompt = f"""请从以下小说章节中提取所有重要实体，分为：人物、地点、势力、物品四类。

章节内容：
{content[:1500]}...

请严格按JSON格式返回：
{{
  "characters": [{{"name": "xxx", "description": "xxx"}}, ...],
  "locations": [{{"name": "xxx", "description": "xxx"}}, ...],
  "factions": [{{"name": "xxx", "description": "xxx"}}, ...],
  "items": [{{"name": "xxx", "description": "xxx"}}]
}}

只返回JSON，不要其他文字。"""

        result = llm_service.generate(prompt, None, temperature=0.7)
        result = result.strip()
        
        # 调试：打印原始响应
        if not result:
            print(f"警告：LLM返回为空内容，跳过实体提取")
            return []
        
        # 尝试多种方式提取 JSON
        json_str = None
        
        # 1. 直接是 JSON 格式
        if result.startswith("{") and result.endswith("}"):
            json_str = result
        # 2. Markdown 代码块
        elif result.startswith("```json"):
            json_str = result[7:].strip()
            if json_str.endswith("```"):
                json_str = json_str[:-3].strip()
        elif result.startswith("```"):
            json_str = result[3:].strip()
            if json_str.endswith("```"):
                json_str = json_str[:-3].strip()
        # 3. 从文本中提取 JSON（适用于 MiniMax 等模型）
        else:
            import re
            # 尝试匹配 { ... } 结构
            match = re.search(r'\{[\s\S]*\}', result)
            if match:
                json_str = match.group()
            # 尝试匹配 [ ... ] 结构
            if not json_str:
                match = re.search(r'\[[\s\S]*\]', result)
                if match:
                    json_str = match.group()

        try:
            data = json.loads(json_str) if json_str else {}
            entities = []

            # 保存到数据库
            from app.models.models import Entity
            for char in data.get("characters", []):
                entity = Entity(
                    project_id=project_id,
                    chapter_id=chapter_id,
                    entity_type="character",
                    entity_name=char.get("name", ""),
                    description=char.get("description", "")
                )
                db.add(entity)
                entities.append({
                    "type": "character",
                    "name": char.get("name", ""),
                    "description": char.get("description", "")
                })

            for loc in data.get("locations", []):
                entity = Entity(
                    project_id=project_id,
                    chapter_id=chapter_id,
                    entity_type="location",
                    entity_name=loc.get("name", ""),
                    description=loc.get("description", "")
                )
                db.add(entity)
                entities.append({
                    "type": "location",
                    "name": loc.get("name", ""),
                    "description": loc.get("description", "")
                })

            for fac in data.get("factions", []):
                entity = Entity(
                    project_id=project_id,
                    chapter_id=chapter_id,
                    entity_type="faction",
                    entity_name=fac.get("name", ""),
                    description=fac.get("description", "")
                )
                db.add(entity)
                entities.append({
                    "type": "faction",
                    "name": fac.get("name", ""),
                    "description": fac.get("description", "")
                })

            for item in data.get("items", []):
                entity = Entity(
                    project_id=project_id,
                    chapter_id=chapter_id,
                    entity_type="item",
                    entity_name=item.get("name", ""),
                    description=item.get("description", "")
                )
                db.add(entity)
                entities.append({
                    "type": "item",
                    "name": item.get("name", ""),
                    "description": item.get("description", "")
                })

            db.commit()
            return entities

        except Exception as e:
            print(f"提取实体失败: {e}")
            return []

rag_service = RAGService()
