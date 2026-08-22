import type { VerifyResult } from "@/lib/types";
import { Check, WarningCircle, Minus } from "@/components/icons";

// Upstage 파이프라인 결과를 검증 계층이 판정한 유일한 증거다. 각주처럼 보이면 안 된다.
// "몇 건 중 몇 건"이 곧 신뢰의 단위다. 셀 수 없는 검사(ok=null)는 분모에서 빠지고 '—' 로 구분한다.

export default function CheckList({ result }: { result: VerifyResult }) {
  const checks = result.checks ?? [];
  return (
    <section className="rounded-inner border-2 border-line bg-surface p-4">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-g-body font-bold text-ink">공식 정보 대조</h3>
        <p className="text-g-title tabular-nums text-ink">
          {result.checksPassed ?? 0}
          <span className="text-g-body text-ink-soft"> / {result.checksTotal ?? 0}</span>
        </p>
      </header>
      <ul className="divide-y divide-line-soft">
        {checks.map((c, i) => {
          const tone =
            c.ok === null ? "text-ink-soft" : c.ok ? "text-ok-ink" : "text-danger-ink";
          const Icon = c.ok === null ? Minus : c.ok ? Check : WarningCircle;
          const label = c.ok === null ? "확인 못 함" : c.ok ? "일치" : "불일치";
          return (
            <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2 text-g-body">
              <span className={`inline-flex shrink-0 translate-y-[3px] ${tone}`}>
                <Icon size={20} label={label} />
              </span>
              <span className="font-bold text-ink">{c.name}</span>
              {c.value && <span className="min-w-0 break-all text-ink-mid">{c.value}</span>}
              {c.note && <span className="text-ink-soft">{c.note}</span>}
              {c.ok === false && c.expected && (
                <span className="rounded-chip bg-danger-tint px-2 py-0.5 text-danger-ink">
                  공식: {c.expected.join(", ")}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {result.safeContact && (
        <p className="mt-3 break-all text-g-meta text-ink-soft">
          출처 {result.safeContact.source?.[0]} · 확인일 {result.safeContact.verifiedAt}
        </p>
      )}
    </section>
  );
}
