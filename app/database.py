from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from pydantic_settings import BaseSettings
import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./novel_writer.db")

engine = create_engine(
    DATABASE_URL, connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def ensure_runtime_schema():
    """轻量运行时补列：兼容已存在旧库（仅追加缺失列）"""
    try:
        with engine.begin() as conn:
            if conn.dialect.name != "sqlite":
                return
            rows = conn.exec_driver_sql("PRAGMA table_info(chapters)").fetchall()
            columns = {r[1] for r in rows}
            if "target_words" not in columns:
                conn.exec_driver_sql("ALTER TABLE chapters ADD COLUMN target_words INTEGER")
            if "word_count_reference" not in columns:
                conn.exec_driver_sql("ALTER TABLE chapters ADD COLUMN word_count_reference TEXT")
    except Exception as e:
        print(f"ensure_runtime_schema warning: {e}")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
