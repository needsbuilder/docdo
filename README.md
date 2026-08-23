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
- **레지스트리는 8개 기관 시범 적용이다** — 건강보험공단 · 보건복지부 · 국민연금공단 · 한국전력공사 · 포항시 · 부산지방법원 · 서울아리수본부, 그리고 시연용 합성값인 부산상하수도사업본부(`demo: true`, 실제 공식 값이 아니다).
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
| `AUTH_SECRET` | 필수 | 보호자 세션 서명 키(16자 이상 난수). 없으면 보호자 화면이 열리지 않는다 |
| `ELEVENLABS_API_KEY` | 선택 | 어르신 음성. 없으면 기기 내장 TTS 로 폴백한다. **서버 전용** |
| `AGENT_SECRET` | 에이전트 | 워커가 서버에 자신을 증명하는 비밀. 서버(Vercel)와 워커(Railway) 양쪽에 같은 값 |

Supabase 없이도 전체 흐름이 로컬에서 돈다. 스키마는 `supabase/schema.sql`.

### 시험

```bash
npm test    # 296개
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
- **보호자는 이메일+비밀번호로 가입한다.** 가입하면 가구(household) 하나와 **어르신 초대 링크**가 생긴다.
  비밀번호는 scrypt 해시, 세션은 HMAC 서명 HttpOnly 쿠키. 이메일 인증·비밀번호 재설정은 없다(데모 범위).
- **어르신은 계정이 없다.** 보호자가 보낸 링크(`/elder?h=토큰`)를 한 번 열면 토큰이 폰에 저장되고
  주소창에서 지워진다. 이후로는 링크 없이도 그 가구로 올라간다. 통지서를 못 읽는 분께 회원가입을 시키지 않는다.
- **문서는 가구 단위로 격리된다.** 보호자는 자기 가구 것만 보고, 어르신 조회도 토큰의 가구와 맞아야 한다.
  남의 문서는 존재하지 않는 것(404)으로 답한다.
- 어르신이 받는 응답에는 **문서 원문 필드가 없다**(문구·판정·공식 연락처만). IP당·전역 속도 제한.
- **데모용 Supabase 는 RLS 비활성이며 운영 설정이 아니다.** 보호자가 가입하면 가구(household)가 하나 생기고 문서는 그 가구로 격리된다.
  anon key 는 서버에서만 쓰이고 브라우저 번들에 들어가지 않는다.
- **원본 사진은 판독이 끝나면 Upstage 에서 삭제한다.** 우리 DB 에 이미지를 저장하지 않는다.
- **허용목록 밖 필드는 저장하지 않는다.** `account_number`·`recipient_name` 등은 폐기된다.
- `fixtures/` 의 문서는 **전부 팀이 만든 합성 견본**이다.
  실재하는 개인·계좌 정보가 들어 있지 않다. 모델 성능 평가용 데이터가 아니라,
  **두 필드만 바꿨을 때 규칙 결과가 달라지는지 보는 통제 실험**이다.

---

## 승인 뒤 처리 — 브라우저 에이전트

보호자가 카드의 **[납부 처리 승인]** 을 누르면 문서가 `queued` 가 되고, 별도 프로세스인 워커(`scripts/agent-worker.ts`)가 집어 실제 Chromium 으로 납부 포털을 조작한다.

- **두뇌는 Solar Pro 4** (`scripts/agent-brain.ts`). 페이지의 접근성 트리(버튼·입력·링크 글자 + 참조 번호)를 읽고 `click / type / press / scroll / wait_human / done / abort` 중 **한 번에 하나**만 결정한다. 이미지를 받지 않는다 — 픽셀 computer-use 가 아니다.
- **가드레일은 코드에 있다.** 비밀번호·인증서·본인인증 문구가 보이면 모델을 부르지 않고 보호자에게 넘긴다(`waiting`) · `password` 입력 금지 · 납부·결제·이체 버튼은 화면에 문서 금액이 보일 때만 · 허용 도메인 밖 차단 · 같은 화면 3회·25단계 초과 중단 · `done` 은 납부 클릭 후에만.
- **보호자 차례**: 워커가 0.7초 간격으로 보내는 화면(JPEG, 세로 430×760)이 보호자 카드에 실시간으로 뜨고, 보호자는 그 화면을 **폰에서 직접 눌러**(터치 좌표·글자·Enter 중계) 인증을 마친 뒤 [이어서 하기]를 누른다. 원격 입력은 서버 큐를 지나지만 저장하지 않고 끝나면 비운다.
- **승인 자체가 막히는 문서**: `mismatch` · 전자납부번호나 금액이 Extract `high` 가 아닌 것(버튼이 뜨지 않고 이유가 한 줄로 보인다).
- **대상 포털**: 실제 인터넷지로는 비회원도 금융인증서가 필수라 조회조차 인증 뒤에 있다. 그래서 같은 흐름의 **시연용 포털 `/demo/giro`** (화면에 "시연용 · 실제 납부 아님" 상시 표기, 원장은 `lib/demoBills.ts`)에서 처리하고, [실제 인터넷지로에서]는 giro.or.kr 의 인증 벽에서 보호자에게 넘어오는 것까지 보여준다. 실기관 연동은 원장을 기관 API 로 바꾸는 일이지 에이전트를 바꾸는 일이 아니다.

```bash
# 워커 (서버와 같은 AGENT_SECRET · UPSTAGE_API_KEY 필요)
DOCDO_URL=https://docdo.vercel.app npm run agent          # 헤드리스
DOCDO_URL=https://docdo.vercel.app npm run agent:demo     # 브라우저 보임
AGENT_MODE=script …                                       # 고정 절차 폴백(모델 없이)
AGENT_ADAPTER=giro …                                      # 실제 인터넷지로 — 인증 벽에서 멈춘다
```

시연 환경에서는 워커가 Railway(`Dockerfile.agent`, Playwright 공식 이미지)에 상시 기동돼 있다.

## 화면 디자인

시각 언어는 팀 Figma 시안을 따른다(흰 앱바·`#3182f6`·연회색 바탕 위 무테 흰 카드·알약 칩·56px CTA). 다만 **서체(KoddiUD)와 어르신 글자 하한 20px 는 시안보다 우선**한다. 시안에 있어도 넣지 않은 것 — 하단 탭바·검색·알림 센터·OTP 인증·계좌번호 카드·"신뢰도 %"·"안전/정상" 문구 — 는 안전 원칙과 표현 규칙 때문이다. 어르신은 링크를 Safari 로 열어 **홈 화면에 추가**하면 그 아이콘이 연결된 상태로 바로 열린다(`/manifest.json?h=토큰`).

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

