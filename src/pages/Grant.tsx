import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { loadConfig, useChain } from "../lib/chain";
import { gen, outcomeTone, pct, trancheTone, urlInHost, validAddress, type Grant as G } from "../protocol";

export default function Grant() {
  const { id: idParam } = useParams();
  const navigate = useNavigate();
  const { reader, address, wallet, busy, write, setError } = useChain();
  const id = Math.max(0, Number(idParam ?? 0) || 0);
  const [g, setG] = useState<G>();
  const [state, setState] = useState<"idle" | "loading" | "notfound" | "error">("loading");
  const [evidenceUrl, setEvidenceUrl] = useState("");

  const load = useCallback(async () => {
    if (!validAddress(address)) { setState("error"); setError("Set a deployed StudioNet contract address above."); return; }
    setState("loading");
    try {
      const cfg = await loadConfig(reader, address);
      if (id >= Number(cfg.count ?? 0)) { setState("notfound"); setG(undefined); return; }
      const v = (await reader.readContract({ address: address as `0x${string}`, functionName: "get_grant", args: [id] })) as G;
      setG(v); setState("idle");
    } catch (e) {
      setState("error"); setError(e instanceof Error ? e.message : String(e));
    }
  }, [reader, address, id, setError]);

  useEffect(() => { load(); }, [load]);

  const act = async (method: string, args: (string | number)[], value?: bigint, slow = false) => {
    try { await write(method, args, value, slow); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  if (state === "loading") return <section className="grant"><div className="empty">Loading grant #{id}…</div></section>;
  if (state === "error") return <section className="grant"><div className="empty">Could not load. Check the contract address above. <button onClick={load}>Retry</button></div></section>;
  if (state === "notfound" || !g)
    return (
      <section className="grant">
        <div className="empty">No grant #{id} on this contract.
          <div style={{ marginTop: 12 }}><button onClick={() => navigate("/explorer")}>Open the Explorer</button> <button onClick={() => navigate("/create")}>Create one</button></div>
        </div>
      </section>
    );

  const phase = g.phase;
  const now = Math.floor(Date.now() / 1000);
  const isGrantee = wallet === g.terms.grantee.toLowerCase();
  const isFunder = wallet === g.funder;
  const claimable = g.tranches.some((t) => t.status === "RELEASED" && now >= t.claimable_at && isGrantee) || (isFunder && g.refund_pending > 0);

  return (
    <section className="grant">
      <div className="grant-head">
        <div>
          <p className="eyebrow">GRANT #{id} · {phase}</p>
          <h2>{g.terms.title}</h2>
        </div>
        <div className="totals">
          <span>budget {gen(g.terms.budget)}</span>
          <span>held {gen(g.held)}</span>
          <span>paid {gen(g.grantee_claimed)}</span>
          <span>refunded {gen(g.funder_refunded)}</span>
        </div>
      </div>

      <div className="facts">
        <div><small>Grantee</small><b>{g.terms.grantee.slice(0, 6)}…{g.terms.grantee.slice(-4)}</b></div>
        <div><small>Evidence host</small><b>{g.terms.allowed_host}</b></div>
        <div><small>Current rung</small><b>{g.cursor >= g.tranches.length ? "complete" : `#${g.cursor + 1} of ${g.tranches.length}`}</b></div>
        <div><small>Your role</small><b>{isFunder ? "Funder" : isGrantee ? "Grantee" : wallet ? "Observer" : "—"}</b></div>
      </div>

      {phase === "DRAFT" && (
        <button className="primary wide" disabled={busy || !isFunder} onClick={() => act("fund", [id], BigInt(g.terms.budget))}>
          Fund exact budget {gen(g.terms.budget)}
        </button>
      )}

      <ol className="rungs">
        {g.tranches.map((t, i) => {
          const activeRung = i === g.cursor && phase === "ACTIVE";
          const v = t.verdict?.result;
          return (
            <li key={i} className={`rung ${trancheTone(t.status)} ${activeRung ? "active" : ""}`}>
              <div className="rung-top">
                <b>Rung {i + 1} · {pct(t.bps)} · {gen(t.amount)}</b>
                <span className={`status ${t.status.toLowerCase()}`}>{t.status}</span>
              </div>
              <p className="crit">{t.criteria}</p>
              {t.evidence && <a className="ev" href={t.evidence.url} target="_blank" rel="noreferrer">{t.evidence.url} ↗</a>}
              {v && <div className={`verdict ${outcomeTone(v.outcome)}`}><b>{v.outcome}</b><span>confidence {v.confidence}</span></div>}
              {activeRung && (
                <div className="rung-actions">
                  {t.status === "PENDING" && isGrantee && (
                    <>
                      <input value={evidenceUrl} onChange={(e) => setEvidenceUrl(e.target.value)} placeholder={`https://${g.terms.allowed_host}/…`} />
                      <button disabled={busy || !urlInHost(evidenceUrl, g.terms.allowed_host)} onClick={() => act("submit_evidence", [id, i, evidenceUrl])}>Submit evidence</button>
                    </>
                  )}
                  {t.status === "PENDING" && !isGrantee && <span className="hint">Waiting for the grantee to submit evidence.</span>}
                  {t.status === "SUBMITTED" && <button disabled={busy} onClick={() => act("assess", [id, i], 0n, true)}>Assess evidence</button>}
                </div>
              )}
              {t.status === "RELEASED" && now < t.claimable_at && (
                <div className="rung-actions">
                  <span className="hint">Claimable after the dispute window ({new Date(t.claimable_at * 1000).toLocaleTimeString()}).</span>
                  <button disabled={busy || !isFunder} onClick={() => act("dispute", [id, i, "0".repeat(64)])}>Dispute release</button>
                </div>
              )}
              {t.status === "DISPUTED" && <div className="rung-actions"><button disabled={busy} onClick={() => act("resolve", [id, i], 0n, true)}>Re-assess disputed rung</button></div>}
            </li>
          );
        })}
      </ol>

      <div className="actions">
        <button className="primary" disabled={busy || !claimable} onClick={() => act("claim", [id])}>Claim available funds</button>
        <button disabled={busy || now < g.terms.expires || phase === "CLOSED"} onClick={() => act("recover_expired", [id])}>Recover unreleased (after expiry)</button>
        <button className="ghost" onClick={load} disabled={busy}>↻ Refresh state</button>
      </div>
      {!wallet && <p className="fine">Read-only — connect a wallet to act on this grant.</p>}

      <div className="pager">
        <button disabled={id === 0} onClick={() => navigate(`/grants/${id - 1}`)}>← grant #{id - 1}</button>
        <button onClick={() => navigate(`/grants/${id + 1}`)}>grant #{id + 1} →</button>
      </div>
    </section>
  );
}
