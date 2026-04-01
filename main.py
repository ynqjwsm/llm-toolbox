"""LLM工具箱Web应用"""
import logging
import shutil
import asyncio
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, HTTPException, UploadFile, File
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
import uvicorn
import httpx

from models import (
    EndpointConfig, ModelConfig, ToolConfig, ChatRequest, Message,
    EndpointType, ToolType, FetchModelsRequest, AddModelRequest
)
from database import (
    init_db,
    get_endpoints, get_endpoint, create_endpoint, update_endpoint, delete_endpoint,
    get_models, get_models_by_endpoint, get_model, get_model_with_endpoint,
    create_model, update_model, delete_model, create_models_batch,
    get_tools, get_tool, create_tool, update_tool, delete_tool,
    get_conversations, get_conversation, create_conversation, add_message, delete_conversation
)
from llm import OpenAIClient, OllamaClient

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 路径配置
BASE_DIR = Path(__file__).parent
HTML_DIR = BASE_DIR / "html"
UPLOAD_DIR = BASE_DIR / "data" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# 支持的音频格式
SUPPORTED_AUDIO_FORMATS = {".mp3", ".wav", ".m4a", ".flac", ".ogg", ".webm", ".aac", ".opus"}
NEEDS_CONVERSION_FORMATS = {".webm", ".m4a", ".ogg", ".opus", ".aac", ".flac"}

# 模板和静态文件
templates = Jinja2Templates(directory=HTML_DIR / "templates")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    await init_db()
    logger.info("数据库初始化完成")
    yield
    logger.info("应用关闭")


app = FastAPI(title="LLM工具箱", lifespan=lifespan)

# 静态文件挂载
app.mount("/static", StaticFiles(directory=HTML_DIR / "static"), name="static")


# ========== 页面路由 ==========

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    """主页面"""
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={"title": "LLM工具箱"}
    )


# ========== 端点 API ==========

@app.get("/api/endpoints")
async def list_endpoints():
    """获取端点列表"""
    return await get_endpoints()


@app.get("/api/endpoints/{id}")
async def get_endpoint_detail(id: int):
    """获取端点详情"""
    endpoint = await get_endpoint(id)
    if not endpoint:
        raise HTTPException(status_code=404, detail="端点不存在")
    return endpoint


@app.post("/api/endpoints")
async def add_endpoint(endpoint: EndpointConfig):
    """创建端点"""
    return await create_endpoint(endpoint)


@app.put("/api/endpoints/{id}")
async def edit_endpoint(id: int, endpoint: EndpointConfig):
    """更新端点"""
    result = await update_endpoint(id, endpoint)
    if not result:
        raise HTTPException(status_code=404, detail="端点不存在")
    return result


@app.delete("/api/endpoints/{id}")
async def remove_endpoint(id: int):
    """删除端点"""
    if not await delete_endpoint(id):
        raise HTTPException(status_code=404, detail="端点不存在")
    return {"message": "删除成功"}


