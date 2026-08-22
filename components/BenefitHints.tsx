import { findRelatedBenefits, WELFARE_COVERAGE } from "@/lib/welfare";
import type { VerifyResult } from "@/lib/types";

// 단정하지 않는다. "받으실 수 있습니다" ✗ → "확인해 보실 제도" ✓
// 우리는 소득·재산을 모른다. 수급 자격을 판정한 것이 아니라는 걸 화면에 적는다.

export default function BenefitHints({ result }: { result: VerifyResult }) {
  const items = findRelatedBenefits(result);
  if (!items.length) return null;

  return (
    <section className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-4">
      <p className="mb-2 text-sm font-bold text-sky-900">
        💡 이 문서와 관련해 확인해 보실 제도
      </p>
      <ul className="space-y-3">
        {items.map((b) => (
          <li key={b.id} className="text-sm leading-relaxed">
            <p className="font-semibold">
              {b.name} <span className="font-normal text-neutral-500">· {b.agency}</span>
            </p>
            <p className="mt-0.5 text-neutral-700">대상: {b.target}</p>
            <p className="text-neutral-700">신청: {b.howTo}</p>
            <div className="mt-1 flex flex-wrap gap-3">
              {/* 연락처는 스냅샷의 공식 값이다. 문서에서 읽은 번호가 아니다. */}
              <a href={`tel:${b.contact}`} className="font-semibold text-sky-800 underline">
                📞 {b.contact}
              </a>
              <a
                href={b.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-800 underline"
              >
                공식 안내
              </a>
            </div>
            <p className="mt-0.5 break-all text-xs text-neutral-500">
              출처 {b.sourceUrl} · 확인일 {b.verifiedAt}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-neutral-500">
        해당 여부는 소득·재산 기준에 따라 달라집니다. <strong>수급 자격을 판정한 것이 아니며</strong>,
        위 연락처로 확인하셔야 합니다. {WELFARE_COVERAGE}
      </p>
    </section>
  );
}
