export type Verdict =
  | "clear"
  | "review"
  | "mismatch"
  | "unknown_issuer"
  | "not_checkable"
  | "no_extract"
  | "needs_human"
  | "failed";

export type CheckKind = "phone" | "host" | "mobile" | "payee";

export type Check = {
  name: string;
  value: string | null;
  ok: boolean | null;
  expected: string[] | null;
  note?: string;
  kind?: CheckKind;
  conf?: string;
};

export type Reason = { rule: string; detail: string; action: string };

export type Issuer = {
  issuer_id: string;
  display_name: string;
  aliases: string[];
  official_hosts: string[];
  official_phones: string[];
  phone_prefixes: string[];
  source_urls: string[];
  verified_at: string;
};

export type SafeContact = {
  phones: string[];
  hosts: string[];
  source: string[];
  verifiedAt: string;
};

export type VerifyResult = {
  verdict: Verdict;
  actionType?: string;
  classifyConfidence?: string;
  classifyScore?: number;
  issuerId?: string;
  fields?: Record<string, unknown>;
  fieldConfidence?: Record<string, string>;
  checks: Check[];
  checksTotal?: number;
  checksPassed?: number;
  reasons: Reason[];
  speechSuppressed?: boolean;
  droppedFields?: string[];
  reason?: string;
  safeContact?: SafeContact;
};
