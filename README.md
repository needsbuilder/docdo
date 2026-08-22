# DocDo

**어르신이 우편물을 사진 한 장으로 확인하고, 공식 정보와 대조한 결과가 자녀에게 바로 전달되는 문서 에이전트.**

이름은 두 가지를 담았다 — 한국 땅 **독도**, 그리고 **doc do**(문서가 행동한다).

- **데모** https://docdo.vercel.app
- **소스** https://github.com/needsbuilder/docdo
- JunctionX Korea 2026 · Upstage Studio 트랙 · 팀 **Reporch**

---

## 무엇을 푸는가

문해력이 취약한 고령자에게 우편물은 **읽기의 문제가 아니라 판단의 문제**다.
무엇이 왔는지, 진짜인지, 무엇을 해야 하는지를 혼자 정하기 어렵다.
그래서 이 앱은 어르신에게 **이해와 안심과 위험 경고**만 주고,
**행동은 전부 자녀 화면으로 옮긴다.**

### 어르신 화면에 없는 것

계좌번호 · 납부 버튼 · 결제 링크 · 신청 버튼.
전화가 걸리는 번호는 **레지스트리에 등록된 공식 대표번호 하나뿐**이다.
문서에서 읽어낸 번호와 링크는 화면에 표시되더라도 **누를 수 없다.**

---

## 어떻게 도는가

```
사진 → [Upstage Studio 에이전트] → [우리 검증 계층] → 어르신 문구 + 자녀 카드
```

### 1. Upstage Studio (문서 처리의 핵심)

- **에이전트** `agt_PNZaixnk4TZxkDg5muEJQi` · **저장 설정 #4**
- **노드 구성**: `Document Parse → Classify(pay / apply / info / ad) → Extract 분기 2개`
  - `Extract-1` 납부 문서 9필드 · `추출-2` 신청 문서 7필드
  - `ad`(광고)는 **의도적 미매핑**이다. Extract 단계가 응답에서 통째로 빠진다.
- `include: ["all"]` 로 호출한다. `["last"]` 면 Extract 필드·confidence·좌표가 사라진다.
- 단계는 `output[].model` **정규식으로 찾는다.** 분기로 단계가 생략되므로 배열 순번 접근은 틀린다.

> Studio 캔버스에서 확인한 노드는 6종(Parse · Classify · Extract · Instruct · Validate · Merge)이다.
> 그중 **우리 구성이 실제로 쓰는 것은 Parse · Classify · Extract 셋**이다.
> Validate/Merge 는 존재를 확인했을 뿐 이 파이프라인에 없다.

### 2. 검증 계층 (`lib/verify.ts`)

Studio 출력이 **문서 내부에서 무엇을 말하는지**와, 그것이 **바깥의 공식 정보와 맞는지**는 다른 문제다.
후자를 우리가 판정한다.

| 규칙 | 무엇을 보는가 |
|---|---|
| **R1** 발신 정합성 | 기관명·문의전화·안내 주소를 `data/issuer_registry.json` 과 대조 |
| **R3** 신뢰도 게이트 | 핵심 필드가 `low`·결손·형식 오류면 **숫자를 읽지 않는다** |
| **R4** 개인 휴대전화 | 공공기관 고지서의 상담 번호가 `010-…` 이면 확정 위험 신호 |
| **R5** 분류 신뢰도 | 문서 종류 자체를 확신하지 못하면 사람에게 넘긴다 |
| **R6** 예금주 정합성 | 가상계좌 예금주가 발급기관명과 **완전히 일치**해야 한다 |

판정값은 8가지다: `clear` `review` `mismatch` `unknown_issuer` `not_checkable` `no_extract` `needs_human` `failed`

---

## 읽는 방법 — 이 결과가 말하지 않는 것

- **`clear`는 "확인된 불일치 없음"이다.** 문서가 진짜라는 뜻이 아니다.
  "정상"·"진짜"·"안전"으로 읽으면 안 된다.
- **공식 연락처를 그대로 복사한 사칭 문서는 이 방식으로 탐지하지 못한다.**
  대조할 값이 전부 진짜이기 때문이다. 이건 설계상의 한계이지 버그가 아니다.
- **레지스트리는 5개 기관 시범 적용이다** — 건강보험공단 · 보건복지부 · 국민연금공단 · 한국전력공사 · 포항시.
  전국 공공기관을 지원하지 않으며 **민간 사업자(통신·금융)는 대조 대상이 아니다.**
