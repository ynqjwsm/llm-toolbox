"""OpenAI格式客户端"""
import json
import base64
import httpx
from typing import AsyncGenerator, List, Optional
from pathlib import Path

from .base import BaseLLMClient
from models import ModelConfig, Message


class OpenAIClient(BaseLLMClient):
    """OpenAI API兼容格式客户端"""

    def __init__(self, config: ModelConfig):
        super().__init__(config)
        # 确保API URL正确
        self.base_url = config.api_url.rstrip("/")
        if not self.base_url.endswith("/v1"):
            self.base_url = f"{self.base_url}/v1"

    def _get_headers(self, content_type: str = "application/json") -> dict:
        """获取请求头"""
        headers = {"Content-Type": content_type}
        if self.config.api_key:
            headers["Authorization"] = f"Bearer {self.config.api_key}"
        return headers

    async def chat_stream(
        self,
        messages: List[Message],
        system_prompt: Optional[str] = None
    ) -> AsyncGenerator[str, None]:
        """流式对话"""
        api_messages = self.prepare_messages(messages, system_prompt)
        headers = self._get_headers()

        payload = {
            "model": self.config.model_name,
            "messages": api_messages,
            "stream": True
        }

        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/chat/completions",
                headers=headers,
                json=payload
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        data = line[6:]
                        if data == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data)
                            if chunk.get("choices"):
                                delta = chunk["choices"][0].get("delta", {})
                                content = delta.get("content", "")
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
        image_url: str = None
    ) -> AsyncGenerator[str, None]:
        """带图片的对话（用于OCR）"""
        api_messages = self.prepare_messages(messages, system_prompt)

        # 在最后一条用户消息中添加图片
        if image_url and api_messages:
            last_msg = api_messages[-1]
            if last_msg["role"] == "user":
                last_msg["content"] = [
                    {"type": "text", "text": last_msg["content"]},
                    {"type": "image_url", "image_url": {"url": image_url}}
                ]

        headers = self._get_headers()

        payload = {
            "model": self.config.model_name,
            "messages": api_messages,
            "stream": True
        }

        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/chat/completions",
                headers=headers,
                json=payload
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        data = line[6:]
                        if data == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data)
                            if chunk.get("choices"):
                                delta = chunk["choices"][0].get("delta", {})
                                content = delta.get("content", "")
                                if content:
                                    yield content
                        except json.JSONDecodeError:
                            continue

    # ========== 音频API ==========

    async def audio_transcription(
        self,
        audio_data: bytes,
        filename: str = "audio.mp3",
        language: Optional[str] = None,
        prompt: Optional[str] = None
    ) -> str:
        """音频转录（ASR）

        Args:
            audio_data: 音频文件的二进制数据
            filename: 文件名（用于确定格式）
            language: 语言代码（如zh、en）
            prompt: 提示词（帮助模型理解上下文）

        Returns:
            转录后的文本
        """
        # 使用multipart/form-data格式上传
        files = {
            "file": (filename, audio_data, "application/octet-stream")
        }
        data = {"model": self.config.model_name}

        if language:
            data["language"] = language
        if prompt:
            data["prompt"] = prompt

        headers = {}
        if self.config.api_key:
            headers["Authorization"] = f"Bearer {self.config.api_key}"

        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                f"{self.base_url}/audio/transcriptions",
                headers=headers,
                files=files,
                data=data
            )
            response.raise_for_status()
            result = response.json()
            return result.get("text", "")

    async def audio_transcription_stream(
        self,
        audio_data: bytes,
        filename: str = "audio.mp3",
        language: Optional[str] = None,
        prompt: Optional[str] = None
    ) -> AsyncGenerator[str, None]:
        """流式音频转录（如果API支持）

        部分API支持流式返回转录结果
        """
        # 大多数音频转录API不支持流式，先尝试普通调用
        try:
            text = await self.audio_transcription(audio_data, filename, language, prompt)
            # 模拟流式输出，逐字返回
            for char in text:
                yield char
        except Exception as e:
            raise e

    async def audio_speech(
        self,
        text: str,
        voice: str = "alloy",
        output_format: str = "mp3"
    ) -> bytes:
        """文本转语音（TTS）

        Args:
            text: 要转换的文本
            voice: 语音类型（alloy, echo, fable, onyx, nova, shimmer）
            output_format: 输出格式（mp3, opus, aac, flac）

        Returns:
            音频二进制数据
        """
        headers = self._get_headers()

        payload = {
            "model": self.config.model_name,
            "input": text,
            "voice": voice,
            "response_format": output_format
        }

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{self.base_url}/audio/speech",
                headers=headers,
                json=payload
            )
            response.raise_for_status()
            return response.content