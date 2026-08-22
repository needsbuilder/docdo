import type { DocRow } from "./store";
import type { VerifyResult, Check } from "./types";
import type { Phrases } from "./phrase";

// 어르신 화면이 받는 응답에는 **문서 원문이 없다.**
// 화면에는 "우편물"만 떠도 API 응답에 doc_title·contact_phone·info_url 이 그대로 실리면
// 어르신 기기와 공개 응답에 계좌·사기 번호가 남는다. 원칙 1·5의 API 판이다.
//
// 어르신이 필요한 것: 문구·판정·공식 연락처·처리 상태. 그게 전부다.

export type ElderDoc = {
  id: string;
  pipeline_status: string;
  resolution_status: string;
  verdict: string | null;
  phrases: Phrases | null;
  // 판정 종류만. fields·checks 원문은 없다.
  result: {
    verdict: VerifyResult["verdict"];
    speechSuppressed: boolean;
    // 레지스트리 값. 문서에서 읽은 값이 아니다.
    safeContact?: VerifyResult["safeContact"];
    // mismatch 일 때 종류별 문구를 고르려면 kind 만 있으면 된다.
    failedKinds: string[];
  } | null;
  error?: string;
};

export function toElderDoc(row: DocRow & { error?: string }): ElderDoc {
  const r = row.result;
  return {
    id: row.id,
    pipeline_status: row.pipeline_status,
    resolution_status: row.resolution_status,
    verdict: row.verdict,
    phrases: row.phrases,
    result: r
      ? {
          verdict: r.verdict,
          speechSuppressed: r.speechSuppressed === true,
          safeContact: r.safeContact,
          failedKinds: (r.checks ?? [])
            .filter((c: Check) => c.ok === false && c.kind)
            .map((c: Check) => c.kind as string),
        }
      : null,
    ...(row.error ? { error: row.error } : {}),
  };
}

/** 자녀 화면용. 원문 필드는 보되 내부 Upstage ID 는 뺀다 — 밖에 나갈 이유가 없다. */
export type GuardianDoc = Omit<DocRow, "upstage_job_id" | "upstage_file_id"> & { error?: string };

export function toGuardianDoc(row: DocRow & { error?: string }): GuardianDoc {
  const rest: Record<string, unknown> = { ...row };
  delete rest.upstage_job_id;
  delete rest.upstage_file_id;
  return rest as GuardianDoc;
}
