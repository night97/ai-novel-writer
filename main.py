import os
import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from dotenv import load_dotenv

from app.database import engine, Base, SessionLocal
from app.routes import projects, characters, outline, write, settings, workbench
from app.routes.settings import sync_llm_runtime_with_active_profile

# 创建数据库表
Base.metadata.create_all(bind=engine)

load_dotenv()

app = FastAPI(title="AI 小说写作工具", description="基于 Claude API 的自动网络小说写作工具")

@app.on_event("startup")
def startup_sync_llm_runtime():
    """启动时同步一次运行时模型配置，确保与数据库活动配置一致"""
    db = SessionLocal()
    try:
        sync_llm_runtime_with_active_profile(db)
    except Exception as e:
        print(f"启动同步模型配置失败: {e}")
    finally:
        db.close()

# 注册路由
app.include_router(projects.router)
app.include_router(characters.router)
app.include_router(outline.router)
app.include_router(write.router)
app.include_router(settings.router)
app.include_router(workbench.router)

# 静态文件
app.mount("/static", StaticFiles(directory="static"), name="static")

# 首页
@app.get("/")
async def read_index():
    return FileResponse("templates/index.html")

@app.get("/model-center")
async def read_model_center():
    return FileResponse("templates/model_center.html")

if __name__ == "__main__":
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8004"))
    uvicorn.run("main:app", host=host, port=port, reload=True)