- **등록된 기관명과 정확히 일치하지 않는 하위 조직 표기는 `clear` 로 올리지 않는다.**
  `국민연금공단 포항지사`(진짜)와 `국민건강보험공단가짜환급센터`(사칭)는 **구조만으로 구분할 수 없다.**
  그래서 둘 다 자녀 확인으로 보낸다. 오탐을 감수하고 미탐을 줄이는 쪽을 택했다.
- **계좌의 실제 명의는 조회하지 않는다.** 권한이 없다. 화면에도 "확인하지 않음"으로 표시된다.
- 처리시간 **4.1~26.2초**는 n=12 의 **관측 범위**다. P95 가 아니다.

---

## 재현

```bash
git clone https://github.com/needsbuilder/docdo.git
cd docdo
npm install
cp .env.example .env.local   # 값을 채운다
npm run dev                  # http://localhost:3000
```

### 환경변수

| 이름 | 필요성 | 설명 |
|---|---|---|
| `UPSTAGE_API_KEY` | 필수 | **서버 전용.** `NEXT_PUBLIC_` 접두사를 붙이면 안 된다 |
| `UPSTAGE_AGENT_ID` | 필수 | `agt_PNZaixnk4TZxkDg5muEJQi` |
| `SUPABASE_URL` | 선택 | 없으면 `.data/` 파일 저장소로 자동 전환된다 |
| `SUPABASE_ANON_KEY` | 선택 | 위와 같다 |

Supabase 없이도 전체 흐름이 로컬에서 돈다. 스키마는 `supabase/schema.sql`.

### 시험

```bash
npm test    # 243개
```

`tests/verify.test.ts` 는 공격·결손 입력 19종 회귀,
`tests/hardening.test.ts` 는 코드 리뷰에서 **실제 실행으로 재현된** 우회 경로를 고정한다
(예금주 부분 문자열 · 전화번호 이어붙이기 · 가짜 지사명 · ReDoS · 분류 계약 fail-open).

실물 우편물을 찍어야 동작한다. 저장된 결과를 재생하는 체험 모드는 두지 않았다.

---

## 범위와 운영 전제

- **지원**: iPhone Safari · 데스크톱 웹. **Android 는 테스트하지 않았다.**
- **iOS 음성**: 무음(벨소리) 스위치가 켜져 있으면 소리가 나지 않는다. 하드웨어라 코드로 풀 수 없다.
  첫 발화는 사용자 제스처 안에서 잠금을 푼다(`lib/speak.ts`).
- **데모용 Supabase 는 RLS 비활성이며 운영 설정이 아니다.** 가구는 `demo` 하나로 고정돼 있다.
  실서비스에는 가구별 인증과 RLS 정책이 반드시 필요하다.
- **원본 사진은 판독이 끝나면 Upstage 에서 삭제한다.** 우리 DB 에 이미지를 저장하지 않는다.
- **허용목록 밖 필드는 저장하지 않는다.** `account_number`·`recipient_name` 등은 폐기된다.
- `fixtures/` 의 문서는 **전부 팀이 만든 합성 견본**이다.
  실재하는 개인·계좌 정보가 들어 있지 않다. 모델 성능 평가용 데이터가 아니라,
  **두 필드만 바꿨을 때 규칙 결과가 달라지는지 보는 통제 실험**이다.

---

## 사용한 오픈소스

| 패키지 | 라이선스 | 용도 |
|---|---|---|
| [Next.js](https://github.com/vercel/next.js) 16 | MIT | App Router · API Route |
| [React](https://github.com/facebook/react) 19 | MIT | UI |
| [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) 4 | MIT | 스타일 |
| [@supabase/supabase-js](https://github.com/supabase/supabase-js) | MIT | Postgres 클라이언트 |
| [server-only](https://github.com/vercel/next.js) | MIT | 서버 전용 모듈 가드 |
| [Vitest](https://github.com/vitest-dev/vitest) | MIT | 시험 |
| [TypeScript](https://github.com/microsoft/TypeScript) | Apache-2.0 | 타입 |
| [ESLint](https://github.com/eslint/eslint) | MIT | 정적 검사 |

브라우저 내장 API 사용: `Web Speech API`(`speechSynthesis`) · `Canvas`(사진 압축) · `File`/`FormData`.
외부 TTS 서비스를 쓰지 않으므로 음성에 네트워크가 필요 없다.

Upstage Document AI (Parse · Classify · Information Extract) 는 상용 API 이며 오픈소스가 아니다.
