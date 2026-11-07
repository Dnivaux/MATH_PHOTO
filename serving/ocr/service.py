"""Service OCR du serveur (dossier, « Modèles serveur ») : TexTeller derrière FastAPI.

La gateway l'appelle quand un client escalade avec la photo (lecture incertaine sur le téléphone, LaTeX
invalide). Sur le banc synthétique : TexTeller 71 % d'équivalence contre 8 % pour pix2tex brut (téléphone).
Sur GPU à côté de vLLM (~0,12 à 0,19 s par photo, ~1,7 Go) ; OCR_DEVICE=cpu sinon (~0,7 s avec 4 threads).

    uvicorn serving.ocr.service:app --port 8300        (venv .venv-ocr : TexTeller impose transformers 4.x)
"""

from __future__ import annotations

import base64
import binascii
import io
import os
import tempfile
import threading
import time

from fastapi import FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from serving.ocr.text import canonicalize

MAX_IMAGE_BYTES = 8 * 2**20
DEVICE = os.getenv("OCR_DEVICE", "cpu")

app = FastAPI(title="Photo → Maths OCR (TexTeller)")
_model = None
_lock = threading.Lock()  # un seul passage à la fois : le modèle n'est pas réentrant


class OcrRequest(BaseModel):
    image_base64: str = Field(description="JPEG ou PNG en base64, déjà recadré sur la formule")


class OcrResponse(BaseModel):
    latex: str
    model: str = "texteller"
    ms: float


def _load():
    global _model
    if _model is None:
        import torch
        from texteller import load_model, load_tokenizer

        torch.set_num_threads(int(os.getenv("OCR_THREADS", "4")))
        _model = (load_model().to(torch.device(DEVICE)), load_tokenizer())
    return _model


def _predict(img_bytes: bytes) -> str:
    import torch
    from PIL import Image
    from texteller import img2latex

    model, tok = _load()
    img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    with _lock, tempfile.NamedTemporaryFile(suffix=".png") as f:
        img.save(f.name)
        out = img2latex(model, tok, [f.name], device=torch.device(DEVICE))
    return canonicalize(out[0] if isinstance(out, list) else out)


@app.on_event("startup")
def _warmup() -> None:
    if os.getenv("OCR_PRELOAD", "1") == "1":
        _load()
        # première lecture : initialisation de CUDA (~5 s) faite ici, pas sur la première photo d'un utilisateur
        from PIL import Image, ImageDraw

        img = Image.new("RGB", (256, 64), "white")
        ImageDraw.Draw(img).text((10, 20), "x+1=2", fill="black")
        buf = io.BytesIO()
        img.save(buf, "PNG")
        _predict(buf.getvalue())


@app.get("/health")
def health():
    if _model is None:  # 503 tant que le modèle charge : le healthcheck de docker compose attend
        return JSONResponse({"status": "loading"}, status_code=503)
    return {"status": "ok"}


@app.post("/ocr", response_model=OcrResponse)
async def ocr(req: OcrRequest):
    try:
        raw = base64.b64decode(req.image_base64, validate=True)
    except (binascii.Error, ValueError) as e:
        raise HTTPException(422, "image_base64 invalide") from e
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "image trop grande (8 Mo maximum)")
    t = time.perf_counter()
    try:
        latex = await run_in_threadpool(_predict, raw)
    except Exception as e:  # noqa: BLE001  (image illisible)
        raise HTTPException(422, f"image illisible : {type(e).__name__}") from e
    return OcrResponse(latex=latex, ms=(time.perf_counter() - t) * 1e3)
