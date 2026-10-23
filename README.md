# GrantLadder

**A multi-tranche grant escrow that releases each milestone only after GenLayer validators fetch the grantee's published evidence page on-chain and independently judge that it genuinely substantiates that milestone.**

- Network: **GenLayer StudioNet** (hosted GenLayer Studio) — status is *Preview*.
- Live contract: `0xAfa46288bdbB6b09E2B1A5247aE4d5CeEA17D189`
- Explorer: https://explorer-studio.genlayer.com/address/0xAfa46288bdbB6b09E2B1A5247aE4d5CeEA17D189
- Live app: see the project's Vercel deployment (URL in the repo's Deployments).

## Why this needs GenLayer

A grant milestone is a **subjective call** — *does the published deliverable actually substantiate what was promised?* — made over **unstructured public evidence** that a contract must read itself. GrantLadder does both inside the Intelligent Contract: `gl.nondet.web.render` fetches the sealed evidence page with no oracle, `gl.nondet.exec_prompt` judges it against the milestone criterion, and `gl.vm.run_nondet` makes independent validators converge on the release/no-release decision. Strip out the web-fetch and the LLM and the "grant" collapses into blind time-locked transfers.

## What makes it a ladder

A grant has **1–4 sequential tranches**, each with its own `bps` share (summing to 10000) and its own sealed criterion. Tranche *N+1* opens only after tranche *N* is released or rejected. Each tranche is evidenced and judged independently, and every evidence URL is single-use (`used_evidence`). This is a different economic machine from a single-shot milestone bounty.

## Lifecycle

```
DRAFT → ACTIVE ─ per tranche: PENDING → SUBMITTED → RELEASED ─┬→ DISPUTED → resolve → RELEASED/REJECTED
                                             │                └→ claim (after dispute window)
                                             ├→ REVISE (resubmit)
                                             └→ REJECT (skip rung)
past expiry → CLOSED → funder recovers the unreleased remainder
```

`RELEASE`, `REVISE`, `REJECT`, `EVIDENCE_UNAVAILABLE` are bounded verdicts. **Contract code maps them to money**, not the model. A `RELEASE` returned with confidence below 70 is deterministically downgraded to `REVISE`. A released tranche is only *claimable* after its dispute window (`released_at + review_window`), during which **only the funder** may `dispute` and force a validator re-assessment. A validly-filed dispute stays resolvable even past `expires` (the window already closed before expiry), so funds are never stranded. On re-assessment, only a **definitive `REJECT`** claws the credit back to the funder's refund; a `REVISE` or `EVIDENCE_UNAVAILABLE` is ambiguous or transient and keeps the tranche `DISPUTED` and retryable rather than permanently rejecting and zeroing it.

## Consensus design (Axis 2)

The non-deterministic block fetches the evidence page, then an LLM judges substantiation and returns `{outcome, confidence}`. Consensus is on the **meaning** — whether the tranche is released — not on a byte-identical page image, which varies between fetches:

```python
def validator(proposal):
    if not isinstance(proposal, gl.vm.Return):
        return False
    return proposal.calldata["result"]["outcome"] == observe()["result"]["outcome"]
```

Wrong host, fetch failure, non-200/oversize page, malformed or out-of-vocabulary LLM JSON, or an invalid confidence all fail closed with no release.

## Repository layout

```
contracts/Contract.py   # the Intelligent Contract (schema grantladder-v1)
src/                    # Vite + React + genlayer-js frontend (the funding ladder)
tests/test_contract.py  # gltest Direct-Mode suite (happy path + edge cases)
scripts/deploy.mjs      # StudioNet deployment
scripts/live.mjs        # funder+grantee end-to-end / seeding run
```

## Local verification

```bash
npm install --legacy-peer-deps
python3 -m pip install genlayer-test
python3 -m pytest tests -q        # 15 Direct-Mode tests
npm run test                      # frontend unit tests
npm run build                     # typecheck + production build
```

## Deploy to StudioNet

```bash
source ~/.genlayer/env.sh          # exports GENLAYER_PRIVATE_KEY
npm run deploy                     # prints the deployed address + get_config
```

Then set `VITE_CONTRACT_ADDRESS` in `.env` and on Vercel, and redeploy the frontend.

## End-to-end / seeding

`scripts/live.mjs` drives a full two-rung grant from two already-funded wallets (funder + grantee, never the deployer): both rungs released on real published evidence, the first rung disputed and upheld on validator re-assessment, then claimed. Keys come from `~/.genlayer/env.sh`; never commit private keys.

## Frontend

```bash
npm run dev
```

MetaMask signs; `createClient({ chain: studionet, account: userAddress })` — no secret ships in the bundle. On connect the app switches/adds the GenLayer Studio network. Assess and re-assess transactions show an explicit "validators are fetching the evidence page and voting" waiting state, and each rung renders its verdict, confidence, evidence link, and status.

### Routes

The UI is split across dedicated routes (react-router), not one page:

- `/` — overview + how it judges
- `/grants/:id` — the funding ladder: per-rung submit / assess / dispute / resolve / claim
- `/create` — define and seal a new grant ladder
- `/explorer` — every grant on the contract, read live from StudioNet, with completed ladders, released rungs, and amounts claimed

Each page has explicit loading / not-found / error states. `npm run e2e` drives the production build in headless Chrome against live StudioNet state (home, Explorer, ladder detail, not-found, create — 6 checks).
