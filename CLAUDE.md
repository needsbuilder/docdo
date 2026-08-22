# DocDo — 항상 참인 규칙

JunctionX Korea 2026 · Upstage Studio 트랙 · 팀 Reporch(37)

> 진행 상태는 여기 없다. `~/projects/_sandbox/현황판.md`의 `junctionx-korea` 항목을 본다.
> 세션 재개 시 `docs/이어받기-2026-08-23.md`부터 읽는다.

## 제품 안전 원칙 (다른 모든 결정보다 우선)

1. **어르신 화면에 금전 거래로 이어지는 경로를 두지 않는다.** 계좌번호·납부 버튼·결제 링크 없음. 어르신에게 주는 것은 이해·안심·위험 경고·검증된 공식 전화번호뿐이다.
2. **확신하지 못한 값은 읽지 않는다.** Extract가 `low`를 준 필드나 결손 필드는 음성으로도 화면으로도 숫자를 말하지 않는다.
3. **지시하지 않는다. 사실만 전달한다.** "내시면 됩니다" ✗ → "문서에 적힌 금액은 …입니다" ✓
4. **확률적 판단으로 폐기를 지시하지 않는다.** "버리셔도 됩니다" ✗ → "버리시기 전에 자녀분께 확인해 주세요" ✓
5. **문서에서 추출한 연락처·링크는 실행 경로가 되지 못한다.** `tel:`과 링크는 `issuer_registry.json`의 공식 값으로만.

## 표현 규칙

- `clear`는 **"확인된 불일치 없음"**이다. "정상"·"진짜"·"안전"으로 쓰지 않는다.
- **"정확도 100%"라고 말하지 않는다.** "합성 시나리오 N개에서 재현된 회귀 결과"다.
- 처리시간은 **관측 범위**이지 P95가 아니다.
- **절대 표현 금지** — "기존 서비스는 전부 …", "국내외 선례 없음". 반례 하나에 무너진다.
- **공식 연락처를 그대로 복사한 사칭은 탐지하지 못한다.** 이걸 먼저 밝힌다.
- 레지스트리는 **5개 기관 시범 적용**이다. 민간 사업자는 대조 대상이 아니다.

## Upstage 플랫폼 함정 (실측)

- **Studio 노드는 6종**: Parse · Classify · Extract · Instruct · **Validate** · **Merge**. **Mask는 없다**(공식 문서에는 4종만 기술돼 있고 Validate/Merge는 문서에 없다).
- **초안(draft)은 API에서 보이지 않는다.** `No default config found` → Studio 헤더에서 `설정 #N 초안 ▾ → 저장`.
- **미설정 노드가 캔버스에 있으면 config 저장이 거부된다** ("유효하지 않은 설정"). 규칙 없는 Validate 노드가 그랬다.
- **`include: ["all"]`로 호출한다.** `["last"]`면 Extract 필드·confidence·location이 사라진다.
- **`output[].model`로 단계를 찾는다.** Extract는 `step_N` 형식이 아니라 `"Information Extract - Extract-1"`이다. **배열 순번 접근 금지** — 분기로 단계가 생략된다.
- **`additional_values`는 객체로 온다**(문자열이면 `JSON.parse`). Extract는 필드별 `{_value, confidence: high|low, page, coordinates, word_coordinates}`, Classify는 `document_type {_value, confidence_score(0~1), confidence(high|low)}` + `hierarchy`.
- **미매핑 타입은 Extract 단계가 응답에서 통째로 빠진다**(빈 결과가 아니다).
- **Extract의 confidence는 `high`/`low` 범주**다. 숫자 임계값이 아니다. 공식 문서가 "confident한데 incorrect할 수 있다"고 경고한다.
- **`failed`는 종결 상태**다. 같은 `job_id` 재조회로는 안 된다 — 새 job을 만든다.
- 상태값: `queued` / `in_progress` / `completed` / `failed`.
- 웹훅 콜백이 없다. 폴링뿐이다.
- Classify·Instruct는 Beta 무료. Parse $0.01/p, Extract $0.03/p.

## 검증 계층에서 이미 물린 함정

- **기관은 대표번호 하나만 쓰지 않는다.** 부서 직통번호(054-270-6230)를 대표번호(054-270-8282)와 다르다고 `mismatch` 주면 **진짜 관공서 문서를 사칭으로 오판**한다. → 국번 대역(`phone_prefixes`)으로 인정하되 **대표번호를 prefix에 넣지 않는다**(`1577-1000-666`이 통과한다).
- **실제 고지서에는 홈페이지 URL이 없다.** 한 필드가 비었다고 다른 필드 대조까지 막으면 사칭본을 놓친다. **필드별 독립 판정.**
- **기관명 매칭은 시작 일치 + 하위조직 꼬리 검증만.** 역방향 부분 문자열을 허용하면 `"공단"`·`" "`·`"가짜국민연금공단"`이 전부 통과한다.
- **URL은 파싱 후 host 경계 비교.** scheme 화이트리스트(http/https), userinfo·역슬래시·제어문자 거부, 예외는 fail-closed. 문자열 포함 검사는 `evil.com/go.kr`을 통과시킨다.
- **`mismatch`(빨강)는 확정 신호만** — 개인 휴대전화·도메인 불일치·예금주 불일치. 전화번호 단독 불일치는 `review`까지.

## 대회 규칙

- **행사 이전에 작성한 코드 사용 불가.**
- **소스코드 전체 공개 필수.** 오픈소스 사용 시 명시. → `UPSTAGE_API_KEY`에 `NEXT_PUBLIC_` 접두사 절대 금지. 리딤코드도 레포에 넣지 않는다.
- 원격 참여 불가, 팀 1~4명, 단일 트랙.
- 심사: Upstage 기술 30% / 완성도 20% / 창의성 25% / 기획 25%.
- **"Upstage Studio must be used at the core of the document-handling pipeline"** — 비협상 조건.

## 작업 방식

- **팀원 산출물에 의존하지 않는다.** 백엔드·프론트·UI/UX 전부 직접 만든다.
- **항상 Codex 리뷰를 받으며 진행한다.** `codex exec --skip-git-repo-check - < prompt.md` (10분 초과 시 백그라운드).
- 시연은 **아이폰 실기기 + QuickTime 미러링**. macOS *iPhone Mirroring*은 폰이 잠겨야 동작해 촬영 시연이 불가능하다.
- **iOS는 무음 모드(벨소리 스위치)면 음성이 안 난다.** 데모 체크리스트 1번.
