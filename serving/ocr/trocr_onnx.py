"""Lecteur pix2text-mfr (TrOCR : encodeur DeiT 384x384 + décodeur) sur ONNX Runtime, sans transformers.

C'est la référence de l'OCR du téléphone : clients/mobile/src/engine/ocrSource.ts fait exactement les mêmes
opérations en JavaScript (niveaux de gris recopiés sur 3 canaux, redimensionnement bicubique type Pillow,
normalisation 0,5 / 0,5, décodage glouton sans cache, détokenisation ByteLevel). Le banc OCR l'utilise pour
mesurer les fichiers réellement embarqués (FP32, FP16, INT8).

Dossier attendu (produit par clients/mobile/scripts/p2t_mfr/export.py) : config.json, vocab.json et les graphes.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image


@lru_cache(maxsize=1)
def _byte_decoder() -> dict[str, int]:
    """Table inverse de bytes_to_unicode (GPT-2) : chaque octet est écrit comme un caractère imprimable."""
    bs = list(range(ord("!"), ord("~") + 1)) + list(range(ord("¡"), ord("¬") + 1)) + list(range(ord("®"), ord("ÿ") + 1))
    cs, n = bs[:], 0
    for b in range(256):
        if b not in bs:
            bs.append(b)
            cs.append(256 + n)
            n += 1
    return {chr(c): b for b, c in zip(bs, cs)}


def detokenize(tokens: list[str]) -> str:
    """Jetons ByteLevel -> texte, comme tokenizer.decode(skip_special_tokens=True) de pix2text-mfr."""
    table = _byte_decoder()
    data = bytes(table[ch] for tok in tokens if not (tok.startswith("<") and tok.endswith(">")) for ch in tok)
    return data.decode("utf-8", errors="replace").strip()


def preprocess(img: Image.Image, size: int, mean: float, std: float) -> np.ndarray:
    gray = img.convert("L").resize((size, size), Image.BICUBIC)
    x = (np.asarray(gray, dtype=np.float32) / 255.0 - mean) / std
    return np.repeat(x[None, None], 3, axis=1)  # [1, 3, H, W]


class TrOCROnnx:
    def __init__(self, folder: str | Path, variant: str = "int8", threads: int = 4):
        import onnxruntime as ort

        self.dir = Path(folder)
        self.cfg = json.loads((self.dir / "config.json").read_text())
        self.vocab: list[str] = json.loads((self.dir / "vocab.json").read_text())
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = threads
        files = self.cfg["variants"][variant]
        self.enc = ort.InferenceSession(str(self.dir / files["encoder"]), opts, providers=["CPUExecutionProvider"])
        self.dec = ort.InferenceSession(str(self.dir / files["decoder"]), opts, providers=["CPUExecutionProvider"])

    def __call__(self, img: Image.Image) -> str:
        return self.read(img)[0]

    def read(self, img: Image.Image) -> tuple[str, float]:
        """(LaTeX, confiance = moyenne géométrique des probabilités des jetons choisis)"""
        c = self.cfg
        x = preprocess(img, c["size"], c["mean"], c["std"])
        memory = self.enc.run(None, {"pixel_values": x})[0]
        ids, logp, steps = [c["start"]], 0.0, 0
        for _ in range(c["max_tokens"]):
            steps += 1
            logits = self.dec.run(None, {"input_ids": np.array([ids], dtype=np.int64), "encoder_hidden_states": memory})[0]
            last = logits[0, -1].astype(np.float64)
            best = int(last.argmax())
            logp += float(last[best] - last.max() - np.log(np.exp(last - last.max()).sum()))
            if best == c["eos"]:
                break
            ids.append(best)
        return detokenize([self.vocab[i] for i in ids[1:]]), float(np.exp(logp / steps))
