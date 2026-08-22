import type { VerifyResult } from "@/lib/types";

// 자녀 화면은 판단의 근거를 그대로 보여준다. "몇 건 중 몇 건"이 곧 신뢰의 단위다.
// 셀 수 없는 검사(ok=null)는 분모에서 빠져 있고, 화면에서도 '—' 로 구분해 표시한다.

export default function CheckList({ result }: { result: VerifyResult }) {
  const checks = result.checks ?? [];
  return (
    <div className="rounded-xl bg-neutral-50 p-4">
      <p className="mb-2 text-sm font-semibold text-neutral-700">
        공식 정보 대조 (검사 {result.checksTotal ?? 0}건 중 {result.checksPassed ?? 0}건 일치)
      </p>
      <ul className="space-y-1 text-sm">
        {checks.map((c, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span
              className={
                c.ok === null ? "text-neutral-400" : c.ok ? "text-emerald-700" : "text-red-600"
              }
              aria-label={c.ok === null ? "확인 못 함" : c.ok ? "일치" : "불일치"}
            >
              {c.ok === null ? "—" : c.ok ? "✓" : "!"}
            </span>
            <span className="font-medium">{c.name}</span>
            {c.value && <span className="break-all text-neutral-600">{c.value}</span>}
            {c.note && <span className="text-neutral-400">{c.note}</span>}
            {c.ok === false && c.expected && (
              <span className="text-red-600">공식: {c.expected.join(", ")}</span>
            )}
          </li>
        ))}
      </ul>
      {result.safeContact && (
        <p className="mt-3 text-xs leading-relaxed text-neutral-500">
          출처 {result.safeContact.source?.[0]} · 확인일 {result.safeContact.verifiedAt}
        </p>
      )}
    </div>
  );
}
