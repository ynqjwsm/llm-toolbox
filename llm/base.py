"""LLM客户端基类"""
from abc import ABC, abstractmethod
from typing import AsyncGenerator, List, Optional
from models import ModelConfig, Message


class BaseLLMClient(ABC):
    """LLM客户端抽象基类"""

    def __init__(self, config: ModelConfig):
        self.config = config

    @abstractmethod
    async def chat_stream(
        self,
        messages: List[Message],
        system_prompt: Optional[str] = None
    ) -> AsyncGenerator[str, None]:
        """流式对话

        Args:
            messages: 对话消息列表
            system_prompt: 系统提示词

        Yields:
            流式输出的内容片段
        """
        pass

    @abstractmethod
    async def chat(
        self,
        messages: List[Message],
        system_prompt: Optional[str] = None
    ) -> str:
        """非流式对话

        Args:
            messages: 对话消息列表
            system_prompt: 系统提示词

        Returns:
            完整响应内容
        """
        pass

    def prepare_messages(
        self,
        messages: List[Message],
        system_prompt: Optional[str] = None
    ) -> List[dict]:
        """准备发送给API的消息格式"""
        result = []
        if system_prompt:
            result.append({"role": "system", "content": system_prompt})
        for msg in messages:
            result.append({"role": msg.role, "content": msg.content})
        return result