| [Playwright](https://github.com/microsoft/playwright) | Apache-2.0 | 에이전트 워커의 브라우저(Chromium) |
| [tsx](https://github.com/privatenumber/tsx) | MIT | 워커 실행 |
| [Phosphor Icons](https://github.com/phosphor-icons/core) | MIT | 아이콘 — 패스 데이터만 `components/icons.tsx` 에 옮겨 담았다(npm 의존 없음) |
| [KoddiUD 온고딕](https://www.koddi.or.kr/) | CC BY-SA 4.0 | 서체 (`public/fonts/`) — 한국장애인개발원 × 윤디자인 |

팀 자산: 로고 마스코트(`public/brand/`)와 Figma 시안에서 내보낸 선 아이콘(`components/icons.tsx` 하단)은 팀 디자이너 작업물이다.

브라우저 내장 API 사용: `Web Speech API`(`speechSynthesis`, 폴백 음성) · `Canvas`(사진 압축) · `File`/`FormData` · `Web App Manifest`.
음성은 [ElevenLabs](https://elevenlabs.io) 상용 API(`/api/speech`, 서버 전용 키)를 먼저 쓰고, 키·크레딧·네트워크 문제가 있으면 기기 내장 TTS 로 같은 문장을 읽는다.

Upstage Document AI (Parse · Classify · Information Extract) 는 상용 API 이며 오픈소스가 아니다.
