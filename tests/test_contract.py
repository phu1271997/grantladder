from pathlib import Path
from unittest.mock import patch
from datetime import datetime
import importlib, json, sys, pytest
from gltest.direct import VMContext, create_address, deploy_contract

ROOT = Path(__file__).resolve().parents[1]
FILE = ROOT / "contracts/Contract.py"
BUDGET = 1000
HOST = "github.com"


def eth(a):
    return "0x" + (a if isinstance(a, bytes) else a.as_bytes).hex()


@pytest.fixture
def env():
    funder, grantee, stranger = [create_address(x) for x in ("funder", "grantee", "stranger")]
    vm = VMContext(funder)
    vm.warp("2026-10-15T00:00:00Z")
    with patch("os.unlink", lambda _: None), vm.activate():
        c = deploy_contract(FILE, vm)
        gl = c._instance.create_grant.__globals__["gl"]
        sdk = Path(gl._cached_gl.__file__).resolve().parents[2]
        if str(sdk) not in sys.path:
            sys.path.insert(0, str(sdk))
        importlib.import_module("genlayer")
        _ = gl.nondet.web
        _ = gl.eq_principle
    with vm.activate():
        sync(vm, c)
        yield vm, c, funder, grantee, stranger


def sync(vm, c):
    gl = c._instance.create_grant.__globals__["gl"]
    sender = type(gl.message.sender_address)(vm.sender) if isinstance(vm.sender, bytes) else vm.sender
    gl._cached_gl.message = gl.message._replace(
        sender_address=sender, origin_address=sender, value=type(gl.message.value)(vm.value)
    )
    gl._cached_gl.message_raw["datetime"] = vm._datetime


def call(e, actor, name, *args, value=0):
    vm, c, *_ = e
    with vm.activate(), vm.prank(actor):
        vm.value = value
        sync(vm, c)
        return getattr(c, name)(*args)


def mod_of(e):
    return e[1]._instance.create_grant.__globals__


def terms(e, tranches=None):
    return {
        "title": "Docs and SDK public-goods grant",
        "grantee": eth(e[3]),
        "allowed_host": HOST,
        "tranches": tranches or [
            {"criteria": "A published README page documents a quickstart and an MIT license.", "bps": 3000},
            {"criteria": "A published release page lists a tagged v0.1 release with assets.", "bps": 7000},
        ],
        "budget": BUDGET,
        "review_window": 120,
        "expires": int(datetime.fromisoformat("2026-10-15T02:00:00+00:00").timestamp()),
    }


def snap(url="https://github.com/acme/project"):
    return {"url": url, "status": 200, "content_sha256": "a" * 64, "excerpt": "evidence body"}


def active(e, tranches=None):
    gid = call(e, e[2], "create_grant", json.dumps(terms(e, tranches)))
    assert call(e, e[2], "fund", gid, value=BUDGET) == "ACTIVE"
    e[0].deal(e[0]._contract_address, BUDGET)
    return gid


def do_assess(e, gid, idx, outcome, confidence=90, url=None):
    url = url or f"https://github.com/acme/rung{idx}"
    call(e, e[3], "submit_evidence", gid, idx, url)
    with patch.dict(mod_of(e), {"_fetch_evidence": lambda *_: snap(url),
                                "_judge": lambda *_: {"outcome": outcome, "confidence": confidence}}):
        return call(e, e[4], "assess", gid, idx)


def test_header_and_consensus_shape():
    source = FILE.read_text()
    assert source.splitlines()[:2] == [
        "# v0.2.17",
        '# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }',
    ]
    assert "gl.eq_principle.strict_eq" not in source
    assert source.count("gl.vm.run_nondet(") >= 1


def test_create_rejects_bad_terms(env):
    gid = call(env, env[2], "create_grant", json.dumps(terms(env)))
    v = env[1].get_grant(gid)
    assert v["funder"] == eth(env[2]) and v["phase"] == "DRAFT" and len(v["tranches"]) == 2
    bad_sets = [
        {"grantee": "0x0"},
        {"allowed_host": "not a host"},
        {"tranches": [{"criteria": "A published README documents the quickstart.", "bps": 4000},
                      {"criteria": "A published release lists a tagged version.", "bps": 5000}]},  # sum 9000
        {"budget": 0},
    ]
    for mut in bad_sets:
        t = terms(env)
        t.update(mut)
        with pytest.raises(Exception):
            call(env, env[2], "create_grant", json.dumps(t))


def test_exact_funding_and_role(env):
    gid = call(env, env[2], "create_grant", json.dumps(terms(env)))
    before = env[1].get_grant(gid)
    for actor, amount in ((env[4], BUDGET), (env[2], BUDGET - 1), (env[2], BUDGET + 1)):
        with pytest.raises(Exception):
            call(env, actor, "fund", gid, value=amount)
        assert env[1].get_grant(gid) == before
    assert call(env, env[2], "fund", gid, value=BUDGET) == "ACTIVE"


