import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const BACKEND_URL = (process.env.BACKEND_URL || "http://localhost:8000").replace(/\/$/, "");

async function proxy(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await context.params;
  const target = `${BACKEND_URL}/api/${path.join("/")}${request.nextUrl.search}`;
  const apiKey = process.env.API_KEY;
  const forwardedFor = request.headers.get("x-forwarded-for");

  const init: RequestInit = {
    method: request.method,
    headers: {
      "content-type": request.headers.get("content-type") ?? "application/json",
      ...(apiKey ? { "x-api-key": apiKey } : {}),
      ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
    },
    cache: "no-store",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.text();
  }

  // Retry once: undici may reuse a keep-alive socket the backend just closed,
  // which surfaces as a transient ECONNRESET/502.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(target, init);
      return new Response(response.body, {
        status: response.status,
        headers: {
          "content-type": response.headers.get("content-type") ?? "application/json",
        },
      });
    } catch (error) {
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        continue;
      }
      console.error(`[api-proxy] ${request.method} ${target} failed twice:`, error);
    }
  }

  return Response.json({ detail: "Backend unavailable" }, { status: 502 });
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
