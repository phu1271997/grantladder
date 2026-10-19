import { useEffect, useState } from "react";
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import type { CalldataEncodable, Hash } from "genlayer-js/types";
import {
  gen,
  pct,
  execution,
  normalizeTx,
  outcomeTone,
  parseSafeGEN,
  trancheTone,
  validAddress,
  validHost,
  urlInHost,
  type Grant,
} from "./protocol";

declare global {
  interface Window {
    ethereum?: { request: (x: { method: string; params?: unknown[] }) => Promise<unknown> };
  }
}

const reader = createClient({ chain: studionet });
const explorer = "https://explorer-studio.genlayer.com";
const deployedAddress = import.meta.env.VITE_CONTRACT_ADDRESS || "";
const CHAIN_ID_HEX = "0x" + studionet.id.toString(16);
const short = (x: string) => (x ? `${x.slice(0, 6)}…${x.slice(-4)}` : "Not connected");

async function ensureNetwork() {
  if (!window.ethereum) return;
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_ID_HEX }] });
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 4902 || code === -32603) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: CHAIN_ID_HEX,
          chainName: "GenLayer Studio Network",
          nativeCurrency: { name: "GEN Token", symbol: "GEN", decimals: 18 },
          rpcUrls: ["https://studio.genlayer.com/api"],
          blockExplorerUrls: [explorer],
        }],
      });
    } else throw err;
  }
}

