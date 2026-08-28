# Dip Radar 🎯

Dip Radar is a fully dockerized, self-hosted web service that visualizes the percentage distance of BTC-parity altcoins (listed before 2021) from their historical dip points. It features an interactive D3.js bubble chart and a robust backend that automatically synchronizes data from Binance and CoinGecko.

## Features ✨

- **Interactive Bubble Chart**: Visualizes coins using D3.js force simulation. Bubble size represents market cap, and color intensity represents the distance from the dip.
- **Dual Reference Points**: Toggle between "Since 2021" (Event Low) and "All Time Low" (ATL) to see how far coins are from their historical bottoms.
- **Automated Data Sync**: A dedicated APScheduler worker runs daily to fetch the latest daily candles and metadata.
- **Anti-Censorship Proxy Rotator**: Built-in concurrent proxy rotator automatically bypasses ISP-level blocks (e.g., ISP Safe Internet profiles) by dynamically finding and routing traffic through free public proxies.
- **Pixel-Perfect UI**: Designed strictly following modern design system tokens (Stitch MCP) with a beautiful dark mode interface.
- **Local Caching**: Aggressive SQLite caching ensures fast load times and respects API rate limits.

## Architecture 🏗️

The project consists of three main Docker containers:
1. **Backend (FastAPI)**: Serves REST API endpoints and handles database queries.
2. **Worker (Python/APScheduler)**: Runs background tasks to fetch and process data from Binance and CoinGecko APIs. Includes rate-limiting and proxy rotation logic.
3. **Frontend (Next.js)**: A React-based dashboard that consumes the backend API and renders the D3.js visualization.

## Prerequisites 📦

- Docker
- Docker Compose

## Installation & Usage 🚀

1. Clone the repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/dip-radar.git
   cd dip-radar
   ```

2. Start the services using Docker Compose:
   ```bash
   docker compose up -d --build
   ```

3. Access the dashboard:
   Open your browser and navigate to `http://localhost:3000`.

*Note: On the first run, the worker will begin fetching historical data. Depending on your network and the proxy rotator, it may take 10-15 minutes for the initial data sync to complete. The frontend will display a loading screen until the data is ready.*

## Environment Variables ⚙️

You can configure the application using environment variables (or by creating a `.env` file based on `.env.example`):

- `DB_DIR`: Directory for the SQLite database (default: `/data`)
- `NEXT_PUBLIC_API_URL`: Backend API URL for the frontend (default: `http://localhost:8000`)

## Troubleshooting 🔧

- **No data appearing?** Check the worker logs to see if it's still syncing or if it's struggling to find a working proxy:
  ```bash
  docker compose logs -f worker
  ```
- **SSL Errors?** If your ISP blocks crypto APIs, the built-in proxy rotator will automatically kick in. Just give it a few minutes to find a working proxy.

## License 📄
MIT License
