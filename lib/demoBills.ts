// 시연용 납부 포털의 "고지 원장". 합성 고지서(fixtures/)의 전자납부번호만 안다.
// 실제 지로는 금융인증서 없이는 조회조차 되지 않아, 어댑터의 대상으로 이 포털을 둔다.
// 실기관 연동은 이 원장을 기관 API 로 바꾸는 일이지 에이전트를 바꾸는 일이 아니다.

export type DemoBill = { epn: string; issuer: string; title: string; amount: number; due: string; payer: string };

const digits = (s: string) => s.replace(/\D/g, "");

export const DEMO_BILLS: DemoBill[] = [
  { epn: "1102-1234-5678-9012", issuer: "국민건강보험공단", title: "2026년 7월분 건강보험료", amount: 73000, due: "2026-08-25", payer: "이순자" },
  { epn: "1120-6032-4087-13912", issuer: "국민건강보험공단", title: "2026년 8월분 건강보험료", amount: 32000, due: "2026-08-30", payer: "김영자" },
  // fixtures/06 통신요금 미납 안내 — 촬영본에 따라 Extract 가 두 가지로 읽는다.
  { epn: "8801-2233-4455", issuer: "주식회사 케이티", title: "통신요금 미납 안내 (7월분)", amount: 45100, due: "2026-08-29", payer: "이순자" },
  { epn: "0801-2233-4455-0000", issuer: "주식회사 케이티", title: "통신요금 미납 안내 (7월분)", amount: 45100, due: "2026-08-29", payer: "이순자" },
  // 시연 인쇄본(8/23): 부산광역시 상하수도사업본부 독촉 고지서. 서울고수도(사칭 의심)의 번호는 일부러 넣지 않는다.
  { epn: "77777712-12345678-12345678-12345678-12345678", issuer: "부산광역시 상하수도사업본부", title: "상하수도요금 체납 독촉 (2025.01~05)", amount: 156200, due: "2025-05-31", payer: "홍길동" },
  // fixtures/team/07 주민세(개인분) — 포항시 북구 세무과. 시연 인쇄본.
  { epn: "0-2-47110-20260801-0000123", issuer: "포항시", title: "2026년 주민세(개인분)", amount: 12500, due: "2026-08-31", payer: "이순자" },
];

export function findDemoBill(epn: string): DemoBill | null {
  const d = digits(epn);
  return DEMO_BILLS.find((b) => digits(b.epn) === d) ?? null;
}

const paid = new Map<string, { receipt: string; at: string }>();
export function payDemoBill(epn: string): { receipt: string; at: string } {
  const d = digits(epn);
  const prev = paid.get(d);
  if (prev) return prev;
  const rec = { receipt: `G${Date.now().toString().slice(-8)}`, at: new Date().toISOString() };
  paid.set(d, rec);
  return rec;
}
