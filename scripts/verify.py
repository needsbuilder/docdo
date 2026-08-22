#!/usr/bin/env python3
"""정합성 검증 계층. Studio 응답 → verdict + 검사 건수 + 근거.
설계서 §6.4. R1(발신 정합성)·R3(신뢰도 게이트)는 우리 코드, R2(문서 내부)는 Studio Validate 노드 담당."""
import json, os, re, sys
from urllib.parse import urlparse

ROOT = os.path.join(os.path.dirname(__file__), "..")
REG = json.load(open(os.path.join(ROOT, "registry", "issuer_registry.json")))

def norm_phone(p):
    return re.sub(r"[^0-9]", "", p or "")

def norm_host(u):
    """URL 문자열에서 host만 뽑는다. 경계 비교용 — 부분 문자열 검사 금지."""
    if not u:
        return ""
    s = u.strip()
    if "://" not in s:
        s = "http://" + s
    h = (urlparse(s).hostname or "").lower()
    return h[4:] if h.startswith("www.") else h

def find_issuer(name):
    if not name:
        return None
    n = re.sub(r"\s", "", name)
    for it in REG["issuers"]:
        for a in it["aliases"]:
            if re.sub(r"\s", "", a) in n or n in re.sub(r"\s", "", a):
                return it
    return None

def pick_steps(job):
    """output[].model로 단계를 찾는다. 배열 순번 금지 — 분기로 단계가 생략될 수 있다."""
    steps = {}
    for o in job.get("output", []):
        m = (o.get("model") or "").lower()
        c = (o.get("content") or [{}])[0]
        av = c.get("additional_values")
        if isinstance(av, str):
            try: av = json.loads(av)
            except Exception: av = {}
        txt = c.get("text")
        try: val = json.loads(txt) if txt and txt.strip().startswith("{") else txt
        except Exception: val = txt
        if "parse" in m: steps["parse"] = (val, av or {})
        elif "classify" in m: steps["classify"] = (val, av or {})
        elif "extract" in m: steps["extract"] = (val, av or {})
        elif "instruct" in m: steps["instruct"] = (val, av or {})
        elif "validate" in m: steps["validate"] = (val, av or {})
    return steps

