# Dip Radar

Dip Radar is a self-hosted web service that visualizes the percentage distance of the current price of BTC-parity altcoins (listed before 2021) to their lowest BTC parity point, using an interactive bubble chart.

## Features
- **Bubble Chart Visualization**: Built with D3.js force simulation.
- **Automated Data Fetching**: Fetches data from Binance (for OHLCV) and CoinGecko (for metadata).
- **Self-Hosted**: Fully dockerized with a FastAPI backend, Next.js frontend, and APScheduler worker.
- **No API Keys Required**: Uses public APIs.

## Getting Started

1. Clone the repository.
2. Run `docker compose up -d` to start the services.
3. Open your browser and navigate to `http://localhost:3000`.

**Note on Initial Data Fetch**:
The first time you start the application, the worker will fetch historical data for all BTC pairs listed before 2021. This process can take several minutes due to rate limits on the Binance and CoinGecko APIs. Please be patient. You can check the worker logs using `docker compose logs -f worker` to monitor the progress.

## Architecture
- **Backend**: FastAPI, SQLAlchemy, SQLite
- **Worker**: APScheduler (runs daily to update the latest daily kline)
- **Frontend**: Next.js (App Router), TypeScript, D3.js

## License
MIT
