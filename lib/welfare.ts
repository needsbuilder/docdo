import snapshot from "@/data/welfare_snapshot.json";
import { matchIssuer } from "./verify";
import type { VerifyResult, Verdict } from "./types";

// 우리 문제 정의는 "자격이 있는데 신청하지 않아 못 받는 노인"이다.
// 그런데 앞의 계층은 **안내문이 왔을 때만** 작동한다. 안내문이 안 와서 못 받는 게 진짜 문제다.
// 여기서 문서 하나를 읽고 **그 문서에 없는 기회**를 찾는다.
//
// 전부 자녀 화면에만 붙는다. 어르신에게 "받으실 수 있어요"를 보여줘도 신청할 수 없다.
// 그리고 **자격을 판정하지 않는다.** 소득·재산 기준은 우리가 알 수 없다.

export type Benefit = {
  id: string;
  name: string;
  agency: string;
  target: string;
  howTo: string;
  contact: string;
  sourceUrl: string;
  verifiedAt: string;
};

type Row = Benefit & { triggers: string[] };

const ROWS = (snapshot as unknown as { benefits: Row[] }).benefits;
export const WELFARE_COVERAGE = (snapshot as unknown as { coverage_note: string }).coverage_note;
export const WELFARE_VERSION = (snapshot as unknown as { version: string }).version;

// 추출을 신뢰할 수 없거나 발신이 의심스러운 문서에서는 제도를 권하지 않는다.
// 사칭본을 통로로 삼아 "공단에 전화하세요"를 띄우면 사칭이 신뢰를 얻는다.
// clear 하나만. review·not_checkable 은 "대조를 못 했다"는 뜻이지 발신이 확인됐다는 뜻이 아니다.
const TRUSTED: ReadonlySet<Verdict> = new Set<Verdict>(["clear"]);
const SKIP_TYPES = new Set(["ad", "other"]);

export function findRelatedBenefits(result: VerifyResult): Benefit[] {
  if (!result?.fields) return [];
  if (SKIP_TYPES.has(result.actionType ?? "")) return [];
  if (!TRUSTED.has(result.verdict)) return [];
  // 기관명 자체의 읽기가 불확실하면 권하지 않는다.
  if (result.fieldConfidence?.issuer !== "high") return [];
  // 대조에서 실제로 통과한 검사가 하나는 있어야 한다. 0/0 clear 는 없지만 방어한다.
  if (!result.checksPassed || result.checksPassed < 1) return [];

  // 하위 조직 표기(구조만 맞는 이름)로는 권하지 않는다.
  // `국민연금공단 포항지사`와 `국민건강보험공단가짜환급센터`를 구분할 수 없기 때문이다.
  const matched = matchIssuer(result.fields.issuer);
  if (!matched || matched.match !== "exact") return [];

  // triggers 는 내부 매칭용이다. 화면으로 내보내지 않는다.
  return ROWS.filter((r) => r.triggers.includes(matched.issuer.issuer_id)).map((r) => ({
    id: r.id,
    name: r.name,
    agency: r.agency,
    target: r.target,
    howTo: r.howTo,
    contact: r.contact,
    sourceUrl: r.sourceUrl,
    verifiedAt: r.verifiedAt,
  }));
}
