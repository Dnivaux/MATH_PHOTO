"""Agrégation des mesures exportées par l'app (format de clients/mobile/src/storage/db.ts : {at, type, data})."""

from eval.device_bench import metrics


def test_metrics_from_app_export():
    ev = [{"at": i, "type": "ocr", "data": {"ms": 900 + i, "inferenceMs": 700 + i, "confidence": 0.95}} for i in range(4)]
    ev += [{"at": 9, "type": "explain", "data": {"via": "device", "ms": 6000, "loadMs": 1500, "promptMs": 400,
                                                  "tokens": 160, "tokensPerSecond": 22.5}}]
    ev += [{"at": 10, "type": "solve", "data": {"route": "local", "ms": 30}},
           {"at": 11, "type": "solve", "data": {"route": "server", "reason": "out_of_local_scope"}},
           {"at": 11, "type": "escalation", "data": {"reason": "out_of_local_scope"}}]
    m = metrics({"app": "1.0.0", "ram": 7.6, "events": ev})
    assert m["ocr_inference_ms_p50"] == 702 and m["ocr_inference_ms_n"] == 4
    assert m["explain_tok_s_p50"] == 22.5 and m["model_load_ms"] == 1500
    assert m["escalation_rate"] == 50 and m["escalation.out_of_local_scope"] == 1
