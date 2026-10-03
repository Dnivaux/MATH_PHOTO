"""Client de génération en lot vers un serveur compatible OpenAI (vLLM, llama-server)."""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass

from openai import AsyncOpenAI
from tqdm.asyncio import tqdm_asyncio

from common.config import VLLM_BASE_URL


@dataclass
class Generation:
    texts: list[str]
    latency_s: float
    completion_tokens: int
    prompt_tokens: int


async def _one(client, sem, model, messages, n, temperature, max_tokens, extra_body):
    async with sem:
        t0 = time.perf_counter()
        r = await client.chat.completions.create(model=model, messages=messages, n=n, temperature=temperature,
                                                 top_p=0.95 if temperature > 0 else 1.0, max_tokens=max_tokens,
                                                 extra_body=extra_body or None)
        return Generation([c.message.content or "" for c in r.choices], time.perf_counter() - t0,
                          r.usage.completion_tokens if r.usage else 0, r.usage.prompt_tokens if r.usage else 0)


async def _batch(conversations, model, base_url, n, temperature, max_tokens, concurrency, extra_body):
    client = AsyncOpenAI(base_url=base_url, api_key="EMPTY", timeout=600)
    sem = asyncio.Semaphore(concurrency)
    return await tqdm_asyncio.gather(*[_one(client, sem, model, m, n, temperature, max_tokens, extra_body)
                                       for m in conversations], desc=f"génération {model}")


def generate(conversations: list[list[dict]], model: str, *, base_url: str = VLLM_BASE_URL, n: int = 1,
             temperature: float = 0.0, max_tokens: int = 1024, concurrency: int = 64,
             extra_body: dict | None = None) -> list[Generation]:
    return asyncio.run(_batch(conversations, model, base_url, n, temperature, max_tokens, concurrency, extra_body))


def served_model(base_url: str = VLLM_BASE_URL) -> str:
    """Nom du premier modèle servi (pratique quand on ne passe pas --model)."""
    from openai import OpenAI

    return OpenAI(base_url=base_url, api_key="EMPTY").models.list().data[0].id


# Qwen3 : on coupe le mode « thinking » pour les explications (sortie directe, plus courte).
NO_THINK = {"chat_template_kwargs": {"enable_thinking": False}}
