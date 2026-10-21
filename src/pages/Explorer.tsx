import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { explorer, loadConfig, useChain } from "../lib/chain";
import { gen, validAddress, type Grant as G } from "../protocol";

const isComplete = (g: G) => g.phase === "CLOSED" || g.cursor >= g.tranches.length;

export default function Explorer() {
  const { reader, address } = useChain();
  const [rows, setRows] = useState<G[]>([]);
  const [count, setCount] = useState(0);
  const [state, setState] = useState<"idle" | "loading" | "error">("loading");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    if (!validAddress(address)) { setState("error"); setMsg("Set a deployed StudioNet contract address above."); return; }
    setState("loading"); setMsg("");
    try {
      const cfg = await loadConfig(reader, address);
      const n = Number(cfg.count ?? 0);
      setCount(n);
      const ids = Array.from({ length: Math.min(n, 60) }, (_, i) => n - 1 - i).filter((i) => i >= 0);
      const loaded = await Promise.all(ids.map((i) =>
        reader.readContract({ address: address as `0x${string}`, functionName: "get_grant", args: [i] }).catch(() => null)));
      setRows(loaded.filter(Boolean) as G[]);
      setState("idle");
    } catch (e) {
      setState("error"); setMsg(e instanceof Error ? e.message : String(e));
    }
  }, [reader, address]);

  useEffect(() => { load(); }, [load]);

  const complete = rows.filter(isComplete);
  const active = rows.filter((g) => !isComplete(g));

  const Row = (g: G) => {
    const released = g.tranches.filter((t) => t.status === "RELEASED" || t.status === "CLAIMED").length;
    const claimed = Number(g.grantee_claimed);
    return (
      <Link to={`/grants/${g.id}`} className="xrow" key={g.id}>
        <span className="xid">#{g.id}</span>
        <span className="xtitle">{g.terms.title}</span>
        <span className={`status ${g.phase.toLowerCase()}`}>{g.phase}</span>
        <span className="xoutcome good">{released}/{g.tranches.length} rungs</span>
        <span className="xmoney">{claimed ? `claimed ${gen(claimed)}` : gen(g.terms.budget)}</span>
      </Link>
    );
  };

  return (
    <section className="explorer">
      <div className="explorer-head">
        <div>
          <p className="eyebrow">ON-CHAIN ACTIVITY</p>
          <h2>Explorer</h2>
          <p className="sub">Every grant on this contract, read live from StudioNet. Each rung's release is a validator-consensus verdict, not a GrantLadder server decision.</p>
        </div>
        <div className="explorer-actions">
          <button onClick={load} disabled={state === "loading"}>↻ Refresh</button>
          {validAddress(address) && <a href={`${explorer}/address/${address}`} target="_blank" rel="noreferrer">Contract on Explorer ↗</a>}
        </div>
      </div>

      {state === "loading" && <div className="empty">Reading on-chain state…</div>}
      {state === "error" && <div className="empty">{msg} <button onClick={load}>Retry</button></div>}

      {state === "idle" && (
        <>
          <div className="xstats">
            <div><b>{count}</b><small>total grants</small></div>
            <div><b>{complete.length}</b><small>fully processed ladders</small></div>
            <div><b>{rows.reduce((a, g) => a + g.tranches.filter((t) => t.status === "RELEASED" || t.status === "CLAIMED").length, 0)}</b><small>rungs released</small></div>
          </div>

          {rows.length === 0 && <div className="empty">No grants yet on this contract.</div>}

          {complete.length > 0 && (<><h3 className="xsection">Completed ladders</h3><div className="xtable">{complete.map(Row)}</div></>)}
          {active.length > 0 && (<><h3 className="xsection">In progress</h3><div className="xtable">{active.map(Row)}</div></>)}
          {count > rows.length && <p className="fine">Showing the most recent {rows.length} of {count}.</p>}
        </>
      )}
    </section>
  );
}
