"""Phase 1 — un test minimal par outil sur la RTX 5090 ; résultats et versions tracés dans MLflow (run env-check).

    .venv/bin/python infra/setup/check_gpu.py            # tous les tests
    .venv/bin/python infra/setup/check_gpu.py --skip vllm
"""

from __future__ import annotations

import argparse
import subprocess
import time
import traceback


def check_torch() -> dict:
    import torch

    assert torch.cuda.is_available(), "CUDA indisponible pour PyTorch"
    cap = torch.cuda.get_device_capability(0)
    archs = torch.cuda.get_arch_list()
    assert f"sm_{cap[0]}{cap[1]}" in archs, f"PyTorch compilé sans sm_{cap[0]}{cap[1]} : {archs}"
    a = torch.randn(8192, 8192, device="cuda", dtype=torch.bfloat16)
    torch.cuda.synchronize()
    t = time.perf_counter()
    for _ in range(20):
        a @ a
    torch.cuda.synchronize()
    tflops = 20 * 2 * 8192**3 / (time.perf_counter() - t) / 1e12
    q = torch.randn(1, 8, 1024, 64, device="cuda", dtype=torch.bfloat16)
    torch.nn.functional.scaled_dot_product_attention(q, q, q, is_causal=True)
    return {"torch": torch.__version__, "cuda": torch.version.cuda, "gpu": torch.cuda.get_device_name(0),
            "capability": f"{cap[0]}.{cap[1]}", "bf16_matmul_tflops": round(tflops, 1)}


def check_bnb() -> dict:
    import bitsandbytes as bnb
    import torch

    lin = bnb.nn.Linear4bit(1024, 1024, compute_dtype=torch.bfloat16, quant_type="nf4").cuda()
    y = lin(torch.randn(4, 1024, device="cuda", dtype=torch.bfloat16))
    assert y.shape == (4, 1024) and torch.isfinite(y).all()
    opt = bnb.optim.PagedAdamW8bit(torch.nn.Linear(64, 64).cuda().parameters())
    return {"bitsandbytes": bnb.__version__, "nf4_forward": "ok", "paged_adamw_8bit": type(opt).__name__}


def check_vllm(model: str) -> dict:
    from vllm import LLM, SamplingParams
    import vllm

    t = time.perf_counter()
    llm = LLM(model=model, gpu_memory_utilization=0.35, max_model_len=2048)
    load_s = time.perf_counter() - t
    t = time.perf_counter()
    out = llm.generate(["Compute 17 * 23. Answer:"] * 64, SamplingParams(max_tokens=64, temperature=0))
    gen_s = time.perf_counter() - t
    toks = sum(len(o.outputs[0].token_ids) for o in out)
    return {"vllm": vllm.__version__, "vllm_model": model, "vllm_load_s": round(load_s, 1),
            "vllm_tok_s": round(toks / gen_s), "vllm_sample": out[0].outputs[0].text.strip()[:60]}


def check_llamacpp() -> dict:
    p = subprocess.run(["third_party/llama.cpp/build/bin/llama-bench", "-m", "models/gguf/test-qwen2.5-0.5b-q4_k_m.gguf",
                        "-ngl", "99", "-p", "256", "-n", "64", "-o", "json"], capture_output=True, text=True, timeout=300)
    assert p.returncode == 0, p.stderr[-500:]
    import json

    rows = json.loads(p.stdout)
    return {"llamacpp_backend": rows[0].get("backends", ""), **{f"llamacpp_{'pp' if r['n_prompt'] else 'tg'}_tok_s": round(r["avg_ts"]) for r in rows}}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip", default="", help="liste séparée par des virgules : torch,bnb,vllm,llamacpp")
    ap.add_argument("--vllm-model", default="Qwen/Qwen2.5-0.5B-Instruct")
    ap.add_argument("--no-mlflow", action="store_true")
    args = ap.parse_args()
    skip = set(args.skip.split(","))
    checks = {"torch": check_torch, "bnb": check_bnb, "vllm": lambda: check_vllm(args.vllm_model), "llamacpp": check_llamacpp}
    results, status = {}, {}
    for name, fn in checks.items():
        if name in skip:
            continue
        try:
            results.update(fn())
            status[name] = "OK"
        except Exception as e:  # noqa: BLE001
            status[name] = f"ÉCHEC : {type(e).__name__}: {e}"
            traceback.print_exc()
        print(f"[{name}] {status[name]}")
    print(results)
    if not args.no_mlflow:
        import mlflow

        from common import tracking

        tracking.init()
        with mlflow.start_run(run_name="env-check"):
            mlflow.set_tags({"stage": "env", **{f"check.{k}": v[:250] for k, v in status.items()}})
            mlflow.log_params({k: v for k, v in results.items() if isinstance(v, str)})
            mlflow.log_metrics({k: v for k, v in results.items() if isinstance(v, (int, float))})
    if any(v != "OK" for v in status.values()):
        raise SystemExit("au moins un outil bloque sur la 5090 : voir ci-dessus")


if __name__ == "__main__":
    main()