export default function App() {
  const [address, setAddress] = useState(localStorage.getItem("grantladder-address") || deployedAddress);
  const [wallet, setWallet] = useState("");
  const [id, setId] = useState(0);
  const [g, setG] = useState<Grant>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("Connect a StudioNet wallet, or inspect any deployed grant below.");
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"ladder" | "create" | "rules">("ladder");

  const [title, setTitle] = useState("Docs + SDK public-goods grant");
  const [grantee, setGrantee] = useState("");
  const [host, setHost] = useState("github.com");
  const [budget, setBudget] = useState("0.003");
  const [ladder, setLadder] = useState(
    "3000 | A published page shows the project README with a quickstart and an MIT license.\n" +
      "3500 | A published release page lists a tagged v0.1 release with downloadable assets.\n" +
      "3500 | A published docs page documents the public API with at least three endpoints.",
  );
  const [evidenceUrl, setEvidenceUrl] = useState("");

  const connect = async () => {
    if (!window.ethereum) throw Error("Install a compatible wallet extension (e.g. MetaMask).");
    await ensureNetwork();
    const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
    setWallet(accounts[0]?.toLowerCase() || "");
    setNotice("Wallet connected on StudioNet. Sync authoritative grant state.");
  };

  const sync = async (selectedId = id) => {
    if (!validAddress(address)) throw Error("Enter a deployed StudioNet contract address.");
    const cfg = await reader.readContract({ address: address as `0x${string}`, functionName: "get_config", args: [] });
    if ((cfg as { schema?: string }).schema !== "grantladder-v1") throw Error("Address is not a GrantLadder contract.");
    const v = await reader.readContract({ address: address as `0x${string}`, functionName: "get_grant", args: [selectedId] });
    setG(v as Grant);
    localStorage.setItem("grantladder-address", address);
    setNotice("Authoritative grant state loaded.");
  };

  const write = async (method: string, args: CalldataEncodable[], value?: bigint) => {
    if (!window.ethereum || !wallet || !validAddress(address)) throw Error("Connect a wallet and sync a deployed contract first.");
    setBusy(true);
    setError("");
    try {
      await ensureNetwork();
      const client = createClient({ chain: studionet, account: wallet as `0x${string}`, provider: window.ethereum });
      const raw = await client.writeContract({ address: address as `0x${string}`, functionName: method, args, value: value ?? 0n });
      const hash = normalizeTx(raw) as Hash;
      const slow = method === "assess" || method === "resolve";
      setNotice(`Submitted ${method}. ${slow ? "Validators are fetching the evidence page and voting — this takes longer than a normal transaction." : "Waiting for acceptance…"} ${hash}`);
      await reader.waitForTransactionReceipt({ hash, status: TransactionStatus.ACCEPTED, retries: 100, interval: 3000 });
      setNotice(`Accepted ${method}. Waiting for finalization… ${hash}`);
      await reader.waitForTransactionReceipt({ hash, status: TransactionStatus.FINALIZED, retries: 100, interval: 3000 });
      const tx = await reader.getTransaction({ hash });
      const result = execution(tx);
      const selectedId = method === "create_grant" ? Number(result) : id;
      if (method === "create_grant") setId(selectedId);
      await sync(selectedId);
      setNotice(`${method} finalized; authoritative state re-read. ${hash}`);
      return { hash, result };
    } finally {
      setBusy(false);
    }
  };

  const safe = (fn: () => Promise<unknown>) =>
    fn().catch((e) => setError(e instanceof Error ? e.message : String(e)));

  const create = async () => {
    const wei = parseSafeGEN(budget);
    const tranches = ladder.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
      const [bps, ...rest] = l.split("|");
      return { bps: Number(bps.trim()), criteria: rest.join("|").trim() };
    });
    const now = Math.floor(Date.now() / 1000);
    const terms = { title, grantee: grantee.toLowerCase(), allowed_host: host, tranches, budget: wei, review_window: 300, expires: now + 10800 };
    await write("create_grant", [JSON.stringify(terms)]);
    setTab("ladder");
  };

  useEffect(() => {
    if (validAddress(address)) safe(() => sync());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const phase = g?.phase || "NO GRANT";
  const now = Math.floor(Date.now() / 1000);
  const isGrantee = !!g && wallet === g.terms.grantee.toLowerCase();
  const isFunder = !!g && wallet === g.funder;
  const claimable = g ? g.tranches.some((t) => t.status === "RELEASED" && now >= t.claimable_at && isGrantee) || (isFunder && g.refund_pending > 0) : false;

  return (
    <>
      <header>
        <div className="brand">
          <span className="mark" aria-hidden />
          <div>
            <b>GRANTLADDER</b>
            <span>MILESTONE GRANTS, VERIFIED</span>
          </div>
        </div>
        <nav>
          <button onClick={() => setTab("ladder")} className={tab === "ladder" ? "active" : ""}>Ladder</button>
          <button onClick={() => setTab("create")} className={tab === "create" ? "active" : ""}>New grant</button>
          <button onClick={() => setTab("rules")} className={tab === "rules" ? "active" : ""}>How it judges</button>
        </nav>
        <button className="connect" onClick={() => safe(connect)}>{wallet ? short(wallet) : "Connect wallet"}</button>
      </header>

      <main>
        <section className="hero">
          <div>
            <p className="eyebrow">EACH RUNG RELEASES ONLY ON PROVEN EVIDENCE</p>
            <h1>Fund milestones.<br /><em>Validators read the proof.</em> Release the rung.</h1>
            <p>
              Each tranche pays out only after GenLayer validators fetch the grantee's published evidence page on-chain
              and independently judge that it genuinely substantiates that milestone. No oracle, no trusted admin.
            </p>
          </div>
        </section>

        <section className="contract">
          <label>ACTIVE CONTRACT
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x… deployed StudioNet address" />
          </label>
          <label>GRANT ID
            <input type="number" min="0" value={id} onChange={(e) => setId(Number(e.target.value))} />
          </label>
          <button onClick={() => safe(() => sync())}>Sync state</button>
          {validAddress(address) && <a href={`${explorer}/address/${address}`} target="_blank" rel="noreferrer">Explorer ↗</a>}
        </section>

        {error && <div className="alert error">{error}</div>}
        <div className="alert">{notice}</div>

        {tab === "ladder" && (
          <section className="grant">
            <div className="grant-head">
              <div>
                <p className="eyebrow">GRANT #{id} · {phase}</p>
                <h2>{g?.terms.title || "No grant loaded"}</h2>
              </div>
              {g && (
                <div className="totals">
                  <span>budget {gen(g.terms.budget)}</span>
                  <span>held {gen(g.held)}</span>
                  <span>paid {gen(g.grantee_claimed)}</span>
                  <span>refunded {gen(g.funder_refunded)}</span>
                </div>
              )}
            </div>

            {g ? (
              <>
                <div className="facts">
                  <div><small>Grantee</small><b>{short(g.terms.grantee)}</b></div>
                  <div><small>Evidence host</small><b>{g.terms.allowed_host}</b></div>
                  <div><small>Current rung</small><b>{g.cursor >= g.tranches.length ? "complete" : `#${g.cursor + 1} of ${g.tranches.length}`}</b></div>
                  <div><small>Your role</small><b>{isFunder ? "Funder" : isGrantee ? "Grantee" : wallet ? "Observer" : "—"}</b></div>
                </div>

                {phase === "DRAFT" && (
                  <button className="primary wide" disabled={busy || !isFunder}
                    onClick={() => safe(() => write("fund", [id], BigInt(g.terms.budget)))}>
                    Fund exact budget {gen(g.terms.budget)}
                  </button>
                )}

                <ol className="rungs">
                  {g.tranches.map((t, i) => {
                    const active = i === g.cursor && phase === "ACTIVE";
                    const v = t.verdict?.result;
                    return (
                      <li key={i} className={`rung ${trancheTone(t.status)} ${active ? "active" : ""}`}>
                        <div className="rung-top">
                          <b>Rung {i + 1} · {pct(t.bps)} · {gen(t.amount)}</b>
                          <span className={`status ${t.status.toLowerCase()}`}>{t.status}</span>
                        </div>
                        <p className="crit">{t.criteria}</p>
                        {t.evidence && <a className="ev" href={t.evidence.url} target="_blank" rel="noreferrer">{t.evidence.url} ↗</a>}
                        {v && <div className={`verdict ${outcomeTone(v.outcome)}`}><b>{v.outcome}</b><span>confidence {v.confidence}</span></div>}
                        {active && (
                          <div className="rung-actions">
                            {t.status === "PENDING" && isGrantee && (
                              <>
                                <input value={evidenceUrl} onChange={(e) => setEvidenceUrl(e.target.value)}
                                  placeholder={`https://${g.terms.allowed_host}/…`} />
                                <button disabled={busy || !urlInHost(evidenceUrl, g.terms.allowed_host)}
                                  onClick={() => safe(() => write("submit_evidence", [id, i, evidenceUrl]))}>Submit evidence</button>
                              </>
                            )}
                            {t.status === "SUBMITTED" && (
                              <button disabled={busy} onClick={() => safe(() => write("assess", [id, i]))}>Assess evidence</button>
                            )}
                          </div>
                        )}
                        {t.status === "RELEASED" && now < t.claimable_at && (
                          <div className="rung-actions">
                            <span className="hint">Claimable after the dispute window ({new Date(t.claimable_at * 1000).toLocaleTimeString()}).</span>
                            <button disabled={busy || !isFunder} onClick={() => safe(() => write("dispute", [id, i, "0".repeat(64)]))}>Dispute release</button>
                          </div>
                        )}
                        {t.status === "DISPUTED" && (
                          <div className="rung-actions">
                            <button disabled={busy} onClick={() => safe(() => write("resolve", [id, i]))}>Re-assess disputed rung</button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>

                <div className="actions">
                  <button className="primary" disabled={busy || !claimable}
                    onClick={() => safe(() => write("claim", [id]))}>Claim available funds</button>
                  <button disabled={busy || now < g.terms.expires || phase === "CLOSED"}
                    onClick={() => safe(() => write("recover_expired", [id]))}>Recover unreleased (after expiry)</button>
                </div>
              </>
            ) : (
              <div className="empty">Paste a deployed contract, choose an ID, and sync.</div>
            )}
          </section>
        )}

        {tab === "create" && (
          <section className="form">
            <p className="eyebrow">NEW MILESTONE LADDER</p>
            <h2>Define the rungs and seal them.</h2>
            <div className="grid">
              <label>Grant title<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
              <label>Grantee wallet<input value={grantee} onChange={(e) => setGrantee(e.target.value)} placeholder="0x…" /></label>
              <label>Allowed evidence host<input value={host} onChange={(e) => setHost(e.target.value)} /></label>
              <label>Total budget · GEN<input value={budget} onChange={(e) => setBudget(e.target.value)} /></label>
            </div>
            <label>Rungs · one per line as <code>bps | criterion</code> (bps must sum to 10000)
              <textarea rows={6} value={ladder} onChange={(e) => setLadder(e.target.value)} />
            </label>
            <button className="primary" disabled={busy || !wallet || !validAddress(grantee) || !validHost(host)}
              onClick={() => safe(create)}>Create grant ladder →</button>
            <p className="fine">
              Creation deposits nothing. The creating wallet becomes the funder; the grantee is sealed into immutable terms.
              The deployer receives no role.
            </p>
          </section>
        )}

        {tab === "rules" && (
          <section className="rules">
            <p className="eyebrow">EVIDENCE, NOT PROMISES</p>
            <h2>What GrantLadder releases on.</h2>
            <div className="rule-grid">
              <article><b>01 · Published proof</b><p>Each rung needs a public page on the sealed host. Validators fetch it on-chain with no oracle.</p></article>
              <article><b>02 · Substantiation</b><p>An LLM decides whether the page genuinely demonstrates the milestone. A low-confidence pass is downgraded to REVISE by the contract.</p></article>
              <article><b>03 · Sequential rungs</b><p>Rung N+1 opens only after rung N is released or rejected. Evidence URLs are single-use.</p></article>
              <article><b>04 · Funder appeal</b><p>A release is claimable only after a dispute window; the funder can dispute and force a validator re-assessment.</p></article>
            </div>
            <div className="scope">
              <b>Explicit boundary</b>
              <p>A released rung proves the evidence page substantiated the milestone when fetched. It does not audit code quality, security, or long-term maintenance.</p>
            </div>
          </section>
        )}
      </main>

      <footer>
        <span>StudioNet · GenLayer Intelligent Contract</span>
        <span>Deployer has no operator privilege</span>
      </footer>
    </>
  );
}
