# AI 小说写作工具

基于 Claude API 的自动网络小说写作工具，吸收了 [webnovel-writer](https://github.com/lingfengQAQ/webnovel-writer) 的优秀设计理念，做成独立可运行的 Web 应用。

## 功能特性

- 📝 **项目管理** - 创建、保存、管理多个小说项目
- 🌍 **世界观设定** - AI辅助生成世界观、力量体系、地理背景
- 👤 **角色管理** - 管理主角、配角、反派，维护角色关系
- 📋 **大纲生成** - 根据设定自动生成全书大纲（卷->章结构）
- ✍️ **正文生成** - 根据大纲逐章生成正文，RAG检索保证设定一致性
- 🎨 **多流派支持** - 预置玄幻、都市、穿越、修仙、系统流等常见流派
- 🔧 **可扩展** - 审查功能可选，默认关闭，可按需开启

## 快速开始

### 1. 安装依赖

```bash
pip install -r requirements.txt
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填入你的 ANTHROPIC_API_KEY
```

### 3. 运行

```bash
python main.py
```

然后打开浏览器访问 `http://localhost:8004`

## 技术架构

- **后端**: Python FastAPI
- **前端**: 原生 JavaScript + Tailwind CSS
- **数据库**: SQLAlchemy + SQLite
- **LLM**: Claude 3.5 Sonnet / Claude 4 Opus
- **RAG**: 嵌入向量检索，解决长文遗忘问题

## 核心理念

基于 webnovel-writer 的 **防幻觉三定律**:
1. **大纲即法律** - 严格遵循大纲，不擅自发挥
2. **设定即物理** - 遵守设定，不允许自相矛盾
3. **发明需识别** - 新实体自动入库管理

## 许可证

MIT
