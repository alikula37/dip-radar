# Give this to a friend's AI (Docker install)

Copy the block below into any AI agent with terminal access on the machine that
should run Dip Radar. It installs the app, picks free ports, proves it works
and reports back.

```text
You are an installation assistant. Bring this open-source project up with Docker
on this machine and prove it works; finish with a short report.

Repo: https://github.com/alikula37/dip-radar (main branch)

1) Check prerequisites: is Docker installed and running (compose v2 included)?
   Is git available? If Docker is missing or not running, explain how to fix it
   (start Docker Desktop / systemctl start docker) and wait.

2) Install:
   git clone https://github.com/alikula37/dip-radar.git && cd dip-radar
   ./scripts/install.sh

   The installer checks whether the default ports (3000 frontend, 8000 backend)
   are free, walks upward until it finds free ones, writes them to .env and runs
   `docker compose up -d --build`. It prints the URLs it chose - use those.
   (Equivalent manual route: `cp .env.example .env`, edit FRONTEND_PORT /
   BACKEND_PORT if needed, then `docker compose up -d --build`.)

3) Health check:
   curl http://localhost:<BACKEND_PORT>/health   -> {"status":"ok"}
   docker compose ps                             -> backend, frontend, worker Up

4) The first data sync starts automatically in the worker and can take 20-60+
   minutes (Binance rate limits). For instant demo data run:
   docker compose exec -T backend python demo_seed.py

5) Verify in the browser (use the chosen FRONTEND_PORT):
   http://localhost:<PORT>/            dashboard (coins sorted by Value Score;
                                       coins without a score sort last)
   http://localhost:<PORT>/backtest    Strategy Lab (backtests, presets, optimizer)
   http://localhost:<PORT>/signals     watched strategies / signal history

6) Watch the sync:
   curl http://localhost:<BACKEND_PORT>/api/meta    # sync_in_progress
   docker compose logs -f --tail=50 worker
   If it stalls: docker compose restart worker

7) On any error include the logs and explain the cause:
   docker compose logs --tail=100 backend worker

8) Updates: when the header shows an "Update vX.Y.Z" chip a newer release
   exists; update with `./scripts/update.sh` (or manually:
   git pull && docker compose up -d --build).

Constraints: no API keys are required (a CoinGecko key is optional). If you must
change ports, use the env vars or the installer, and tell me which ports you
chose. Backtests and signals are not investment advice; summarise the caveats
from README.md.

Report: the working URLs, sync status, any errors and how you fixed them.
```
