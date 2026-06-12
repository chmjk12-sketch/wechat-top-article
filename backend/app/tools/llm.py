import httpx
import json
from typing import Optional
from app.config import settings, get_db_config


class LLMCaller:
    """统一的 LLM 调用接口 - 支持 OpenAI / Anthropic / DeepSeek（动态读配置）"""

    def _get_api_key(self, model: str) -> str:
        """根据模型类型动态获取 API Key"""
        db_config = get_db_config()
        if model.startswith("gpt") or model.startswith("o1") or model.startswith("o3"):
            return db_config.get("OPENAI_API_KEY") or settings.OPENAI_API_KEY or ""
        elif model.startswith("claude"):
            return db_config.get("ANTHROPIC_API_KEY") or settings.ANTHROPIC_API_KEY or ""
        elif model.startswith("deepseek"):
            return db_config.get("DEEPSEEK_API_KEY") or settings.DEEPSEEK_API_KEY or ""
        return ""

    async def call(
        self,
        prompt: str,
        system: str = "",
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 8000,
    ) -> str:
        model = model or settings.DEFAULT_LLM_MODEL

        if model.startswith("gpt") or model.startswith("o1") or model.startswith("o3"):
            return await self._call_openai(prompt, system, model, temperature, max_tokens)
        elif model.startswith("claude"):
            return await self._call_anthropic(prompt, system, model, temperature, max_tokens)
        elif model.startswith("deepseek"):
            return await self._call_deepseek(prompt, system, model, temperature, max_tokens)
        else:
            raise ValueError(f"Unsupported model: {model}")

    async def _call_openai(self, prompt, system, model, temperature, max_tokens) -> str:
        url = "https://api.openai.com/v1/chat/completions"
        api_key = self._get_api_key("gpt")
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                url,
                headers=headers,
                json={"model": model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens},
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]

    async def _call_anthropic(self, prompt, system, model, temperature, max_tokens) -> str:
        url = "https://api.anthropic.com/v1/messages"
        api_key = self._get_api_key("claude")
        headers = {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }
        body = {
            "model": model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": [{"role": "user", "content": prompt}],
        }
        if system:
            body["system"] = system

        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(url, headers=headers, json=body)
            resp.raise_for_status()
            return resp.json()["content"][0]["text"]

    async def _call_deepseek(self, prompt, system, model, temperature, max_tokens) -> str:
        url = "https://api.deepseek.com/v1/chat/completions"
        api_key = self._get_api_key("deepseek")
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                url,
                headers=headers,
                json={"model": model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens},
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]
