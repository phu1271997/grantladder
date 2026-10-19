// End-to-end / seeding run for GrantLadder on StudioNet.
//   source ~/.genlayer/env.sh
//   GRANTLADDER_ADDRESS=0x... node scripts/live.mjs
// Funder = wallet _2, grantee = wallet _3; never the deployer.
import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const address = process.env.GRANTLADDER_ADDRESS;
if (!/^0x[0-9a-fA-F]{40}$/.test(address || "")) throw Error("Set GRANTLADDER_ADDRESS");
const keyNames = ["GENLAYER_PRIVATE_KEY_2", "GENLAYER_PRIVATE_KEY_3"];
for (const n of keyNames) if (!/^(0x)?[0-9a-fA-F]{64}$/.test(process.env[n] || "")) throw Error(`Set ${n}`);
const key = (n) => (process.env[n].startsWith("0x") ? process.env[n] : `0x${process.env[n]}`);
const accounts = keyNames.map((n) => createAccount(key(n)));
const [funder, grantee] = accounts;
const clients = accounts.map((account) => createClient({ chain: studionet, account }));
const reader = createClient({ chain: studionet });
const HOST = "github.com";
const BUDGET = 3_000_000_000_000_000n; // 0.003 GEN
const REVIEW_WINDOW = 180;

mkdirSync("verification", { recursive: true });
const reportPath = `verification/E2E_STUDIONET_${address.slice(-8).toLowerCase()}.json`;
const report = existsSync(reportPath)
  ? JSON.parse(readFileSync(reportPath))
  : { schema: "grantladder-e2e-v1", network: "studionet", contract: address,
      roles: { funder: funder.address, grantee: grantee.address, deployer_used: false },
      host: HOST, transactions: [], checks: [], started_at: new Date().toISOString() };
const save = () => writeFileSync(reportPath, JSON.stringify(report, (_, v) => (typeof v === "bigint" ? String(v) : v), 2) + "\n");
const read = (fn, args = []) => reader.readContract({ address, functionName: fn, args });
const check = (name, pass, detail = {}) => { report.checks.push({ name, pass: Boolean(pass), detail }); save(); if (!pass) throw Error("CHECK FAILED: " + name); console.log(pass ? "  ok  " : " FAIL ", name); };

function execution(tx) {
  if (tx.status !== "FINALIZED" && tx.status !== 7) throw Error("Not finalized");
  const receipts = tx.consensus_data?.leader_receipt || [];
  const last = [...receipts].reverse().find((x) => x.mode !== "validator") || receipts.at(-1);
  if (!last || last.execution_result !== "SUCCESS" || last.result?.status !== "return")
    throw Error(last?.result?.payload?.readable || "GenVM rejected");
  return JSON.parse(last.result.payload.readable);
}

async function tx(actorIdx, label, functionName, args = [], value = 0n, expected, gid) {
  const existing = report.transactions.find((x) => x.label === label);
  if (existing?.verified) return existing.result;
  const row = { label, actor: accounts[actorIdx].address, function: functionName, args: args.map(String), value: String(value) };
  report.transactions.push(row); save();
  console.log("→", label, functionName, JSON.stringify(args).slice(0, 80));
  const sent = await clients[actorIdx].writeContract({ address, functionName, args, value });
  row.hash = typeof sent === "string" ? sent : sent.txId; save();
  await reader.waitForTransactionReceipt({ hash: row.hash, status: TransactionStatus.FINALIZED, interval: 5000, retries: 240 });
  const receipt = await reader.getTransaction({ hash: row.hash });
  const result = execution(receipt);
  row.after = gid === undefined ? await read("get_config") : await read("get_grant", [gid]);
  check(`${label}: SUCCESS`, true);
  if (expected !== "ID") check(`${label}: result ${expected}`, result === expected, { actual: result });
  row.result = result; row.verified = true; save();
  return result;
}

async function waitUntil(unix, label) {
  if (Date.now() / 1000 >= unix) return;
  console.log("WAIT", label, new Date(unix * 1000).toISOString());
  while (Date.now() / 1000 < unix) await new Promise((r) => setTimeout(r, Math.min(15000, unix * 1000 - Date.now() + 500)));
}

try {
  const cfg = await read("get_config");
  check("deployed schema is grantladder-v1", cfg.schema === "grantladder-v1", cfg);

  if (report.gid === undefined) {
    const now = Math.floor(Date.now() / 1000);
    const terms = {
      title: "Open-source project milestone grant",
      grantee: grantee.address.toLowerCase(),
      allowed_host: HOST,
      tranches: [
        { criteria: "A public GitHub repository page that shows the repository name and a README or description identifying the project.", bps: 3000 },
        { criteria: "A public GitHub account profile page that shows the account name and its public repositories.", bps: 7000 },
      ],
      budget: Number(BUDGET),
      review_window: REVIEW_WINDOW,
      expires: now + 10800,
    };
    report.terms = terms;
    report.gid = await tx(0, "create grant", "create_grant", [JSON.stringify(terms)], 0n, "ID");
    save();
  }
  const gid = report.gid;
  await tx(0, "fund grant", "fund", [gid], BUDGET, "ACTIVE", gid);

  // Rung 0 — repository page → RELEASE.
  await tx(1, "rung0 submit", "submit_evidence", [gid, 0, "https://github.com/octocat/Hello-World"], 0n, "SUBMITTED", gid);
  const r0 = await tx(0, "rung0 assess", "assess", [gid, 0], 0n, "RELEASE", gid);
  check("rung0 released", r0 === "RELEASE");

  // Funder disputes rung0 before its claim window; validators re-assess and uphold.
  await tx(0, "rung0 dispute", "dispute", [gid, 0, "a".repeat(64)], 0n, "DISPUTED", gid);
  const r0b = await tx(0, "rung0 resolve", "resolve", [gid, 0], 0n, "RELEASE", gid);
  check("rung0 upheld on appeal", r0b === "RELEASE");

  // Rung 1 — profile page → RELEASE.
  await tx(1, "rung1 submit", "submit_evidence", [gid, 1, "https://github.com/octocat"], 0n, "SUBMITTED", gid);
  const r1 = await tx(0, "rung1 assess", "assess", [gid, 1], 0n, "RELEASE", gid);
  check("rung1 released", r1 === "RELEASE");

  const afterReleases = await read("get_grant", [gid]);
  check("both rungs released", afterReleases.tranches.every((t) => t.status === "RELEASED"), afterReleases.tranches.map((t) => t.status));
  const maxClaimable = Math.max(...afterReleases.tranches.map((t) => t.claimable_at));
  await waitUntil(maxClaimable + 5, "rung claim windows open");

  const balBefore = await reader.getBalance({ address: grantee.address });
  await tx(1, "grantee claim", "claim", [gid], 0n, "CLAIMED", gid);
  const balAfter = await reader.getBalance({ address: grantee.address });
  const v = await read("get_grant", [gid]);
  check("grantee paid full budget", BigInt(v.grantee_claimed) === BUDGET, { grantee_claimed: v.grantee_claimed });
  check("grantee wallet received funds", balAfter > balBefore, { delta: String(balAfter - balBefore) });
  check("value conservation", BigInt(v.held) + BigInt(v.grantee_claimed) + BigInt(v.funder_refunded) + BigInt(v.refund_pending) === BUDGET, v);

  report.finished_at = new Date().toISOString(); delete report.error; save();
  console.log("\nSEED COMPLETE →", reportPath, "grant id", gid);
} catch (e) { report.error = String(e); save(); console.error("SEED ERROR:", e.message); process.exit(1); }
