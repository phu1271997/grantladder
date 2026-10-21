import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function Home() {
  const navigate = useNavigate();
  const [id, setId] = useState("0");

  return (
    <>
      <section className="hero">
        <p className="eyebrow">EACH RUNG RELEASES ONLY ON PROVEN EVIDENCE</p>
        <h1>Fund milestones.<br /><em>Validators read the proof.</em> Release the rung.</h1>
        <p>
          Each tranche pays out only after GenLayer validators fetch the grantee's published evidence page on-chain
          and independently judge that it genuinely substantiates that milestone. No oracle, no trusted admin.
        </p>
        <div className="hero-cta">
          <div className="jump">
            <input type="number" min="0" value={id} onChange={(e) => setId(e.target.value)} aria-label="Grant id" />
            <button className="primary" onClick={() => navigate(`/grants/${Math.max(0, Number(id) || 0)}`)}>Inspect grant →</button>
          </div>
          <button onClick={() => navigate("/explorer")}>Browse the Explorer</button>
          <button onClick={() => navigate("/create")}>Create a grant</button>
        </div>
      </section>

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
    </>
  );
}
