import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import HistoryChart from "./HistoryChart";

describe("HistoryChart", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requests the configured range from the API", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("[]", { status: 200 }));

    render(<HistoryChart symbol="ETHBTC" limit={90} />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("limit=90"), expect.anything());
    });
  });

  it("renders a line chart once history is fetched", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          { timestamp: "2025-01-01T00:00:00", open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
          { timestamp: "2025-01-02T00:00:00", open: 1.5, high: 3, low: 1, close: 2.5, volume: 12 },
        ]),
        { status: 200 },
      ),
    );

    render(<HistoryChart symbol="ETHBTC" />);

    const chart = await screen.findByRole("img", { name: /ETHBTC price history/i });
    expect(chart.querySelector("path")).not.toBeNull();
  });

  it("shows date and price when hovering", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          { timestamp: "2025-01-01T00:00:00", open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
          { timestamp: "2025-01-02T00:00:00", open: 1.5, high: 3, low: 1, close: 2.5, volume: 12 },
        ]),
        { status: 200 },
      ),
    );

    render(<HistoryChart symbol="ETHBTC" />);

    const chart = await screen.findByRole("img", { name: /ETHBTC price history/i });
    fireEvent.mouseMove(chart, { clientX: 350 });

    expect(await screen.findByText("2025-01-02")).toBeTruthy();
    expect(screen.getByText(/2\.5 BTC/)).toBeTruthy();
  });

  it("shows date and price on touch as well", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          { timestamp: "2025-01-01T00:00:00", open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
          { timestamp: "2025-01-02T00:00:00", open: 1.5, high: 3, low: 1, close: 2.5, volume: 12 },
        ]),
        { status: 200 },
      ),
    );

    render(<HistoryChart symbol="ETHBTC" />);

    const chart = await screen.findByRole("img", { name: /ETHBTC price history/i });
    fireEvent.touchStart(chart, { touches: [{ clientX: 350, clientY: 60 }] });

    expect(await screen.findByText("2025-01-02")).toBeTruthy();
    expect(screen.getByText(/2\.5 BTC/)).toBeTruthy();
  });

  it("shows an error message when the request fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("missing", { status: 404 }));

    render(<HistoryChart symbol="ETHBTC" />);

    expect(await screen.findByText(/price history unavailable/i)).toBeTruthy();
  });
});
