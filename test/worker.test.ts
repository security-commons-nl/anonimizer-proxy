import { SELF, fetchMock } from "cloudflare:test";
import { beforeAll, afterEach, describe, expect, it } from "vitest";

const ORIGIN = "https://security-commons-nl.github.io";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

afterEach(() => fetchMock.assertNoPendingInterceptors());

function mockMistral(status: number, body: object): void {
  fetchMock
    .get("https://api.mistral.ai")
    .intercept({ method: "POST", path: "/v1/chat/completions" })
    .reply(status, body, { headers: { "Content-Type": "application/json" } });
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
