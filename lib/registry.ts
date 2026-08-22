import raw from "@/data/issuer_registry.json";
import type { Issuer } from "./types";

/** 호출자가 배열에 값을 밀어 넣으면 이후 모든 판정이 오염된다. 통째로 얼린다. */
function deepFreeze<T>(o: T): T {
  if (o && (typeof o === "object" || typeof o === "function") && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

// 5개 기관 시범 적용이다. 전국 공공기관을 지원하지 않으며 민간 사업자는 대조 대상이 아니다.
export const REGISTRY = deepFreeze(
  raw as unknown as {
    issuers: Issuer[];
    coverage_note: string;
    version: string;
  },
);
