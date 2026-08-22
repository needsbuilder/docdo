#!/usr/bin/env python3
"""정합성 검증 계층. Studio 응답 → verdict + 검사 건수 + 근거.
설계서 §6.4. R1(발신 정합성)·R3(신뢰도 게이트)는 우리 코드, R2(문서 내부)는 Studio Validate 노드 담당."""
import json, os, re, sys
from urllib.parse import urlparse

ROOT = os.path.join(os.path.dirname(__file__), "..")
REG = json.load(open(os.path.join(ROOT, "registry", "issuer_registry.json")))

def norm_phone(p):
    return re.sub(r"[^0-9]", "", p or "")

ALLOWED_SCHEME = {"http", "https"}

def norm_host(u):
    """URL에서 host만 뽑는다. 경계 비교용 — 부분 문자열 검사 금지.
    파싱 실패·비허용 scheme·userinfo·제어문자는 전부 빈 값으로 닫는다(fail-closed)."""
    if not u or not str(u).strip():
        return ""
    s = str(u).strip()
    if "\\" in s or any(ord(c) < 32 or ord(c) == 127 for c in s):
        return ""
    if "://" in s:
        if s.split("://", 1)[0].lower() not in ALLOWED_SCHEME:
            return ""
    else:
        s = "http://" + s
    try:
        pr = urlparse(s)
        if pr.username or pr.password:
            return ""
        _ = pr.port                      # 잘못된 포트면 ValueError
        h = (pr.hostname or "").lower()
    except Exception:
        return ""
    if not h or " " in h:
        return ""
    return h[4:] if h.startswith("www.") else h

# alias 뒤에 붙어도 같은 기관으로 인정하는 하위 조직 꼬리
BRANCH_TAIL = re.compile(r"^([가-힣A-Za-z0-9]{0,12}(지사|지역본부|본부|지점|센터|출장소|사무소|과|팀|담당관|반|부))+$")
MIN_ALIAS = 3

MOBILE = re.compile(r"^01[016789]")

def is_personal_mobile(phone):
    """공공·기업 고지서의 상담 번호가 개인 휴대전화면 이상 신호.
    기관은 대표번호(15xx/16xx/18xx/국번없는 3자리/지역번호)를 쓴다."""
    return bool(MOBILE.match(norm_phone(phone)))

def find_issuer(name):
    """기관명 매칭. 정확 일치 우선, 그다음 'alias로 시작 + 나머지가 하위 조직 꼬리'만 인정한다.
    역방향 부분 문자열 매칭은 하지 않는다 — '공단'·'민'이 매칭되고 '가짜국민연금공단'이 통과한다."""
    if not name or not str(name).strip():
        return None
    n = re.sub(r"\s+", "", str(name))
    if len(n) < MIN_ALIAS:
        return None
    best = None
    for it in REG["issuers"]:
        for a in it["aliases"]:
            na = re.sub(r"\s+", "", a)
            if len(na) < MIN_ALIAS:
                continue
            if n == na:
                return it
            if n.startswith(na) and BRANCH_TAIL.match(n[len(na):]):
                if best is None or len(na) > best[1]:
                    best = (it, len(na))
    return best[0] if best else None

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

REQUIRED_FIELDS = {"pay": ["issuer", "amount_krw", "due_date"],
                   "apply": ["issuer", "apply_deadline"],
                   "info": ["issuer"]}

