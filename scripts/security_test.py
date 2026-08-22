#!/usr/bin/env python3
"""검증 계층 공격/결손 입력 단위시험. Codex 2차 리뷰 지적 사항 회귀 방지."""
import importlib.util, sys
spec = importlib.util.spec_from_file_location("v", "scripts/verify.py"); v = importlib.util.module_from_spec(spec); spec.loader.exec_module(v)

def job(status="completed", cls="pay", conf="high", score=0.99, fields=None, av=None, steps=("parse","classify","extract")):
    out = []
    if "parse" in steps: out.append({"model":"step_1_parse","status":"completed","content":[{"text":"{}","additional_values":{}}]})
    if "classify" in steps: out.append({"model":"step_2_classify","status":"completed","content":[{"text":cls,"additional_values":{"document_type":{"_value":cls,"confidence":conf,"confidence_score":score}}}]})
    if "extract" in steps:
        f = fields if fields is not None else {}
        a = av if av is not None else {k: {"_value": val, "confidence": "high"} for k, val in f.items()}
        import json as _j
        out.append({"model":"Information Extract - Extract-1","status":"completed","content":[{"text":_j.dumps(f, ensure_ascii=False),"additional_values":a}]})
    return {"status": status, "output": out}

OK = {"issuer":"국민건강보험공단","amount_krw":73000,"due_date":"2026-08-25","contact_phone":"1577-1000"}
CASES = [
    ("정상 통제본",                      job(fields=OK), "clear"),
    ("기관명 위조(가짜국민연금공단)",         job(fields={**OK,"issuer":"가짜국민연금공단"}), "unknown_issuer"),
    ("기관명 한 글자(공단)",              job(fields={**OK,"issuer":"공단"}), "unknown_issuer"),
    ("기관명 공백",                     job(fields={**OK,"issuer":" "}), "unknown_issuer"),
    ("유사 기관명(포항시민회)",             job(fields={**OK,"issuer":"포항시민회"}), "unknown_issuer"),
    ("javascript URL",              job(fields={**OK,"info_url":"javascript://nhis.or.kr/x"}), "review"),
    ("userinfo 우회 URL",             job(fields={**OK,"info_url":"https://evil.com\\@nhis.or.kr/x"}), "review"),
    ("깨진 URL(IPv6)",               job(fields={**OK,"info_url":"https://[nhis.or.kr"}), "review"),
    ("대표번호 뒤 덧붙임",                job(fields={**OK,"contact_phone":"1577-1000-666"}), "review"),
    ("개인 휴대전화 상담번호",              job(fields={**OK,"contact_phone":"010-4821-7733"}), "mismatch"),
    ("예금주 위조",                    job(fields={**OK,"payee_name":"(주)건보수납대행"}), "mismatch"),
    ("금액 결손",                     job(fields={k:val for k,val in OK.items() if k!="amount_krw"}), "review"),
    ("job 실패 상태",                  job(status="failed", fields=OK), "failed"),
    ("job 대기중인데 output 존재",        job(status="queued", fields=OK), "failed"),
    ("pay인데 Extract 없음",           job(fields=OK, steps=("parse","classify")), "failed"),
    ("Extract가 배열",                job(fields=OK) | {"output":[{"model":"step_2_classify","status":"completed","content":[{"text":"pay","additional_values":{"document_type":{"_value":"pay","confidence":"high"}}}]},{"model":"Information Extract - E","status":"completed","content":[{"text":"[1,2]","additional_values":{}}]}]}, "failed"),
    ("분류 신뢰도 낮음",                 job(cls="info", conf="low", score=0.18, fields=OK), "needs_human"),
    ("광고(의도적 미매핑)",               job(cls="ad", fields=None, steps=("parse","classify")), "no_extract"),
    ("허용목록 밖 필드 포함",              job(fields={**OK,"account_number":"110-555-123456","recipient_name":"이순자"}), "clear"),
]
fail = 0
for name, j, exp in CASES:
    try: r = v.verify(j); got = r["verdict"]
    except Exception as e: got = f"EXCEPTION {type(e).__name__}: {e}"; r = {}
    ok = got == exp
    fail += not ok
    print(f"  {'✓' if ok else '✗'} {name:26s} → {str(got):16s} {'' if ok else '기대 ' + exp}")
    if name == "허용목록 밖 필드 포함" and r.get("fields"):
        leaked = [k for k in ("account_number","recipient_name") if k in r["fields"]]
        print(f"      허용목록: 폐기 {r.get('dropped_fields')} / 유출 {leaked or '없음'}")
        fail += bool(leaked)
print(f"\n  {len(CASES)-fail}/{len(CASES)} 통과")
sys.exit(1 if fail else 0)
