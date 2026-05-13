/**
 * anonimizer-proxy
 *
 * Forward-only proxy naar de Mistral chat-completions API. Bestaat zodat
 * de anonimizer-browser frontend zonder eigen Mistral-account werkt.
 *
 * Wat deze worker WEL doet:
 *   - POST /v1/chat/completions forwarden naar api.mistral.ai
 *   - Authorization-header van de upstream injecteren uit secret
 *   - Rate-limiten per client-IP (default 20/min)
 *   - CORS-headers afgeven zodat de browser hem kan aanroepen
 *
 * Wat deze worker NIET doet:
 *   - Inhoud loggen (geen request- of response-body in logs)
 *   - State bewaren
 *   - Andere endpoints exposen
 *   - Andere modellen/providers ondersteunen
 *
 * Door deze scope is de AVG-verwerkersrol minimaal en uitlegbaar
 * (zie DPA-template in security-commons-nl/.github).
 */

export interface Env {
  MISTRAL_API_KEY: string;
  MISTRAL_BASE_URL: string;
  MISTRAL_MODEL: string;
  ALLOWED_ORIGINS: string;
  RATE_LIMITER: {
    limit: (opts: { key: string }) => Promise<{ success: boolean }>;
  };
}

const ALLOWED_PATH = "/v1/chat/completions";

function corsHeaders(origin: string | null, allowed: string[]): HeadersInit {
  const allow =
    origin && allowed.includes(origin) ? origin : allowed[0] ?? "*";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function jsonError(
  status: number,
  message: string,
  cors: HeadersInit,
): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const allowed = env.ALLOWED_ORIGINS.split(",")
      .map((o) => o.trim())
      .filter(Boolean);
    const cors = corsHeaders(request.headers.get("Origin"), allowed);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    // Alleen POST naar het toegestane pad
    if (request.method !== "POST" || url.pathname !== ALLOWED_PATH) {
      return jsonError(404, "Not found", cors);
    }

    // Rate-limit per client-IP (Cloudflare zet 'CF-Connecting-IP')
    const ip =
      request.headers.get("CF-Connecting-IP") ??
      request.headers.get("X-Forwarded-For")?.split(",")[0].trim() ??
      "unknown";
    const { success } = await env.RATE_LIMITER.limit({ key: ip });
    if (!success) {
      return jsonError(
        429,
        "Te veel verzoeken. Probeer over een minuut opnieuw, of stap over op een eigen Mistral API-key.",
        cors,
      );
    }

    // Body parsen + valideren — we sturen alleen messages + JSON-mode door,
    // forceren het model. Zo voorkomen we dat gebruikers via deze proxy
    // dure modellen/temperature-runaways triggeren.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, "Body moet JSON zijn.", cors);
    }
    if (
      typeof body !== "object" ||
      body === null ||
      !Array.isArray((body as { messages?: unknown }).messages)
    ) {
      return jsonError(400, "Body moet { messages: [...] } bevatten.", cors);
    }
    const messages = (body as { messages: unknown[] }).messages;
    if (messages.length === 0 || messages.length > 4) {
      // anonimizer's detector stuurt altijd [system, user] — 4 als veilige bovengrens
      return jsonError(400, "messages moet 1-4 entries hebben.", cors);
    }

    const upstreamBody = {
      model: env.MISTRAL_MODEL,
      messages,
      response_format: { type: "json_object" },
      temperature: 0.1,
    };

    // Doorzetten naar Mistral
    const upstream = await fetch(`${env.MISTRAL_BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.MISTRAL_API_KEY}`,
      },
      body: JSON.stringify(upstreamBody),
    });

    // Respons als-is doorgeven, met onze CORS-headers
    const respHeaders = new Headers();
    respHeaders.set(
      "Content-Type",
      upstream.headers.get("Content-Type") ?? "application/json",
    );
    for (const [k, v] of Object.entries(cors)) respHeaders.set(k, v as string);

    return new Response(upstream.body, {
      status: upstream.status,
      headers: respHeaders,
    });
  },
};
