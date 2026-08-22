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

ORG_SUFFIX = re.compile(r"(지사|지역본부|본부|지점|센터|출장소|사무소|행정복지센터|주민센터|과$|팀$|담당관?$)")

def strip_org(name):
    """발급기관에서 지사·부서·팀명을 떼어 최상위 기관명만 남긴다."""
    if not name:
        return ""
    toks = name.split()
    keep = []
    for t in toks:
        if ORG_SUFFIX.search(t) and keep:
            break
        keep.append(t)
    return " ".join(keep) if keep else name

MOBILE = re.compile(r"^01[016789]")

def is_personal_mobile(phone):
    """공공·기업 고지서의 상담 번호가 개인 휴대전화면 이상 신호.
    기관은 대표번호(15xx/16xx/18xx/국번없는 3자리/지역번호)를 쓴다."""
    return bool(MOBILE.match(norm_phone(phone)))

def find_issuer(name):
    if not name:
        return None
    n = re.sub(r"\s", "", strip_org(name))
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

    # 분류 자체를 못 믿으면 사람에게 보낸다 (손글씨·비정형 문서)
    if cls_av.get("confidence") == "low":
        out["verdict"] = "needs_human"
        out["reasons"].append({"rule": "R5",
            "detail": f"문서 종류를 확신하지 못함 (분류 신뢰도 {cls_av.get('confidence_score')})",
            "action": "자녀가 직접 확인"})
        return out

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

    # R4 — 개인 휴대전화 상담번호 (레지스트리 무관)
    phone_raw = fields.get("contact_phone")
    mobile_hit = bool(phone_raw) and is_personal_mobile(phone_raw)
    if mobile_hit:
        out["reasons"].append({"rule": "R4",
            "detail": f"고지서 상담 번호가 개인 휴대전화입니다: {phone_raw}",
            "action": "이 번호로 연락하지 말 것. 기관 공식 대표번호만 사용"})

    # R1 — 발신 정합성
    issuer_name = fields.get("issuer")
    issuer = find_issuer(issuer_name)
    if not issuer:
        out["verdict"] = "mismatch" if mobile_hit else "unknown_issuer"
        if not mobile_hit:
            out["reasons"].append({"rule": "R1", "detail": f"레지스트리에 없는 기관: {issuer_name}", "action": "판단 불가 — 자녀 확인"})
        out["checks"].append({"name": "상담 번호 형식", "value": phone_raw,
                              "ok": (not mobile_hit) if phone_raw else None,
                              "expected": ["기관 대표번호"], "note": None if phone_raw else "번호 없음"})
        real0 = [c for c in out["checks"] if c["ok"] is not None]
        out["checks_total"] = len(real0); out["checks_passed"] = sum(1 for c in real0 if c["ok"])
        return out
    out["issuer_id"] = issuer["issuer_id"]

    phone, url = fields.get("contact_phone"), fields.get("info_url")
    # 필드별 독립 판정. 한 필드가 비었거나 low여도 다른 필드 대조는 계속한다.
    if phone and phone.strip():
        np = norm_phone(phone)
        exact = np in [norm_phone(x) for x in issuer["official_phones"]]
        # 같은 국번 대역이면 부서 직통번호로 인정한다. 기관은 대표번호 하나만 쓰지 않는다.
        prefix = any(np.startswith(norm_phone(x)) for x in issuer.get("phone_prefixes", []) if x)
        ok = exact or prefix
        note = None if exact else ("같은 국번 대역 — 부서 직통번호로 인정" if prefix else None)
        out["checks"].append({"name": "문의전화", "value": phone, "ok": ok, "note": note,
                              "expected": issuer["official_phones"], "conf": conf.get("contact_phone"),
                              "kind": "phone"})
    else:
        out["checks"].append({"name": "문의전화", "value": None, "ok": None, "expected": None,
                              "note": "문서에서 읽지 못함"})
    if url and url.strip():
        h = norm_host(url)
        ok = h in [norm_host(x) for x in issuer["official_hosts"]]
        exp = sorted(set(norm_host(x) for x in issuer["official_hosts"]))
        out["checks"].append({"name": "안내 주소", "value": h, "ok": ok, "expected": exp,
                              "conf": conf.get("info_url"), "kind": "host"})
    else:
        out["checks"].append({"name": "안내 주소", "value": None, "ok": None, "expected": None,
                              "note": "문서에 없음"})
    if phone and phone.strip():
        out["checks"].append({"name": "상담 번호 형식", "value": phone,
                              "ok": not mobile_hit, "expected": ["기관 대표번호"], "kind": "mobile"})

    # R6 — 예금주 정합성. 공공기관 고지서의 가상계좌 예금주는 그 기관이어야 한다.
    # 은행명 대조는 하지 않는다(사기 계좌도 같은 은행에 만들 수 있다). 예금주는 다르다.
    payee = fields.get("payee_name")
    if payee and payee.strip():
        pn = re.sub(r"[\s()\[\]]|주식회사|㈜|\(주\)", "", payee)
        matched = find_issuer(payee)
        same = bool(matched) and matched["issuer_id"] == issuer["issuer_id"]
        if not same:
            same = any(re.sub(r"\s", "", a) in pn for a in issuer["aliases"])
        out["checks"].append({"name": "가상계좌 예금주", "value": payee, "ok": same,
                              "expected": [issuer["display_name"]],
                              "conf": conf.get("payee_name"), "kind": "payee"})
        if not same:
            out["reasons"].append({"rule": "R6",
                "detail": f"가상계좌 예금주가 발급기관과 다릅니다: '{payee}' (발급기관 {issuer['display_name']})",
                "action": "이 계좌로 송금하지 말 것. 기관 공식 대표번호로 사실 확인"})
    out["checks"].append({"name": "계좌 진위", "value": None, "ok": None, "expected": None,
                          "note": "확인하지 않음 — 계좌 명의 조회 권한 없음"})

    real = [c for c in out["checks"] if c["ok"] is not None]
    out["checks_total"] = len(real)
    out["checks_passed"] = sum(1 for c in real if c["ok"])
    failed = [c for c in real if not c["ok"]]

    # 전화번호 단독 불일치는 mismatch로 올리지 않는다 — 기관에는 부서 직통번호가 있다.
    # 확정 신호는 개인 휴대전화(R4)와 도메인 불일치뿐이다.
    hard_fail = [c for c in failed if c.get("conf") != "low" and c.get("kind") in ("mobile", "host", "payee")]
    soft_fail = [c for c in failed if c not in hard_fail]
    if not real:
        out["verdict"] = "not_checkable"
        out["reasons"].append({"rule": "R1", "detail": "대조할 연락처·주소를 읽지 못함", "action": "자녀 확인"})
    elif hard_fail:
        out["verdict"] = "mismatch"
        for c in hard_fail:
            out["reasons"].append({"rule": "R1", "detail": f"{c['name']} 불일치: 문서 '{c['value']}' vs 공식 {c['expected']}",
                                   "action": "공식 번호로만 연락. 문서의 번호·링크 사용 금지"})
    elif soft_fail:
        out["verdict"] = "review"
        for c in soft_fail:
            why = "읽기가 불확실함" if c.get("conf") == "low" else "등록된 공식 번호와 다름(부서 직통일 수 있음)"
            out["reasons"].append({"rule": "R1", "detail": f"{c['name']} {why}: '{c['value']}'",
                                   "action": "자녀 확인 — 기관 공식 대표번호로 사실 확인 권장"})
    elif low_core:
        out["verdict"] = "review"
    else:
        out["verdict"] = "clear"
    out["safe_contact"] = {"phones": issuer["official_phones"], "hosts": issuer["official_hosts"],
                           "source": issuer["source_urls"], "verified_at": issuer["verified_at"]}
    return out

LABEL = {"clear": "확인된 불일치 없음", "review": "확인 필요", "mismatch": "공식 정보와 다른 항목 발견",
         "unknown_issuer": "판단 불가 (등록되지 않은 기관)", "not_checkable": "대조할 연락처를 읽지 못함",
         "no_extract": "추출 대상 아님", "needs_human": "사람이 확인해야 함", "failed": "실패"}

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
            mark = "—" if c.get("ok") is None else ("✓" if c["ok"] else "!")
            note = c.get("note") or (f"공식: {c['expected']}" if c["ok"] is False else "")
            print(f"    {mark} {c['name']}: {c['value'] or ''} {note}")
        if r.get("speech_suppressed"): print("  🔇 숫자 낭독 억제 (R3)")
        for rs in r.get("reasons", []): print(f"    · [{rs['rule']}] {rs['detail']} → {rs['action']}")
