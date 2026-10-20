"""
Export ONNX de pix2tex (LaTeX-OCR, licence MIT) pour l'OCR embarqué de l'app téléphone.

Dossier projet, « Modèles embarqués » : OCR image -> LaTeX, modèle de départ pix2tex (~25 M paramètres),
format final ONNX encodeur + décodeur, quantization INT8. Ce script produit la version de départ (non
distillée) ; le modèle distillé de la phase 3A remplacera ces fichiers sans changer l'app (même format).

Fichiers produits dans onnx/ :
  encoder.onnx   image [1,1,H,W] (H, W multiples de 32, <= 192x672) -> mémoire [1,N,256]
  decoder.onnx   tokens [1,T] + mémoire -> logits du dernier token [1,8000]
  resizer.onnx   image [1,1,H,W] -> logits de largeur [1,21] (largeur conseillée = (argmax+1)*32)
  *.int8.onnx    mêmes graphes, MatMul quantifiés en INT8 (quantization dynamique)
  vocab.json     id -> token (décodage côté app)
  config.json    constantes de prétraitement et de décodage, tailles et SHA-256

    uv run export_onnx.py            # export + validation sur des formules rendues
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import time
import urllib.request
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
import yaml
from munch import Munch
from PIL import Image

HERE = Path(__file__).resolve().parent
OUT = HERE / "onnx"
WEIGHTS = HERE / "weights"
RELEASE = "https://github.com/lukas-blecher/LaTeX-OCR/releases/download/v0.0.1/"
MEAN, STD = 0.7931, 0.1738

FORMULAS = [
    r"3x-7=11",
    r"2x^{2}-3x-5=0",
    r"\frac{2}{3}+\frac{5}{6}",
    r"\int x e^{x}\,dx",
    r"\lim_{x\to 0}\frac{\sin x}{x}",
    r"\sqrt{18}+\left(\frac{2}{3}\right)^{2}",
    r"f(x)=\frac{\sin(x)}{x}",
    r"x^{2}-5x+6=0",
]


def download() -> None:
    WEIGHTS.mkdir(exist_ok=True)
    for name in ("weights.pth", "image_resizer.pth"):
        p = WEIGHTS / name
        if not p.exists():
            print("téléchargement", name)
            urllib.request.urlretrieve(RELEASE + name, p)


def static_same_padding() -> None:
    """timm calcule le padding « SAME » en entiers Python, figés au traçage (sortie de taille fixe).
    Les images de l'app ont des côtés multiples de 32 : le padding ne dépend alors que du noyau, du pas
    et de la dilatation, (k - 1) * d + 1 - s, et peut être écrit en dur dans le graphe."""
    import torch.nn.functional as F
    from timm.models.layers import padding, pool2d_same, std_conv

    def pad_same(x, k, s, d=(1, 1), value: float = 0):
        ph = max((k[0] - 1) * d[0] + 1 - s[0], 0)
        pw = max((k[1] - 1) * d[1] + 1 - s[1], 0)
        if ph > 0 or pw > 0:
            x = F.pad(x, [pw // 2, pw - pw // 2, ph // 2, ph - ph // 2], value=value)
        return x

    for mod in (padding, pool2d_same, std_conv):
        if hasattr(mod, "pad_same"):
            mod.pad_same = pad_same


def load():
    static_same_padding()
    import pix2tex
    from pix2tex.models import get_model
    from pix2tex.utils import parse_args
    from timm.models.layers import StdConv2dSame
    from timm.models.resnetv2 import ResNetV2
    from transformers import PreTrainedTokenizerFast

    pkg = Path(pix2tex.__file__).parent
    with open(pkg / "model/settings/config.yaml") as f:
        args = parse_args(Munch(yaml.load(f, Loader=yaml.FullLoader)))
    args.update(device="cpu", wandb=False, no_cuda=True)
    model = get_model(args)
    model.load_state_dict(torch.load(WEIGHTS / "weights.pth", map_location="cpu"))
    model.eval()
    resizer = ResNetV2(layers=[2, 3, 3], num_classes=max(args.max_dimensions) // 32, global_pool="avg", in_chans=1,
                       drop_rate=0.05, preact=True, stem_type="same", conv_layer=StdConv2dSame)
    resizer.load_state_dict(torch.load(WEIGHTS / "image_resizer.pth", map_location="cpu"))
    resizer.eval()
    tok = PreTrainedTokenizerFast(tokenizer_file=str(pkg / "model/dataset/tokenizer.json"))
    return args, model, resizer, tok


class EncoderExport(torch.nn.Module):
    """CustomVisionTransformer.forward_features réécrit pour l'export : l'indice de position dépend de la
    taille de l'image (h, w en patchs). L'original calcule ces indices en entiers Python, figés au traçage.
    Indice d'un patch (ligne r, colonne c) : 1 + r * (largeur max en patchs) + c ; 0 pour le jeton cls."""

    def __init__(self, enc):
        super().__init__()
        self.enc = enc
        self.cols_max = enc.width // enc.patch_size

    def forward(self, x):
        e = self.enc
        shape = torch._shape_as_tensor(x)
        h = shape[2] // e.patch_size
        w = shape[3] // e.patch_size
        t = e.patch_embed(x)
        t = torch.cat((e.cls_token.expand(t.shape[0], -1, -1), t), dim=1)
        rows = torch.arange(h).unsqueeze(1) * self.cols_max
        cols = torch.arange(w).unsqueeze(0)
        idx = torch.cat((torch.zeros(1, dtype=torch.long), (rows + cols).reshape(-1) + 1))
        t = t + e.pos_embed[:, idx]
        for blk in e.blocks:
            t = blk(t)
        return e.norm(t)


