import raw from "@/data/issuer_registry.json";
import type { Issuer } from "./types";

// 5개 기관 시범 적용이다. 전국 공공기관을 지원하지 않으며 민간 사업자는 대조 대상이 아니다.
export const REGISTRY = raw as unknown as {
  issuers: Issuer[];
  coverage_note: string;
  version: string;
};
