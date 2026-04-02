# LLM 工具箱

一个基于 FastAPI 的多模型 LLM Web 工具平台，支持 OpenAI / Ollama 端点接入，提供对话、OCR 图文识别、ASR 语音转文字等多种工具。

## 功能特性

- **端点管理** — 接入 OpenAI 兼容 API 或本地 Ollama 服务，拉取和管理可用模型
- **工具创建** — 四种工具类型：对话、思考、OCR（图片识别）、ASR（语音识别）
- **流式对话** — 实时流式输出，支持图片输入（OCR）
- **批量处理** — OCR 和 ASR 支持批量文件处理，带进度显示
- **对话管理** — 多会话切换，历史对话持久化
- **深色主题** — 精心设计的暗色界面，中文界面语言

## 快速开始

### 本地运行

```bash
# 安装依赖
pip install -e .

# 启动服务（默认端口 8000）
python main.py
```

浏览器访问 http://localhost:8000

### Docker 运行

```bash
# 构建镜像
docker build -t llm-toolbox .

# 运行容器
docker run -d \
  -p 8000:8000 \
  -v ./data:/app/data \
  llm-toolbox
```

### Docker Compose

```bash
APP_PORT=8000 docker-compose up -d
```

## 环境变量

| 变量         | 说明           | 默认值     |
|-------------|---------------|-----------|
| `APP_HOST`   | 监听地址       | `0.0.0.0` |
| `APP_PORT`   | 监听端口       | `8000`    |
| `APP_RELOAD` | 热重载开关     | `false`   |

## 使用流程

1. **添加端点** — 点击左侧边栏端点区域的 `+` 按钮，填写 API 地址和密钥，测试连接后保存
2. **拉取模型** — 在端点配置弹窗中点击"拉取"按钮，获取可用模型列表，选择并添加
3. **创建工具** — 点击左侧边栏工具区域的 `+` 按钮，选择工具类型、端点和模型，设置系统提示词
4. **开始使用** — 点击左侧工具列表中的工具，进入对应界面：
   - **对话/思考** — 底部输入框发送消息，支持图片上传（OCR 工具需配置支持视觉的模型）
   - **OCR** — 点击"选择图片"批量上传图片，自动调用模型识别文字
   - **ASR** — 点击"选择音频"批量上传音频文件，自动调用语音模型转录文字

## 技术架构

```
├── main.py              # FastAPI 主应用，路由和业务逻辑
├── models.py            # Pydantic 数据模型定义
├── database.py          # SQLite 异步数据库操作
├── llm/
│   ├── base.py          # LLM 客户端基类
│   ├── openai_client.py # OpenAI 兼容 API 客户端
│   └── ollama_client.py # Ollama API 客户端
├── html/
│   ├── templates/
│   │   └── index.html   # 主页面模板
│   └── static/
│       ├── css/
│       │   ├── style.css    # 自定义样式
│       │   └── bootstrap.min.css
│       └── js/
│           ├── app.js         # 前端交互逻辑
│           └── bootstrap.bundle.min.js
├── data/                # 数据目录（SQLite 数据库 + 上传文件）
├── Dockerfile           # Docker 镜像构建
└── docker-compose.yml   # Docker Compose 配置
```

## API 端点

### 端点管理
- `GET /api/endpoints` — 获取端点列表
- `POST /api/endpoints` — 创建端点
- `PUT /api/endpoints/{id}` — 更新端点
- `DELETE /api/endpoints/{id}` — 删除端点
- `POST /api/endpoints/test` — 测试端点连接
- `POST /api/endpoints/{id}/fetch-models` — 拉取可用模型
- `POST /api/endpoints/{id}/models/batch` — 批量添加模型

### 工具管理
- `GET /api/tools` — 获取工具列表
- `POST /api/tools` — 创建工具
- `PUT /api/tools/{id}` — 更新工具
- `DELETE /api/tools/{id}` — 删除工具

### 对话
- `GET /api/conversations` — 获取对话列表
- `GET /api/conversations/{id}` — 获取对话详情
- `DELETE /api/conversations/{id}` — 删除对话
- `POST /api/chat/stream` — 流式对话（SSE）

### 音频
- `POST /api/audio/upload` — 上传音频文件
- `POST /api/audio/transcribe` — 音频转录
