import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import BubbleChart from "./BubbleChart";
import type { Coin } from "@/types";

const coins: Coin[] = [
  {
    symbol: "ETHBTC",
    name: "Ethereum",
    logo_url: null,
    current_price_btc: 0.03,
    event_low: 0.01,
    all_time_low: 0.01,
    distance_pct_event: 200,
    distance_pct_atl: 250,
    bubble_size_event: 100,
    bubble_size_atl: 100,
    market_cap: 1_000_000,
    volume_24h: 10,
  },
  {
    symbol: "LTCBTC",
    name: "Litecoin",
    logo_url: null,
    current_price_btc: 0.001,
    event_low: 0.0005,
    all_time_low: 0.0005,
    distance_pct_event: 40,
    distance_pct_atl: 50,
    bubble_size_event: 50,
    bubble_size_atl: 50,
    market_cap: 500_000,
    volume_24h: 5,
  },
];

describe("BubbleChart", () => {
  it("renders one bubble per coin and reports clicks", async () => {
    const onCoinClick = vi.fn();
    const { container } = render(<BubbleChart data={coins} useAtl={false} onCoinClick={onCoinClick} />);

    await waitFor(() => {
      expect(container.querySelectorAll("g.bubble-node")).toHaveLength(2);
    });

    const nodes = container.querySelectorAll("g.bubble-node");
    fireEvent.click(nodes[0]);

    expect(onCoinClick).toHaveBeenCalledWith(expect.objectContaining({ symbol: "ETHBTC" }));
  });

  it("renders an empty chart container without data", () => {
    const { container } = render(<BubbleChart data={[]} useAtl={false} onCoinClick={vi.fn()} />);

    expect(container.querySelectorAll("g.bubble-node")).toHaveLength(0);
  });
});
