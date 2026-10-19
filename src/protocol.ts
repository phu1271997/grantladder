export type Tranche = {
  criteria: string;
  bps: number;
  amount: number;
  status: string;
  evidence?: { url: string; at: number } | null;
  verdict?: {
    result: { outcome: string; confidence: number };
    snapshot?: { url: string; status: number; content_sha256: string } | null;
    assessed_at: number;
  } | null;
  dispute?: { by: string; reason_digest: string } | null;
  released_at: number;
  claimable_at: number;
};

export type Grant = {
  id: number;
  funder: string;
  terms: {
    title: string;
    grantee: string;
    allowed_host: string;
    tranches: { criteria: string; bps: number }[];
    budget: number;
    review_window: number;
    expires: number;
  };
  terms_digest: string;
  phase: string;
  cursor: number;
  held: number;
  grantee_claimed: number;
  funder_refunded: number;
  refund_pending: number;
  tranches: Tranche[];
};

export const validAddress = (x: string) =>
  /^0x[0-9a-fA-F]{40}$/.test(x) && !/^0x0{40}$/.test(x);

export const validHost = (x: string) =>
  /^[A-Za-z0-9.-]+$/.test(x) && x.includes(".") && !x.startsWith(".") && !x.endsWith(".") && x.length <= 120;

export const hostOf = (url: string) => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.hostname : "";
  } catch {
    return "";
  }
};

export const urlInHost = (url: string, host: string) => {
  const h = hostOf(url);
  return !!h && (h === host || h.endsWith("." + host));
};

export const normalizeTx = (x: unknown) => {
  if (typeof x === "string" && /^0x[0-9a-fA-F]{64}$/.test(x)) return x;
  if (x && typeof x === "object" && "txId" in x && typeof (x as { txId: unknown }).txId === "string")
    return (x as { txId: string }).txId;
  throw Error("Wallet returned an invalid transaction hash.");
};

export const parseSafeGEN = (text: string) => {
  if (!/^(0|[1-9]\d{0,3})(\.\d{1,18})?$/.test(text))
    throw Error("Enter a positive GEN amount with up to 18 decimals.");
  const [whole, fraction = ""] = text.split(".");
  const wei = BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, "0"));
  if (wei <= 0n || wei > BigInt(Number.MAX_SAFE_INTEGER))
    throw Error("Amount exceeds the exact integer range supported by this form.");
  return Number(wei);
};

export function execution(tx: unknown): unknown {
  const value = tx as {
    status?: string | number;
    consensus_data?: {
      leader_receipt?: Array<{ mode?: string; execution_result?: string; result?: { status?: string; payload?: { readable?: string } | string } }>;
      votes?: Record<string, string>;
    };
  };
  if (value.status !== "FINALIZED" && value.status !== 7) throw Error("Transaction has not finalized.");
  const receipts = value.consensus_data?.leader_receipt || [];
  const receipt = [...receipts].reverse().find((x) => x.mode !== "validator") || receipts.at(-1);
  const payload = receipt?.result?.payload;
  const readable = payload && typeof payload === "object" ? payload.readable : undefined;
  if (!receipt || receipt.execution_result !== "SUCCESS" || receipt.result?.status !== "return" || readable === undefined)
    throw Error(typeof payload === "string" ? payload : "GenVM execution did not succeed.");
  if (Object.values(value.consensus_data?.votes || {}).filter((x) => x === "agree").length < 3)
    throw Error("Validator consensus was not established.");
  return JSON.parse(readable);
}

export const gen = (n: number) => `${(Number(n) / 1e18).toFixed(4)} GEN`;
export const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`;

export const outcomeTone = (o?: string) =>
  o === "RELEASE" ? "good" : o === "REVISE" ? "warn" : o === "REJECT" || o === "EVIDENCE_UNAVAILABLE" ? "bad" : "";

export const trancheTone = (status: string) =>
  status === "RELEASED" || status === "CLAIMED" ? "good" :
  status === "SUBMITTED" || status === "DISPUTED" ? "warn" :
  status === "REJECTED" ? "bad" : "";
