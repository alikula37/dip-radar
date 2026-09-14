import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DELETE, GET, POST } from "./route";

describe("API proxy route", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards GET requests with the query string to the backend", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ tracked_coins: 1 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    const request = new NextRequest("http://localhost:3000/api/meta?fresh=1");
    const response = await GET(request, { params: Promise.resolve({ path: ["meta"] }) });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/api/meta?fresh=1",
      expect.objectContaining({ method: "GET" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ tracked_coins: 1 });
  });

  it("forwards POST bodies and status codes", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ detail: "busy" }), { status: 409 }));

    const request = new NextRequest("http://localhost:3000/api/refresh", {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json" },
    });
    const response = await POST(request, { params: Promise.resolve({ path: ["refresh"] }) });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/api/refresh",
      expect.objectContaining({ method: "POST", body: "{}" }),
    );
    expect(response.status).toBe(409);
  });

  it("forwards DELETE requests (watchlist removal)", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));

    const request = new NextRequest("http://localhost:3000/api/watchlist/ETHBTC", { method: "DELETE" });
    const response = await DELETE(request, { params: Promise.resolve({ path: ["watchlist", "ETHBTC"] }) });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/api/watchlist/ETHBTC",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(response.status).toBe(204);
  });

  it("retries once on transient network failures", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("socket hang up"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const request = new NextRequest("http://localhost:3000/api/meta");
    const response = await GET(request, { params: Promise.resolve({ path: ["meta"] }) });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(200);
  });

  it("returns 502 when the backend is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));

    const request = new NextRequest("http://localhost:3000/api/coins");
    const response = await GET(request, { params: Promise.resolve({ path: ["coins"] }) });

    expect(response.status).toBe(502);
  });

  it("adds the API key when configured", async () => {
    vi.stubEnv("API_KEY", "secret");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));

    const request = new NextRequest("http://localhost:3000/api/meta");
    await GET(request, { params: Promise.resolve({ path: ["meta"] }) });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/api/meta",
      expect.objectContaining({
        headers: expect.objectContaining({ "x-api-key": "secret" }),
      }),
    );
    vi.unstubAllEnvs();
  });
});
