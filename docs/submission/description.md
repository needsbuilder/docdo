# 제출 폼 Description (좁힌 판) — 2026-08-23

> 폼 `hackjunction.app/participate/44/project` 의 Description 칸에 그대로 붙인다. 표현 규칙 준수: "정확도 100%"·"정상/안전"·절대 표현 없음.

## 한 줄 (Punchline)

어르신이 우편물을 사진 한 장으로 확인하고, 공식 정보와 대조한 결과가 자녀에게 바로 전달되어 자녀 승인 아래 처리까지 이어지는 문서 에이전트.

## Description

**독도(DocDo)** 는 문해력이 취약한 고령자의 우편물 문제를 "읽기"가 아니라 "판단"의 문제로 봅니다. 무엇이 왔는지, 진짜인지, 무엇을 해야 하는지를 혼자 정하기 어렵기 때문에, 어르신에게는 **이해·안심·위험 경고**만 주고 **행동은 전부 자녀 화면으로** 옮깁니다.

**흐름** — 어르신이 우편물을 찍으면 Upstage Studio 에이전트(Document Parse → Classify → Extract 분기)가 문서를 읽고, 우리 검증 계층이 추출값을 공식 기관 레지스트리와 대조합니다. 어르신 폰에는 큰 글씨와 음성으로 "문서에 적힌 내용"만 나오고(계좌번호·납부 버튼·결제 링크 없음), 자녀 폰에는 판정·핵심값·해야 할 일·대조 근거가 카드로 옵니다. 자녀가 **[납부 처리 승인]** 을 누르면 Solar Pro 4 기반 브라우저 에이전트가 납부 포털에서 고지 내역을 조회하고, 화면 금액이 문서 금액과 같을 때만 진행하며, 본인인증 단계는 사람에게 넘깁니다(자녀가 폰에서 실시간 화면을 직접 눌러 마침). 완료되면 어르신 화면이 "처리됐어요"로 바뀝니다.

**Upstage 활용** — Studio 에이전트를 문서 처리 파이프라인의 핵심에 두었습니다(`include: ["all"]` 로 필드별 confidence·좌표를 받아, `low` 인 값은 음성으로도 화면으로도 읽지 않음). Solar Pro 4 는 페이지의 접근성 트리(버튼·입력·링크와 참조 번호)를 읽고 한 번에 행동 하나를 결정하는 브라우저 에이전트의 두뇌입니다(픽셀 computer-use 가 아닙니다).

**안전 설계** — (1) 어르신 화면에 금전 거래로 이어지는 경로 없음 (2) 확신하지 못한 값은 읽지 않음 (3) 지시하지 않고 사실만 전달 (4) 폐기를 지시하지 않음 (5) 문서에서 추출한 연락처·링크는 실행 경로가 되지 못하며, 전화는 레지스트리의 공식 번호로만. 에이전트는 비밀번호·인증서를 입력하지 않고, 납부 버튼은 문서 금액이 화면에 보일 때만 누르며, 허용 도메인 밖으로 나가지 않습니다.

**검증** — 합성 고지서 통제 실험: 같은 문서에서 문의전화·안내 주소 두 필드만 바꾼 변조본을 Extract 는 정확히 읽었고, 판정을 가른 것은 레지스트리 대조였습니다(통제본 clear 2/2, 변조본 mismatch 0/2). 팀 합성 fixture 12장 12/12, 촬영 열화 시뮬레이션 mid 12/12 · hard 11/12(열화 시 조용히 틀리지 않고 사람에게 넘김), 회귀 시험 296개. 처리시간은 관측 범위 4.1~26.2초(n=12).

**한계** — `clear` 는 "확인된 불일치 없음"이지 "진짜"가 아닙니다. 공식 연락처를 그대로 복사한 사칭 문서는 이 방식으로 탐지하지 못합니다. 레지스트리는 8개 기관 시범 적용이며 민간 사업자는 대조 대상이 아닙니다. 실제 인터넷지로는 인증 이후 단계가 미구현이라 시연용 포털에서 처리합니다.

- Demo: https://docdo.vercel.app · Source: https://github.com/needsbuilder/docdo (오픈소스 목록은 README)
- 팀 정션없음 · Upstage Studio 트랙

## 영어 한 줄 (필요 시)

DocDo reads a letter from one photo for a low-literacy older adult, checks the extracted facts against an official issuer registry, hands the decision to the adult child, and — with their approval — a Solar-driven browser agent completes the payment while a human keeps the authentication step.
