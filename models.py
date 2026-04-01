"""Pydantic数据模型定义"""
from typing import Optional, List, Literal
from datetime import datetime
from pydantic import BaseModel, Field
from enum import Enum


class EndpointType(str, Enum):
    """端点类型"""
    OLLAMA = "ollama"
    OPENAI = "openai"


class ToolType(str, Enum):
    """工具类型"""
    CHAT = "chat"
    THINKING = "thinking"
    OCR = "ocr"
    ASR = "asr"


# ========== 端点模型 ==========

class EndpointConfig(BaseModel):
    """端点配置"""
    id: Optional[int] = None
    name: str = Field(..., description="端点名称")
    endpoint_type: EndpointType = Field(..., description="端点类型：ollama或openai")
    api_url: str = Field(..., description="API地址")
    api_key: Optional[str] = Field(None, description="API密钥（可选）")
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class EndpointBrief(BaseModel):
    """端点简要信息（不含敏感信息）"""
    id: int
    name: str
    endpoint_type: EndpointType
    api_url: str
    model_count: int = 0


# ========== 模型配置 ==========

class ModelConfig(BaseModel):
    """模型配置"""
    id: Optional[int] = None
    endpoint_id: int = Field(..., description="关联的端点ID")
    model_name: str = Field(..., description="实际模型名称")
    display_name: Optional[str] = Field(None, description="显示名称（用户自定义）")
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ModelBrief(BaseModel):
    """模型简要信息（包含端点信息）"""
    id: int
    endpoint_id: int
    endpoint_name: str
    endpoint_type: EndpointType
    model_name: str
    display_name: Optional[str]


# ========== 工具配置 ==========

class ToolConfig(BaseModel):
    """工具配置"""
    id: Optional[int] = None
    name: str = Field(..., description="工具名称")
    tool_type: ToolType = Field(..., description="工具类型")
    model_id: int = Field(..., description="关联的模型ID")
    system_prompt: Optional[str] = Field("", description="系统提示词")
    description: Optional[str] = Field("", description="工具描述")
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


# ========== 对话模型 ==========

class Message(BaseModel):
    """对话消息"""
    role: Literal["user", "assistant", "system"]
    content: str
    created_at: Optional[datetime] = None


class Conversation(BaseModel):
    """对话记录"""
    id: Optional[int] = None
    tool_id: int = Field(..., description="使用的工具ID")
    title: Optional[str] = Field(None, description="对话标题")
    messages: List[Message] = []
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


# ========== API请求模型 ==========

class ChatRequest(BaseModel):
    """对话请求"""
    tool_id: int = Field(..., description="工具ID")
    conversation_id: Optional[int] = Field(None, description="对话ID，新对话为空")
    message: str = Field(..., description="用户消息")
    image_url: Optional[str] = Field(None, description="图片URL（用于OCR）")
    audio_url: Optional[str] = Field(None, description="音频URL（用于ASR）")


class ChatStreamChunk(BaseModel):
    """流式响应块"""
    content: str
    done: bool = False


class FetchModelsRequest(BaseModel):
    """拉取远程模型请求"""
    endpoint_id: int = Field(..., description="端点ID")


class AddModelRequest(BaseModel):
    """添加模型请求"""
    endpoint_id: int = Field(..., description="端点ID")
    model_name: str = Field(..., description="模型名称")
    display_name: Optional[str] = Field(None, description="显示名称")


class RemoteModel(BaseModel):
    """远程模型信息"""
    id: str
    name: str