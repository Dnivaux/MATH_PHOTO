"""Faux serveur compatible OpenAI pour la CI et les tests sans GPU (dossier, phase 4 : profil `ci`).

Il retrouve le problème dans les jeux générés et renvoie le code de référence (prompt de code)
ou les étapes rédigées (prompt d'explication). Un oracle : utile pour tester la chaîne, pas le modèle.

    uvicorn serving.llm.fake_llm:app --port 8009
"""

from __future__ import annotations

import time

from fastapi import FastAPI
from pydantic import BaseModel

from common.config import EVAL_SET, TRAIN_POOL, read_jsonl

app = FastAPI()
_BY_STATEMENT: dict[str, dict] = {}


def _index() -> dict[str, dict]:
    if not _BY_STATEMENT:
        for path in (EVAL_SET, TRAIN_POOL):
            if path.exists():
                for p in read_jsonl(path):
                    _BY_STATEMENT[p["statement_en"]] = p
                    _BY_STATEMENT[p["statement_fr"]] = p
    return _BY_STATEMENT


class ChatRequest(BaseModel):
    model: str
    messages: list[dict]
    n: int = 1
    temperature: float | None = None
    max_tokens: int | None = None


def _answer(prompt: str) -> str:
    for statement, p in _index().items():
        if statement in prompt:
            if "<problem>" in prompt:
                return f"```python\n{p['reference_code']}print(result)\n```"
            return "\n".join(s["text_fr"] + (f" ${s['latex']}$" if s.get("latex") else "") for s in p["steps"])
    return "Je ne sais pas."


@app.get("/v1/models")
def models():
    return {"object": "list", "data": [{"id": "fake-oracle", "object": "model", "owned_by": "ci"}]}


@app.post("/v1/chat/completions")
def chat(req: ChatRequest):
    text = _answer(req.messages[-1]["content"])
    return {
        "id": "fake", "object": "chat.completion", "created": int(time.time()), "model": req.model,
        "choices": [{"index": i, "message": {"role": "assistant", "content": text}, "finish_reason": "stop"}
                    for i in range(req.n)],
        "usage": {"prompt_tokens": 100, "completion_tokens": len(text) // 4, "total_tokens": 100 + len(text) // 4},
    }
