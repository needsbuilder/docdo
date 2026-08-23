import type { VerifyResult } from "@/lib/types";
import { Check, WarningCircle, Minus } from "@/components/icons";

// Upstage 파이프라인 결과를 검증 계층이 판정한 유일한 증거다. 각주처럼 보이면 안 된다.
// "몇 건 중 몇 건"이 곧 신뢰의 단위다. 셀 수 없는 검사(ok=null)는 분모에서 빠지고 '—' 로 구분한다.
// 고지서의 표 문법: 항목 | 문서의 값 | 판정.

export default function CheckList({ result }: { result: VerifyResult }) {
  const checks = result.checks ?? [];
  return (
    <section>
      <header className="flex items-baseline justify-between gap-3 border-b border-line-soft pb-2">
        <h3 className="text-g-body font-bold text-ink">공식 정보 대조</h3>
        <p className="text-g-title tabular-nums text-ink">
          {result.checksPassed ?? 0}
          <span className="text-g-body text-ink-soft"> / {result.checksTotal ?? 0}</span>
        </p>
      </header>
      <ul>
        {checks.map((c, i) => {
          const tone = c.ok === null ? "text-ink-soft" : c.ok ? "text-ok-ink" : "text-danger-ink";
          const Icon = c.ok === null ? Minus : c.ok ? Check : WarningCircle;
          const label = c.ok === null ? "확인 못 함" : c.ok ? "일치" : "불일치";
          return (
            <li key={i} className="grid grid-cols-[5.5em_1fr_auto] items-baseline gap-x-3 border-b border-line-soft py-2.5 text-g-body">
              <span className="font-bold text-ink">{c.name}</span>
              <span className="min-w-0 break-all text-ink-mid">
                {c.value ?? <span className="text-ink-soft">—</span>}
                {c.note && <span className="block text-g-meta text-ink-soft">{c.note}</span>}
                {c.ok === false && c.expected && (
                  <span className="mt-1 block text-g-meta text-danger-ink">공식: {c.expected.join(", ")}</span>
                )}
              </span>
              <span className={`inline-flex items-center gap-1 text-g-meta font-bold ${tone}`}>
                <Icon size={16} />
                {label}
              </span>
            </li>
          );
        })}
      </ul>
      {result.safeContact && (
        <p className="mt-2 break-all text-g-meta text-ink-soft">
          출처 {result.safeContact.source?.[0]} · 확인일 {result.safeContact.verifiedAt}
        </p>
      )}
    </section>
  );
}
