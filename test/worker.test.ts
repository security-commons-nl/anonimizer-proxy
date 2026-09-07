import { SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

const ORIGIN = "https://security-commons-nl.github.io";

// De Worker draait in dezelfde isolate als de test en gebruikt de globale fetch voor Mistral.
// Die vervangen we per test; fetchMock uit cloudflare:test bestaat sinds pool-workers 0.22 niet meer.
// Zonder mock gaat er niets naar buiten: elke onverwachte aanroep is een fout in de test.
let uitgaand: MockInstance<typeof fetch>;

beforeEach(() => {
  uitgaand = vi.spyOn(globalThis, "fetch").mockImplementation(async (invoer) => {
    const url = invoer instanceof Request ? invoer.url : String(invoer);
    throw new Error(`onverwachte uitgaande fetch naar ${url}`);
  });
});

afterEach(() => vi.restoreAllMocks());

function mockMistral(status: number, body: object): void {
  uitgaand.mockImplementation(async (invoer, init) => {
    const url = invoer instanceof Request ? invoer.url : String(invoer);
    const methode = invoer instanceof Request ? invoer.method : (init?.method ?? "GET");
    if (url !== "https://api.mistral.ai/v1/chat/completions" || methode !== "POST") {
      throw new Error(`onverwachte uitgaande fetch: ${methode} ${url}`);
    }
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
}

describe("OPTIONS preflight", () => {
  it("retourneert 204 met CORS headers", async () => {
    const resp = await SELF.fetch("https://proxy/v1/chat/completions", {
      method: "OPTIONS",
      headers: { Origin: ORIGIN },
    });
    expect(resp.status).toBe(204);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(resp.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });
});

describe("routing", () => {
  it("404 op andere paden", async () => {
    const resp = await SELF.fetch("https://proxy/iets-anders", {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(resp.status).toBe(404);
  });

  it("404 op GET zelfs naar correct pad", async () => {
    const resp = await SELF.fetch("https://proxy/v1/chat/completions", {
      method: "GET",
      headers: { Origin: ORIGIN },
    });
    expect(resp.status).toBe(404);
  });
});

describe("body validatie", () => {
  it("400 op niet-JSON body", async () => {
    const resp = await SELF.fetch("https://proxy/v1/chat/completions", {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: "geen JSON",
    });
    expect(resp.status).toBe(400);
  });

  it("400 op JSON zonder messages array", async () => {
    const resp = await SELF.fetch("https://proxy/v1/chat/completions", {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ andere_key: 1 }),
    });
    expect(resp.status).toBe(400);
  });

  it("400 op lege messages array", async () => {
    const resp = await SELF.fetch("https://proxy/v1/chat/completions", {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });
    expect(resp.status).toBe(400);
  });

  it("400 op te lange messages array (>4)", async () => {
    const resp = await SELF.fetch("https://proxy/v1/chat/completions", {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: "a" },
          { role: "user", content: "b" },
          { role: "assistant", content: "c" },
          { role: "user", content: "d" },
          { role: "assistant", content: "e" },
        ],
      }),
    });
    expect(resp.status).toBe(400);
  });
});

describe("forwarding naar Mistral", () => {
  it("forwardt 200 respons door met CORS", async () => {
    mockMistral(200, {
      choices: [{ message: { content: '{"entiteiten":[]}' } }],
    });
    const resp = await SELF.fetch("https://proxy/v1/chat/completions", {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: "sys" },
          { role: "user", content: "u" },
        ],
      }),
    });
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    const data = (await resp.json()) as {
      choices: { message: { content: string } }[];
    };
    expect(data.choices[0].message.content).toContain("entiteiten");
  });

  it("geeft upstream 401 door als 401", async () => {
    mockMistral(401, { error: "unauthorized" });
    const resp = await SELF.fetch("https://proxy/v1/chat/completions", {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "x" }],
      }),
    });
    expect(resp.status).toBe(401);
  });
});

describe("CORS origin policy", () => {
  it("staat onbekende origin niet expliciet toe", async () => {
    mockMistral(200, { choices: [{ message: { content: "{}" } }] });
    const resp = await SELF.fetch("https://proxy/v1/chat/completions", {
      method: "POST",
      headers: {
        Origin: "https://evil.example.com",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messages: [{ role: "user", content: "x" }] }),
    });
    // Wij geven Allow-Origin terug, maar nooit de evil origin —
    // de browser blokkeert dan de respons aan kant van de aanvaller.
    expect(resp.headers.get("Access-Control-Allow-Origin")).not.toBe(
      "https://evil.example.com",
    );
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
  });
});
