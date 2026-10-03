"""Phase 10 — tableau de synthèse du week-end depuis MLflow (Markdown), aussi enregistré comme artefact.

    python -m eval.report            # affiche le tableau et le logue dans un run « weekend-summary »
"""

from __future__ import annotations

import mlflow

from common import tracking

COLUMNS = {
    "code": ["exec_accuracy", "exec_rate", "autonomous_rate", "pass_at_4", "latency_p50_s", "throughput_tok_s"],
    "explain": ["faithfulness.lycee", "hallucination_rate.lycee", "accept_rate.lycee", "latency_p50_s"],
    "ocr": ["exact_match", "math_equivalence", "token_error_rate", "latency_p50_ms"],
}


def main() -> None:
    tracking.init()
    lines = ["# Synthèse du week-end", ""]
    for task, cols in COLUMNS.items():
        df = mlflow.search_runs(filter_string=f"tags.stage = 'eval' and tags.task = '{task}' and tags.role != 'ci'",
                                order_by=["start_time ASC"])
        if df.empty:
            continue
        lines += [f"## {task}", "", "| run | rôle | modèle | " + " | ".join(cols) + " |",
                  "|---|---|---|" + "---|" * len(cols)]
        for _, r in df.iterrows():
            vals = [r.get(f"metrics.{c}") for c in cols]
            cells = ["" if v is None or v != v else f"{v:.1f}" for v in vals]
            lines.append(f"| {r['tags.mlflow.runName']} | {r.get('tags.role', '')} | {r.get('tags.model', '')} | "
                         + " | ".join(cells) + " |")
        lines.append("")
    gguf = mlflow.search_runs(filter_string="tags.stage = 'quantize'")
    if not gguf.empty:
        lines += ["## GGUF", "", "| run | Mo F16 | Mo Q8_0 | Mo Q4_K_M | tok/s Q4_K_M (CPU 4 threads) |", "|---|---|---|---|---|"]
        for _, r in gguf.iterrows():
            g = lambda k: f"{r.get('metrics.' + k, float('nan')):.0f}"  # noqa: E731
            lines.append(f"| {r['tags.mlflow.runName']} | {g('size_mb.f16')} | {g('size_mb.q8_0')} | {g('size_mb.q4_k_m')} | {g('cpu4t_tg_tok_s.q4_k_m')} |")
    report = "\n".join(lines)
    print(report)
    with mlflow.start_run(run_name="weekend-summary"):
        mlflow.set_tag("stage", "report")
        mlflow.log_text(report, "weekend_summary.md")


if __name__ == "__main__":
    main()