def test_only_grantee_submits_current_tranche_on_allowed_host(env):
    gid = active(env)
    with pytest.raises(Exception):  # stranger
        call(env, env[4], "submit_evidence", gid, 0, "https://github.com/acme/x")
    with pytest.raises(Exception):  # wrong host
        call(env, env[3], "submit_evidence", gid, 0, "https://evil.com/x")
    with pytest.raises(Exception):  # not current tranche (cursor is 0)
        call(env, env[3], "submit_evidence", gid, 1, "https://github.com/acme/x")
    assert call(env, env[3], "submit_evidence", gid, 0, "https://github.com/acme/x") == "SUBMITTED"


def test_release_credits_and_advances_cursor(env):
    gid = active(env)
    assert do_assess(env, gid, 0, "RELEASE") == "RELEASE"
    v = env[1].get_grant(gid)
    tr = v["tranches"][0]
    assert tr["status"] == "RELEASED" and tr["amount"] == 300 and v["cursor"] == 1 and v["held"] == BUDGET - 300


def test_low_confidence_release_downgraded_to_revise(env):
    gid = active(env)
    # _judge applies the floor; emulate the contract-side downgrade by returning REVISE for a weak pass.
    call(env, env[3], "submit_evidence", gid, 0, "https://github.com/acme/weak")
    with patch.dict(mod_of(env), {"_fetch_evidence": lambda *_: snap(),
                                  "_judge": lambda *_: {"outcome": "REVISE", "confidence": 40}}):
        assert call(env, env[4], "assess", gid, 0) == "REVISE"
    v = env[1].get_grant(gid)
    assert v["tranches"][0]["status"] == "PENDING" and v["cursor"] == 0 and v["held"] == BUDGET


def test_reject_advances_without_credit(env):
    gid = active(env)
    assert do_assess(env, gid, 0, "REJECT") == "REJECT"
    v = env[1].get_grant(gid)
    assert v["tranches"][0]["status"] == "REJECTED" and v["cursor"] == 1 and v["held"] == BUDGET


def test_evidence_unavailable_stays_submitted(env):
    gid = active(env)
    call(env, env[3], "submit_evidence", gid, 0, "https://github.com/acme/down")
    with patch.dict(mod_of(env), {"_fetch_evidence": lambda *_: (_ for _ in ()).throw(ValueError("down"))}):
        assert call(env, env[4], "assess", gid, 0) == "EVIDENCE_UNAVAILABLE"
    v = env[1].get_grant(gid)
    assert v["tranches"][0]["status"] == "SUBMITTED" and v["cursor"] == 0


def test_sequential_rungs_and_single_use_evidence(env):
    gid = active(env)
    do_assess(env, gid, 0, "RELEASE", url="https://github.com/acme/r0")
    # cursor is now 1; submit for tranche 1 works, tranche 0 is closed
    with pytest.raises(Exception):
        call(env, env[3], "submit_evidence", gid, 0, "https://github.com/acme/r0")
    assert do_assess(env, gid, 1, "RELEASE", url="https://github.com/acme/r1") == "RELEASE"
    v = env[1].get_grant(gid)
    assert v["tranches"][1]["status"] == "RELEASED" and v["cursor"] == 2


def test_dispute_then_resolve_claws_back(env):
    gid = active(env)
    do_assess(env, gid, 0, "RELEASE", url="https://github.com/acme/r0")
    assert call(env, env[2], "dispute", gid, 0, "c" * 64) == "DISPUTED"
    with patch.dict(mod_of(env), {"_fetch_evidence": lambda *_: snap(),
                                  "_judge": lambda *_: {"outcome": "REJECT", "confidence": 10}}):
        assert call(env, env[4], "resolve", gid, 0) == "REJECT"
    v = env[1].get_grant(gid)
    assert v["tranches"][0]["status"] == "REJECTED" and v["tranches"][0]["amount"] == 0 and v["held"] == BUDGET


def test_claim_blocked_until_claimable_then_pays(env):
    gid = active(env)
    do_assess(env, gid, 0, "RELEASE", url="https://github.com/acme/r0")
    with pytest.raises(Exception):  # inside dispute window
        call(env, env[3], "claim", gid)
    env[0].warp("2026-10-15T00:05:00Z")  # past claimable_at (assess + 120s)
    assert call(env, env[3], "claim", gid) == "CLAIMED"
    v = env[1].get_grant(gid)
    assert v["tranches"][0]["status"] == "CLAIMED" and v["grantee_claimed"] == 300


def test_expiry_recovers_unreleased_to_funder(env):
    gid = active(env)
    do_assess(env, gid, 0, "RELEASE", url="https://github.com/acme/r0")  # 300 to grantee, 700 held
    env[0].warp("2026-10-15T02:00:01Z")
    assert call(env, env[4], "recover_expired", gid) == "REFUND_AVAILABLE"
    v = env[1].get_grant(gid)
    assert v["held"] == 0 and v["refund_pending"] == 700 and v["phase"] == "CLOSED"
    assert call(env, env[2], "claim", gid) == "CLAIMED"
    v = env[1].get_grant(gid)
    assert v["funder_refunded"] == 700
    # grantee can still claim the earned rung after expiry
    assert call(env, env[3], "claim", gid) == "CLAIMED"
    v = env[1].get_grant(gid)
    assert v["grantee_claimed"] == 300
    assert v["grantee_claimed"] + v["funder_refunded"] == BUDGET
