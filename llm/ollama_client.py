"""Ollama格式客户端"""
import json
import httpx
from typing import AsyncGenerator, List, Optional

from .base import BaseLLMClient
from models import ModelConfig, Message


class OllamaClient(BaseLLMClient):
    """Ollama API格式客户端"""

    def __init__(self, config: ModelConfig):
        super().__init__(config)
        self.base_url = config.api_url.rstrip("/")

    async def chat_stream(
        self,
        messages: List[Message],
        system_prompt: Optional[str] = None
    ) -> AsyncGenerator[str, None]:
        """流式对话"""
        api_messages = self.prepare_messages(messages)

        payload = {
            "model": self.config.model_name,
            "messages": api_messages,
            "stream": True
        }

        if system_prompt:
            payload["system"] = system_prompt

        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/api/chat",
                json=payload
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    try:
                        chunk = json.loads(line)
                        if "message" in chunk:
                            content = chunk["message"].get("content", "")
                            if content:
                                yield content
                    except json.JSONDecodeError:
                        continue

    async def chat(
        self,
        messages: List[Message],
        system_prompt: Optional[str] = None
    ) -> str:
        """非流式对话"""
        result = []
        async for chunk in self.chat_stream(messages, system_prompt):
            result.append(chunk)
        return "".join(result)

    async def chat_with_image(
        self,
        messages: List[Message],
        system_prompt: Optional[str] = None,
        image_url: str = None,
        image_base64: str = None
    ) -> AsyncGenerator[str, None]:
        """带图片的对话（用于OCR）"""
        api_messages = self.prepare_messages(messages)

        # Ollama使用images字段添加图片
        images = []
        if image_base64:
            images.append(image_base64)
        elif image_url:
            if image_url.startswith("data:"):
                # Data URI: 提取base64部分
                import base64
                header, data = image_url.split(",", 1)
                images.append(data)
            else:
                # HTTP URL: 需要先获取图片并转为base64
                async with httpx.AsyncClient(timeout=30.0) as client:
                    resp = await client.get(image_url)
                    import base64
                    images.append(base64.b64encode(resp.content).decode())

        if images and api_messages:
            # Ollama的图片格式：在消息中添加images字段
            for msg in api_messages:
                if msg["role"] == "user":
                    msg["images"] = images

        payload = {
            "model": self.config.model_name,
            "messages": api_messages,
            "stream": True
        }

        if system_prompt:
            payload["system"] = system_prompt

        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/api/chat",
                json=payload
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    try:
                        chunk = json.loads(line)
                        if "message" in chunk:
                            content = chunk["message"].get("content", "")
                            if content:
                                yield content
                    except json.JSONDecodeError:
                        continue