def verify(job):
    # 잡 상태를 먼저 강제한다. stale output으로 통과시키지 않는다.
    if job.get("status") != "completed":
        return {"verdict": "failed", "reason": f"job status={job.get('status')}"}
    for o in job.get("output", []):
        if o.get("status") not in (None, "completed"):
            return {"verdict": "failed", "reason": f"step {o.get('model')} status={o.get('status')}"}
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
        if doc_type in ("pay", "apply", "info"):
            out["verdict"] = "failed"
            out["reason"] = f"'{doc_type}' 문서인데 Extract 단계가 없음 — 파이프라인 오류"
        else:
            out["verdict"] = "no_extract"
            out["note"] = "의도적 미매핑 타입 — 추출 생략. 자녀 목록에는 남는다"
        return out

    raw_fields = st["extract"][0] or {}
    if not isinstance(raw_fields, dict):
        return {"verdict": "failed", "reason": "Extract 출력이 객체가 아님"}
    av = st["extract"][1] or {}
    conf = {k: v.get("confidence") for k, v in av.items() if isinstance(v, dict) and "_value" in v}
    ALLOW = {"issuer", "doc_title", "epn", "amount_krw", "issue_date", "due_date",
             "contact_phone", "info_url", "payee_name",
             "apply_deadline", "required_docs", "where_to_apply", "summary"}
    dropped = sorted(set(raw_fields) - ALLOW)
    fields = {k: v for k, v in raw_fields.items() if k in ALLOW}
    out["fields"] = fields
    if dropped:
        out["dropped_fields"] = dropped   # 허용목록 밖 필드는 보관하지 않는다

    # 필수 필드 결손도 낭독 억제 대상 (R3)
    missing = [k for k in REQUIRED_FIELDS.get(doc_type, []) if not str(fields.get(k) or "").strip()]
    out["field_confidence"] = conf

    # R3 — 신뢰도 게이트: 핵심 필드에 low가 있으면 숫자를 말하지 않는다
    CORE = ["amount_krw", "due_date", "apply_deadline", "issuer"]
    low_core = [k for k in CORE if conf.get(k) == "low"]
    out["speech_suppressed"] = bool(low_core or missing)
    if low_core:
        out["reasons"].append({"rule": "R3", "detail": f"핵심 필드 신뢰도 낮음: {', '.join(low_core)}", "action": "숫자 낭독 억제 + 자녀 확인"})
    if missing:
        out["reasons"].append({"rule": "R3", "detail": f"필수 필드 결손: {', '.join(missing)}", "action": "숫자 낭독 억제 + 자녀 확인"})

    # R4 — 개인 휴대전화 상담번호 (레지스트리 무관)
    phone_raw = fields.get("contact_phone")
    mobile_hit = bool(phone_raw) and is_personal_mobile(phone_raw)
    mobile_strong = mobile_hit and conf.get("contact_phone") == "high"
    if mobile_hit:
        out["reasons"].append({"rule": "R4",
            "detail": f"고지서 상담 번호가 개인 휴대전화입니다: {phone_raw}",
            "action": "이 번호로 연락하지 말 것. 기관 공식 대표번호만 사용"})

    # R1 — 발신 정합성
    issuer_name = fields.get("issuer")
    issuer = find_issuer(issuer_name)
    if not issuer:
        out["verdict"] = "mismatch" if mobile_strong else "unknown_issuer"
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
        if ok and conf.get("contact_phone") != "high":
            ok, note = None, "읽기가 불확실해 대조 결과를 인정하지 않음"
            out["reasons"].append({"rule": "R3", "detail": "문의전화 읽기가 불확실함", "action": "자녀 확인"})
        out["checks"].append({"name": "문의전화", "value": phone, "ok": ok, "note": note,
                              "expected": issuer["official_phones"], "conf": conf.get("contact_phone"),
                              "kind": "phone"})
    else:
        out["checks"].append({"name": "문의전화", "value": None, "ok": None, "expected": None,
                              "note": "문서에서 읽지 못함"})
    if url and url.strip():
        h = norm_host(url)
        if not h:
            out["checks"].append({"name": "안내 주소", "value": str(url)[:60], "ok": None,
                                  "expected": None, "note": "주소 형식을 해석할 수 없음", "kind": "host"})
            out["reasons"].append({"rule": "R1", "detail": f"안내 주소를 해석할 수 없음: {str(url)[:60]}",
                                   "action": "자녀 확인 — 문서의 링크를 열지 말 것"})
            out["url_unparseable"] = True
        else:
            ok = h in [norm_host(x) for x in issuer["official_hosts"]]
            exp = sorted(set(norm_host(x) for x in issuer["official_hosts"]))
            if ok and conf.get("info_url") != "high":
                ok = None
            out["checks"].append({"name": "안내 주소", "value": h, "ok": ok, "expected": exp,
                                  "conf": conf.get("info_url"), "kind": "host"})
    else:
        out["checks"].append({"name": "안내 주소", "value": None, "ok": None, "expected": None,
                              "note": "문서에 없음"})
    if phone and phone.strip():
        out["checks"].append({"name": "상담 번호 형식", "value": phone,
                              "ok": (not mobile_hit) if conf.get("contact_phone") == "high" else None,
                              "note": None if conf.get("contact_phone") == "high" else "읽기가 불확실함",
                              "expected": ["기관 대표번호"], "kind": "mobile"})

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
    elif low_core or missing or out.get("url_unparseable"):
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
