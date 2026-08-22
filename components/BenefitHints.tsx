import { findRelatedBenefits, WELFARE_COVERAGE } from "@/lib/welfare";
import type { VerifyResult } from "@/lib/types";
import { Phone, ArrowSquareOut } from "@/components/icons";

// 단정하지 않는다. "받으실 수 있습니다" ✗ → "확인해 보실 제도" ✓
// 우리는 소득·재산을 모른다. 수급 자격을 판정한 것이 아니라는 걸 화면에 적는다.

export default function BenefitHints({ result }: { result: VerifyResult }) {
  const items = findRelatedBenefits(result);
  if (!items.length) return null;

  return (
    <section className="mt-4 border-l-4 border-brand pl-4">
      <p className="mb-2 text-g-body font-bold text-brand">이 문서와 관련해 확인해 보실 제도</p>
      <ul className="space-y-4">
        {items.map((b) => (
          <li key={b.id} className="text-g-body">
            <p className="font-bold text-ink">
              {b.name} <span className="font-normal text-ink-soft">· {b.agency}</span>
            </p>
            <p className="mt-0.5 text-ink-mid">대상: {b.target}</p>
            <p className="text-ink-mid">신청: {b.howTo}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {/* 연락처는 스냅샷의 공식 값이다. 문서에서 읽은 번호가 아니다. */}
              <a
                href={`tel:${b.contact}`}
                className="press inline-flex min-h-tap items-center gap-2 rounded-control border-2 border-line bg-surface px-3 font-bold text-ink active:bg-brand-tint"
              >
                <Phone size={20} />
                {b.contact}
              </a>
              <a
                href={b.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="press inline-flex min-h-tap items-center gap-2 rounded-control border-2 border-line bg-surface px-3 text-ink active:bg-brand-tint"
              >
                <ArrowSquareOut size={18} />
                공식 안내
              </a>
            </div>
            <p className="mt-1 break-all text-g-meta text-ink-soft">
              출처 {b.sourceUrl} · 확인일 {b.verifiedAt}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-g-meta text-ink-soft">
        해당 여부는 소득·재산 기준에 따라 달라집니다. <strong className="text-ink-mid">수급 자격을 판정한 것이 아니며</strong>,
        위 연락처로 확인하셔야 합니다. {WELFARE_COVERAGE}
      </p>
    </section>
  );
}
