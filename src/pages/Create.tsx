import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useChain } from "../lib/chain";
import { parseSafeGEN, validAddress, validHost } from "../protocol";

export default function Create() {
  const { wallet, busy, write, setError } = useChain();
  const navigate = useNavigate();
  const [title, setTitle] = useState("Docs + SDK public-goods grant");
  const [grantee, setGrantee] = useState("");
  const [host, setHost] = useState("github.com");
  const [budget, setBudget] = useState("0.003");
  const [ladder, setLadder] = useState(
    "3000 | A published page shows the project README with a quickstart and an MIT license.\n" +
      "3500 | A published release page lists a tagged v0.1 release with downloadable assets.\n" +
      "3500 | A published docs page documents the public API with at least three endpoints.",
  );

  const submit = async () => {
    try {
      const tranches = ladder.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
        const [bps, ...rest] = l.split("|");
        return { bps: Number(bps.trim()), criteria: rest.join("|").trim() };
      });
      const now = Math.floor(Date.now() / 1000);
      const terms = { title, grantee: grantee.toLowerCase(), allowed_host: host, tranches, budget: parseSafeGEN(budget), review_window: 300, expires: now + 10800 };
      const { result } = await write("create_grant", [JSON.stringify(terms)]);
      navigate(`/grants/${Number(result)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const sum = ladder.split("\n").map((l) => Number(l.split("|")[0]?.trim())).filter((n) => !Number.isNaN(n)).reduce((a, b) => a + b, 0);

  return (
    <section className="form">
      <p className="eyebrow">NEW MILESTONE LADDER</p>
      <h2>Define the rungs and seal them.</h2>
      <div className="grid">
        <label>Grant title<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label>Grantee wallet<input value={grantee} onChange={(e) => setGrantee(e.target.value)} placeholder="0x…" /></label>
        <label>Allowed evidence host<input value={host} onChange={(e) => setHost(e.target.value)} /></label>
        <label>Total budget · GEN<input value={budget} onChange={(e) => setBudget(e.target.value)} /></label>
      </div>
      <label>Rungs · one per line as <code>bps | criterion</code> (bps must sum to 10000; currently {sum})
        <textarea rows={6} value={ladder} onChange={(e) => setLadder(e.target.value)} />
      </label>
      <button className="primary" disabled={busy || !wallet || !validAddress(grantee) || !validHost(host) || sum !== 10000} onClick={submit}>
        {busy ? "Working…" : "Create grant ladder →"}
      </button>
      {!wallet && <p className="fine">Connect a wallet to create a grant.</p>}
      <p className="fine">
        Creation deposits nothing. The creating wallet becomes the funder; the grantee is sealed into immutable terms.
        The deployer receives no role.
      </p>
    </section>
  );
}