class DecoderStep(torch.nn.Module):
    """Un pas de décodage sans cache : tokens [1,T] + mémoire -> logits du dernier token."""

    def __init__(self, wrapper):
        super().__init__()
        self.net = wrapper.net

    def forward(self, tokens, memory):
        return self.net(tokens, context=memory)[:, -1, :]


def freeze_std_conv(module: torch.nn.Module) -> None:
    """StdConv2dSame standardise ses poids à chaque appel (batch_norm sur le poids) : dans le graphe, le poids
    de la convolution devient un calcul et la quantization INT8 ne le voit pas. On remplace chaque couche par
    une convolution ordinaire dont le poids est déjà standardisé (même résultat, graphe plus simple)."""
    import torch.nn.functional as F
    from timm.models.layers import StdConv2dSame

    for name, child in list(module.named_children()):
        if isinstance(child, StdConv2dSame):
            w = F.batch_norm(child.weight.reshape(1, child.out_channels, -1), None, None, training=True,
                             momentum=0.0, eps=child.eps).reshape_as(child.weight)
            k, s, d = child.kernel_size, child.stride, child.dilation
            ph = max((k[0] - 1) * d[0] + 1 - s[0], 0)
            pw = max((k[1] - 1) * d[1] + 1 - s[1], 0)
            conv = torch.nn.Conv2d(child.in_channels, child.out_channels, k, s, 0, d, child.groups,
                                   bias=child.bias is not None)
            conv.weight.data.copy_(w.detach())
            if child.bias is not None:
                conv.bias.data.copy_(child.bias.data)
            pad = (pw // 2, pw - pw // 2, ph // 2, ph - ph // 2)
            setattr(module, name, torch.nn.Sequential(torch.nn.ZeroPad2d(pad), conv) if any(pad) else conv)
        else:
            freeze_std_conv(child)


def export(args, model, resizer) -> None:
    OUT.mkdir(exist_ok=True)
    freeze_std_conv(model.encoder)
    freeze_std_conv(resizer)
    img = torch.randn(1, 1, 64, 320)
    common = dict(opset_version=17, do_constant_folding=True, dynamo=False)
    torch.onnx.export(EncoderExport(model.encoder), img, OUT / "encoder.onnx", input_names=["image"], output_names=["memory"],
                      dynamic_axes={"image": {2: "h", 3: "w"}, "memory": {1: "n"}}, **common)
    mem = model.encoder(img).detach()
    toks = torch.tensor([[args.bos_token, 5, 9]], dtype=torch.long)
    torch.onnx.export(DecoderStep(model.decoder), (toks, mem), OUT / "decoder.onnx",
                      input_names=["tokens", "memory"], output_names=["logits"],
                      dynamic_axes={"tokens": {1: "t"}, "memory": {1: "n"}}, **common)
    torch.onnx.export(resizer, img, OUT / "resizer.onnx", input_names=["image"], output_names=["logits"],
                      dynamic_axes={"image": {2: "h", 3: "w"}}, **common)

    for name in ("encoder", "decoder", "resizer"):
        weight_only_int8(OUT / f"{name}.onnx", OUT / f"{name}.int8.onnx")


def weight_only_int8(src: Path, dst: Path, min_size: int = 4096) -> None:
    """Quantization INT8 des poids seuls, par canal et symétrique : chaque poids de Conv, MatMul, Gemm ou
    Gather (plongements) est stocké en int8 avec son échelle, et un DequantizeLinear le restitue en float32.
    Le fichier est ~4 fois plus petit ; le calcul reste en float32, avec des opérateurs que tous les
    environnements d'exécution connaissent (onnxruntime-web 1.18 n'a pas ConvInteger, que produit
    quantize_dynamic)."""
    import onnx
    from onnx import helper, numpy_helper

    m = onnx.load(str(src))
    g = m.graph
    inits = {i.name: i for i in g.initializer}
    users: dict[str, int] = {}
    for n in g.node:
        for i in n.input:
            users[i] = users.get(i, 0) + 1
    # entrée « poids » et axe des canaux pour chaque type d'opérateur
    slots = {"Conv": (1, 0), "MatMul": (1, 1), "Gemm": (1, None), "Gather": (0, 0)}
    new_nodes, done = [], set()
    for n in g.node:
        if n.op_type not in slots:
            continue
        idx, axis = slots[n.op_type]
        if len(n.input) <= idx or n.input[idx] not in inits or n.input[idx] in done:
            continue
        name = n.input[idx]
        w = numpy_helper.to_array(inits[name]).astype(np.float32)
        if w.size < min_size or w.ndim < 2:
            continue
        if n.op_type == "Gemm":
            trans_b = next((a.i for a in n.attribute if a.name == "transB"), 0)
            axis = 0 if trans_b else 1
        red = tuple(i for i in range(w.ndim) if i != axis)
        scale = np.maximum(np.abs(w).max(axis=red), 1e-12) / 127.0
        shape = [1] * w.ndim
        shape[axis] = -1
        q = np.clip(np.round(w / scale.reshape(shape)), -127, 127).astype(np.int8)
        g.initializer.remove(inits[name])
        g.initializer.extend([
            numpy_helper.from_array(q, name + "_q"),
            numpy_helper.from_array(scale.astype(np.float32), name + "_scale"),
            numpy_helper.from_array(np.zeros_like(scale, dtype=np.int8), name + "_zp"),
        ])
        new_nodes.append(helper.make_node("DequantizeLinear", [name + "_q", name + "_scale", name + "_zp"], [name],
                                          name=name + "_dequant", axis=axis))
        done.add(name)
    for nd in reversed(new_nodes):
        g.node.insert(0, nd)
    if m.opset_import[0].version < 13:
        m.opset_import[0].version = 13
    onnx.checker.check_model(m)
    onnx.save(m, str(dst))


# ---------------------------------------------------------------- prétraitement (miroir de l'app)

def binarize_crop_pad(gray: np.ndarray) -> np.ndarray:
    """pix2tex.utils.pad : normalisation min/max, inversion si fond sombre, rognage, pad au multiple de 32."""
    data = gray.astype(np.float64)
    data = (data - data.min()) / max(1e-6, data.max() - data.min()) * 255
    if data.mean() > 128:
        mask = data < 128
    else:
        mask = data > 128
        data = 255 - data
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        ys, xs = np.array([0, gray.shape[0] - 1]), np.array([0, gray.shape[1] - 1])
    rect = data[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    h, w = rect.shape
    H, W = -(-h // 32) * 32, -(-w // 32) * 32
    out = np.full((H, W), 255.0)
    out[:h, :w] = rect
    return out.astype(np.uint8)


def minmax(gray: np.ndarray, max_wh=(672, 192), min_wh=(32, 32)) -> np.ndarray:
    h, w = gray.shape
    r = max(w / max_wh[0], h / max_wh[1])
    if r > 1:
        gray = np.array(Image.fromarray(gray).resize((int(w // r), int(h // r)), Image.BILINEAR))
        h, w = gray.shape
    if w < min_wh[0] or h < min_wh[1]:
        out = np.full((max(h, min_wh[1]), max(w, min_wh[0])), 255, np.uint8)
        out[:h, :w] = gray
        gray = out
    return gray


def to_tensor(gray: np.ndarray) -> np.ndarray:
    return ((gray.astype(np.float32) / 255 - MEAN) / STD)[None, None]


def prepare(gray: np.ndarray, resizer_run) -> np.ndarray:
    """pix2tex.cli.LatexOCR.__call__ avec le modèle de redimensionnement (10 itérations au plus)."""
    base = minmax(binarize_crop_pad(gray))
    src = Image.fromarray(base)
    r, w, h = 1.0, src.size[0], src.size[1]
    img = base
    for _ in range(10):
        h = int(h * r)
        img = binarize_crop_pad(minmax(np.array(src.resize((w, h), Image.BILINEAR if r > 1 else Image.LANCZOS))))
        w = (int(np.argmax(resizer_run(to_tensor(img)))) + 1) * 32
        if w == img.shape[1]:
            break
        r = w / img.shape[1]
    return img


def decode_tokens(ids, vocab) -> str:
    from pix2tex.utils import post_process

    s = "".join(vocab[i] for i in ids).replace("Ġ", " ")
    for t in ("[EOS]", "[BOS]", "[PAD]"):
        s = s.replace(t, "")
    return post_process(s.strip())


def greedy(enc_run, dec_run, x, args, max_len=256):
    mem = enc_run(x)
    toks = [args.bos_token]
    probs = []
    for _ in range(max_len):
        logits = dec_run(np.array([toks], dtype=np.int64), mem)[0]
        p = np.exp(logits - logits.max())
        p /= p.sum()
        nxt = int(np.argmax(p))
        probs.append(float(p[nxt]))
        if nxt == args.eos_token:
            break
        toks.append(nxt)
    return toks[1:], probs


def render(latex: str) -> np.ndarray:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig = plt.figure(figsize=(0.01, 0.01))
    fig.text(0, 0, f"${latex.replace(chr(92) + 'left', '').replace(chr(92) + 'right', '')}$", fontsize=22)
    buf = io.BytesIO()
    fig.savefig(buf, dpi=110, bbox_inches="tight", pad_inches=0.15, facecolor="white")
    plt.close(fig)
    return np.array(Image.open(buf).convert("L"))


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def validate(args, model, resizer, tok) -> dict:
    vocab = {i: t for t, i in tok.get_vocab().items()}
    vocab_list = [vocab.get(i, "") for i in range(len(vocab))]
    so = ort.SessionOptions()
    so.intra_op_num_threads = 2
    sess = {n: ort.InferenceSession(str(OUT / f"{n}.onnx"), so) for n in
            ("encoder", "decoder", "resizer", "encoder.int8", "decoder.int8", "resizer.int8")}

    def run(name):
        s = sess[name]
        if name.startswith("decoder"):
            return lambda t, m: s.run(None, {"tokens": t, "memory": m})[0]
        return lambda x: s.run(None, {"image": x})[0]

    report = {"samples": []}
    for latex in FORMULAS:
        gray = render(latex)
        x = to_tensor(prepare(gray, run("resizer")))
        xq = to_tensor(prepare(gray, run("resizer.int8")))
        with torch.no_grad():
            mem_t = model.encoder(torch.from_numpy(x))
            toks = [args.bos_token]
            for _ in range(256):
                nxt = int(model.decoder.net(torch.tensor([toks]), context=mem_t)[0, -1].argmax())
                if nxt == args.eos_token:
                    break
                toks.append(nxt)
        ref = decode_tokens(toks[1:], vocab_list)
        row = {"latex": latex, "shape": list(x.shape), "torch": ref}
        for variant in ("", ".int8"):
            t0 = time.time()
            ids, probs = greedy(run("encoder" + variant), run("decoder" + variant), xq if variant else x, args)
            row["onnx" + (variant or ".fp32")] = decode_tokens(ids, vocab_list)
            row["ms" + (variant or ".fp32")] = round((time.time() - t0) * 1000)
            row["conf" + (variant or ".fp32")] = round(float(np.exp(np.mean(np.log(np.maximum(probs, 1e-9))))), 3)
        report["samples"].append(row)
        print(json.dumps(row, ensure_ascii=False))
    return report, vocab_list


def main() -> None:
    download()
    args, model, resizer, tok = load()
    export(args, model, resizer)
    report, vocab_list = validate(args, model, resizer, tok)
    (OUT / "vocab.json").write_text(json.dumps(vocab_list, ensure_ascii=False))
    files = {p.name: {"bytes": p.stat().st_size, "sha256": sha256(p)} for p in sorted(OUT.glob("*.onnx"))}
    config = {
        "name": "pix2tex-base",
        "version": "0.1.4-v0.0.1",
        "license": "MIT",
        "mean": MEAN, "std": STD,
        "max_width": 672, "max_height": 192, "min_width": 32, "min_height": 32, "divable": 32,
        "bos": args.bos_token, "eos": args.eos_token, "pad": args.pad_token, "max_tokens": 256,
        "encoder": "encoder.int8.onnx", "decoder": "decoder.int8.onnx", "resizer": "resizer.int8.onnx",
        "files": files,
    }
    (OUT / "config.json").write_text(json.dumps(config, indent=1))
    (OUT / "validation.json").write_text(json.dumps(report, indent=1, ensure_ascii=False))
    for k, v in files.items():
        print(f"{k:22s} {v['bytes'] / 1e6:6.1f} Mo")


if __name__ == "__main__":
    main()
