import { describe, expect, it } from "vitest";
import { gen, hostOf, outcomeTone, parseSafeGEN, pct, trancheTone, urlInHost, validHost } from "./protocol";

describe("protocol helpers", () => {
  it("validates evidence hosts", () => {
    expect(validHost("github.com")).toBe(true);
    expect(validHost(".github.com")).toBe(false);
    expect(validHost("not a host")).toBe(false);
  });

  it("extracts https host and enforces allowed host", () => {
    expect(hostOf("https://github.com/acme/x")).toBe("github.com");
    expect(hostOf("http://github.com/x")).toBe("");
    expect(urlInHost("https://docs.github.com/x", "github.com")).toBe(true);
    expect(urlInHost("https://evil.com/x", "github.com")).toBe(false);
  });

  it("parses GEN into wei", () => {
    expect(parseSafeGEN("0.003")).toBe(3_000_000_000_000_000);
    expect(() => parseSafeGEN("x")).toThrow();
  });

  it("formats amounts and bps", () => {
    expect(gen(3_000_000_000_000_000)).toBe("0.0030 GEN");
    expect(pct(3000)).toBe("30%");
    expect(pct(3500)).toBe("35%");
  });

  it("maps outcomes and statuses to tones", () => {
    expect(outcomeTone("RELEASE")).toBe("good");
    expect(outcomeTone("REVISE")).toBe("warn");
    expect(outcomeTone("REJECT")).toBe("bad");
    expect(trancheTone("CLAIMED")).toBe("good");
    expect(trancheTone("SUBMITTED")).toBe("warn");
    expect(trancheTone("REJECTED")).toBe("bad");
  });
});