@app.post("/api/endpoints/{id}/fetch-models")
async def fetch_endpoint_models(id: int):
    """从端点拉取可用模型列表"""
    endpoint = await get_endpoint(id)
    if not endpoint:
        raise HTTPException(status_code=404, detail="端点不存在")

    try:
        if endpoint.endpoint_type == EndpointType.OLLAMA:
            # Ollama: /api/tags
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(f"{endpoint.api_url.rstrip('/')}/api/tags")
                response.raise_for_status()
                data = response.json()
                models = [{"id": m["name"], "name": m["name"]} for m in data.get("models", [])]
        else:
            # OpenAI格式: /v1/models
            base_url = endpoint.api_url.rstrip("/")
            if not base_url.endswith("/v1"):
                base_url = f"{base_url}/v1"

            headers = {"Content-Type": "application/json"}
            if endpoint.api_key:
                headers["Authorization"] = f"Bearer {endpoint.api_key}"

            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(f"{base_url}/models", headers=headers)
                response.raise_for_status()
                data = response.json()
                models = [{"id": m["id"], "name": m["id"]} for m in data.get("data", [])]

        return {"models": models, "endpoint_id": id}

    except httpx.HTTPError as e:
        raise HTTPException(status_code=400, detail=f"连接失败: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"获取模型失败: {str(e)}")


@app.post("/api/endpoints/{id}/models")
async def add_models_to_endpoint(id: int, request: AddModelRequest):
    """向端点添加模型"""
    endpoint = await get_endpoint(id)
    if not endpoint:
        raise HTTPException(status_code=404, detail="端点不存在")

    model = ModelConfig(
        endpoint_id=id,
        model_name=request.model_name,
        display_name=request.display_name
    )
    result = await create_model(model)
    if not result:
        raise HTTPException(status_code=400, detail="模型已存在")
    return result


@app.post("/api/endpoints/{id}/models/batch")
async def add_models_batch(id: int, model_names: list[str]):
    """批量添加模型到端点"""
    endpoint = await get_endpoint(id)
    if not endpoint:
        raise HTTPException(status_code=404, detail="端点不存在")

    count = await create_models_batch(id, model_names)
    return {"added": count, "endpoint_id": id}


# ========== 模型 API ==========

@app.get("/api/models")
async def list_models():
    """获取模型列表"""
    return await get_models()


@app.get("/api/models/{id}")
async def get_model_detail(id: int):
    """获取模型详情"""
    model = await get_model(id)
    if not model:
        raise HTTPException(status_code=404, detail="模型不存在")
    return model


@app.put("/api/models/{id}")
async def edit_model(id: int, model: ModelConfig):
    """更新模型"""
    result = await update_model(id, model)
    if not result:
        raise HTTPException(status_code=404, detail="模型不存在")
    return result


@app.delete("/api/models/{id}")
async def remove_model(id: int):
    """删除模型"""
    if not await delete_model(id):
        raise HTTPException(status_code=404, detail="模型不存在")
    return {"message": "删除成功"}


# ========== 工具 API ==========

@app.get("/api/tools")
async def list_tools():
    """获取工具列表"""
    return await get_tools()


@app.get("/api/tools/{id}")
async def get_tool_detail(id: int):
    """获取工具详情"""
    tool = await get_tool(id)
    if not tool:
        raise HTTPException(status_code=404, detail="工具不存在")
    return tool


@app.post("/api/tools")
async def add_tool(tool: ToolConfig):
    """添加工具"""
    model = await get_model(tool.model_id)
    if not model:
        raise HTTPException(status_code=400, detail="关联模型不存在")
    return await create_tool(tool)


@app.put("/api/tools/{id}")
async def edit_tool(id: int, tool: ToolConfig):
    """更新工具"""
    model = await get_model(tool.model_id)
    if not model:
        raise HTTPException(status_code=400, detail="关联模型不存在")
    result = await update_tool(id, tool)
    if not result:
        raise HTTPException(status_code=404, detail="工具不存在")
    return result


@app.delete("/api/tools/{id}")
async def remove_tool(id: int):
    """删除工具"""
    if not await delete_tool(id):
        raise HTTPException(status_code=404, detail="工具不存在")
    return {"message": "删除成功"}


# ========== 对话 API ==========

@app.get("/api/conversations")
async def list_conversations(tool_id: int = None):
    """获取对话列表"""
    return await get_conversations(tool_id)


@app.get("/api/conversations/{id}")
async def get_conversation_detail(id: int):
    """获取对话详情"""
    conv = await get_conversation(id)
    if not conv:
        raise HTTPException(status_code=404, detail="对话不存在")
    return conv


@app.delete("/api/conversations/{id}")
async def remove_conversation(id: int):
    """删除对话"""
    if not await delete_conversation(id):
        raise HTTPException(status_code=404, detail="对话不存在")
    return {"message": "删除成功"}


# ========== LLM客户端 ==========

def get_llm_client(model_info: dict):
    """根据模型信息获取对应的LLM客户端"""
    from models import ModelConfig, EndpointType

    # 构造临时的ModelConfig和EndpointConfig
    class TempConfig:
        def __init__(self, info):
            self.model_name = info["model_name"]
            self.api_url = info["api_url"]
            self.api_key = info.get("api_key")
            self.model_type = EndpointType(info["endpoint_type"])

    if model_info["endpoint_type"] == EndpointType.OLLAMA:
        return OllamaClient(TempConfig(model_info))
    else:
        return OpenAIClient(TempConfig(model_info))


# ========== 流式对话 ==========

import json


async def stream_chat_generator(request: ChatRequest):
    """流式对话生成器"""
    tool = await get_tool(request.tool_id)
    if not tool:
        yield f"data: {json.dumps({'error': '工具不存在'})}\n\n"
        return

    model_info = await get_model_with_endpoint(tool.model_id)
    if not model_info:
        yield f"data: {json.dumps({'error': '模型不存在'})}\n\n"
        return

    if request.conversation_id:
        conversation = await get_conversation(request.conversation_id)
        if not conversation:
            yield f"data: {json.dumps({'error': '对话不存在'})}\n\n"
            return
    else:
        conversation = await create_conversation(request.tool_id)

    user_message = Message(role="user", content=request.message)
    conversation = await add_message(conversation.id, user_message)
    if not conversation:
        yield f"data: {json.dumps({'error': '添加消息失败'})}\n\n"
        return

    messages = conversation.messages
    client = get_llm_client(model_info)
    system_prompt = tool.system_prompt or ""

    try:
        if tool.tool_type == ToolType.OCR and request.image_url:
            full_response = []
            async for chunk in client.chat_with_image(
                messages=messages,
                system_prompt=system_prompt,
                image_url=request.image_url
            ):
                full_response.append(chunk)
                yield f"data: {json.dumps({'content': chunk})}\n\n"
            response_text = "".join(full_response)
        else:
            full_response = []
            async for chunk in client.chat_stream(messages, system_prompt):
                full_response.append(chunk)
                yield f"data: {json.dumps({'content': chunk})}\n\n"
            response_text = "".join(full_response)

        assistant_message = Message(role="assistant", content=response_text)
        await add_message(conversation.id, assistant_message)

        yield f"data: {json.dumps({'done': True, 'conversation_id': conversation.id})}\n\n"

    except Exception as e:
        logger.error(f"对话错误: {e}")
        yield f"data: {json.dumps({'error': str(e)})}\n\n"


# ========== 音频处理 ==========

def check_ffmpeg_available() -> bool:
    """检查ffmpeg是否可用"""
    try:
        result = shutil.which("ffmpeg")
        return result is not None
    except Exception:
        return False


async def convert_audio_to_mp3(input_path: Path, output_path: Path) -> bool:
    """使用ffmpeg将音频转换为mp3格式"""
    if not check_ffmpeg_available():
        logger.warning("ffmpeg不可用，无法转换音频格式")
        return False

    try:
        cmd = [
            "ffmpeg", "-i", str(input_path),
            "-vn", "-acodec", "libmp3lame",
            "-q:a", "2", "-y", str(output_path)
        ]

        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await process.communicate()

        if process.returncode == 0:
            logger.info(f"音频转换成功: {input_path} -> {output_path}")
            return True
        else:
            logger.error(f"音频转换失败: {stderr.decode()}")
            return False
    except Exception as e:
        logger.error(f"音频转换异常: {e}")
        return False


@app.post("/api/audio/upload")
async def upload_audio(file: UploadFile = File(...)):
    """上传音频文件"""
    original_ext = Path(file.filename).suffix.lower() if file.filename else ""

    if original_ext not in SUPPORTED_AUDIO_FORMATS:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的音频格式: {original_ext}。支持: {', '.join(SUPPORTED_AUDIO_FORMATS)}"
        )

    original_path = UPLOAD_DIR / f"audio_{file.filename}"
    with open(original_path, "wb") as f:
        content = await file.read()
        f.write(content)

    if original_ext in NEEDS_CONVERSION_FORMATS:
        if not check_ffmpeg_available():
            logger.warning("ffmpeg不可用，将使用原始音频文件尝试直接提交")
            return {
                "path": str(original_path),
                "filename": file.filename,
                "converted": False,
                "warning": "ffmpeg不可用，部分API可能不支持此格式"
            }

        converted_path = UPLOAD_DIR / f"audio_converted_{Path(file.filename).stem}.mp3"
        success = await convert_audio_to_mp3(original_path, converted_path)

        if success:
            return {
                "path": str(converted_path),
                "filename": f"audio_converted_{Path(file.filename).stem}.mp3",
                "converted": True,
                "original_path": str(original_path)
            }
        else:
            raise HTTPException(status_code=500, detail="音频格式转换失败")

    return {
        "path": str(original_path),
        "filename": file.filename,
        "converted": False
    }