def verify(job):
    st = pick_steps(job)
    if "classify" not in st:
        return {"verdict": "failed", "reason": "classify 단계 없음"}
    doc_type = st["classify"][0]
    cls_av = st["classify"][1].get("document_type", {})
    out = {"action_type": doc_type,
           "classify_confidence": cls_av.get("confidence"),
           "classify_score": cls_av.get("confidence_score"),
           "checks": [], "reasons": []}

    if "extract" not in st:
        out["verdict"] = "no_extract"
        out["note"] = "미매핑 타입 — Extract 단계가 실행되지 않음 (정상)"
        return out

    fields = st["extract"][0] or {}
    av = st["extract"][1] or {}
    conf = {k: v.get("confidence") for k, v in av.items() if isinstance(v, dict) and "_value" in v}
    out["fields"] = fields
    out["field_confidence"] = conf

    # R3 — 신뢰도 게이트: 핵심 필드에 low가 있으면 숫자를 말하지 않는다
    CORE = ["amount_krw", "due_date", "apply_deadline", "issuer"]
    low_core = [k for k in CORE if conf.get(k) == "low"]
    out["speech_suppressed"] = bool(low_core)
    if low_core:
        out["reasons"].append({"rule": "R3", "detail": f"핵심 필드 신뢰도 낮음: {', '.join(low_core)}", "action": "숫자 낭독 억제 + 자녀 확인"})

    # R1 — 발신 정합성
    issuer_name = fields.get("issuer")
    issuer = find_issuer(issuer_name)
    if not issuer:
        out["verdict"] = "unknown_issuer"
        out["reasons"].append({"rule": "R1", "detail": f"레지스트리에 없는 기관: {issuer_name}", "action": "판단 불가 — 자녀 확인"})
        out["checks_total"] = 0; out["checks_passed"] = 0
        return out
    out["issuer_id"] = issuer["issuer_id"]

    phone, url = fields.get("contact_phone"), fields.get("info_url")
    # 비교 대상이 low면 R1을 실행하지 않는다 (OCR 오독을 공식 불일치로 오판 방지)
    if conf.get("contact_phone") == "low" or conf.get("info_url") == "low":
        out["verdict"] = "review"
        out["reasons"].append({"rule": "R1", "detail": "대조 대상 필드의 신뢰도가 낮아 대조를 보류", "action": "자녀 확인"})
        out["checks_total"] = 0; out["checks_passed"] = 0
        return out

    if phone:
        ok = norm_phone(phone) in [norm_phone(p) for p in issuer["official_phones"]]
        out["checks"].append({"name": "문의전화", "value": phone, "ok": ok,
                              "expected": issuer["official_phones"]})
    if url:
        h = norm_host(url)
        ok = h in [norm_host(x) for x in issuer["official_hosts"]]
        exp = sorted(set(norm_host(x) for x in issuer["official_hosts"]))
        out["checks"].append({"name": "안내 주소", "value": h, "ok": ok, "expected": exp})
    out["checks"].append({"name": "계좌 진위", "value": None, "ok": None, "expected": None,
                          "note": "확인하지 않음 — 계좌 명의 조회 권한 없음"})

    real = [c for c in out["checks"] if c["ok"] is not None]
    out["checks_total"] = len(real)
    out["checks_passed"] = sum(1 for c in real if c["ok"])
    failed = [c for c in real if not c["ok"]]

    if not real:
        out["verdict"] = "not_checkable"
        out["reasons"].append({"rule": "R1", "detail": "대조할 연락처·주소를 읽지 못함", "action": "자녀 확인"})
    elif failed:
        out["verdict"] = "mismatch"
        for c in failed:
            out["reasons"].append({"rule": "R1", "detail": f"{c['name']} 불일치: 문서 '{c['value']}' vs 공식 {c['expected']}",
                                   "action": "공식 번호로만 연락. 문서의 번호·링크 사용 금지"})
    elif low_core:
        out["verdict"] = "review"
    else:
        out["verdict"] = "clear"
    out["safe_contact"] = {"phones": issuer["official_phones"], "hosts": issuer["official_hosts"],
                           "source": issuer["source_urls"], "verified_at": issuer["verified_at"]}
    return out

LABEL = {"clear": "확인된 불일치 없음", "review": "확인 필요", "mismatch": "공식 정보와 다른 항목 발견",
         "unknown_issuer": "판단 불가 (등록되지 않은 기관)", "not_checkable": "대조할 연락처를 읽지 못함",
         "no_extract": "추출 대상 아님", "failed": "실패"}

if __name__ == "__main__":
    for p in sys.argv[1:]:
        job = json.load(open(p))
        r = verify(job)
        name = os.path.basename(p).replace("agent-raw-", "").replace(".json", "")
        print(f"\n{'='*60}\n{name}  →  [{r['verdict']}] {LABEL.get(r['verdict'], '')}")
        print(f"  분류: {r.get('action_type')} ({r.get('classify_confidence')}, {r.get('classify_score')})")
        if "checks_total" in r:
            print(f"  공식 정보 대조 (검사 {r['checks_total']}건 중 {r.get('checks_passed', 0)}건 일치)")
        for c in r.get("checks", []):
            mark = "—" if c["ok"] is None else ("✓" if c["ok"] else "!")
            note = c.get("note") or (f"공식: {c['expected']}" if c["ok"] is False else "")
            print(f"    {mark} {c['name']}: {c['value'] or ''} {note}")
        if r.get("speech_suppressed"): print("  🔇 숫자 낭독 억제 (R3)")
        for rs in r.get("reasons", []): print(f"    · [{rs['rule']}] {rs['detail']} → {rs['action']}")