@app.post("/api/audio/transcribe")
async def transcribe_audio(request: ChatRequest):
    """音频转录接口"""
    tool = await get_tool(request.tool_id)
    if not tool:
        raise HTTPException(status_code=404, detail="工具不存在")

    if tool.tool_type != ToolType.ASR:
        raise HTTPException(status_code=400, detail="此工具不是ASR类型")

    model_info = await get_model_with_endpoint(tool.model_id)
    if not model_info:
        raise HTTPException(status_code=404, detail="模型不存在")

    audio_path = request.audio_url
    if not audio_path:
        raise HTTPException(status_code=400, detail="缺少音频文件")

    audio_file_path = Path(audio_path)
    if not audio_file_path.exists():
        raise HTTPException(status_code=404, detail="音频文件不存在")

    with open(audio_file_path, "rb") as f:
        audio_data = f.read()

    client = get_llm_client(model_info)

    try:
        if model_info["endpoint_type"] == EndpointType.OPENAI:
            text = await client.audio_transcription(
                audio_data=audio_data,
                filename=audio_file_path.name,
                prompt=tool.system_prompt
            )
        else:
            raise HTTPException(
                status_code=400,
                detail="Ollama暂不支持音频转录API，请使用OpenAI格式模型"
            )

        if request.conversation_id:
            conversation = await get_conversation(request.conversation_id)
        else:
            conversation = await create_conversation(request.tool_id)

        user_msg = Message(role="user", content=f"[音频文件: {audio_file_path.name}]\n{request.message or ''}")
        await add_message(conversation.id, user_msg)

        assistant_msg = Message(role="assistant", content=text)
        await add_message(conversation.id, assistant_msg)

        return {
            "text": text,
            "conversation_id": conversation.id
        }

    except Exception as e:
        logger.error(f"音频转录失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/chat/stream")
async def chat_stream(request: ChatRequest):
    """流式对话接口"""
    return StreamingResponse(
        stream_chat_generator(request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


# ========== 启动配置 ==========

def main():
    """启动应用"""
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True
    )


if __name__ == "__main__":
    main()