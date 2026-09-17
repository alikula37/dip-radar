# Development

## Backend (Python 3.11+)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
ruff check .          # lint
python -m pytest -q   # tests
uvicorn main:app --reload
```

The repo ships a `.pre-commit-config.yaml` (ruff + basic hygiene hooks); install
it with `pip install pre-commit && pre-commit install`.

## Frontend (Node.js 20.9+)

```bash
cd frontend
npm ci
npm run dev
```

## Demo data without hitting the providers

```bash
cd backend && python demo_seed.py
```

Inserts five deterministic demo coins with ~4.5 years of candles (the E2E job in
CI uses the same script).

## Testing

- Backend: `cd backend && ruff check . && python -m pytest -q` (metrics,
  migrations, fetcher fallback/upsert/conversion/verification, backtest,
  optimizer, signals, alerts and API tests).
- Frontend: `cd frontend && npm run lint && npm test && npm run build`.
- End-to-end (Playwright, requires a running dashboard):
  `cd frontend && E2E_BASE_URL=http://localhost:3000 npm run test:e2e`.
  CI starts the stack, seeds demo data and runs this suite automatically.
- CI runs backend lint + tests, frontend lint + tests + build, the Playwright
  suite against a seeded stack, and Docker image builds with a blocking Trivy
  scan for critical CVEs. Dependabot keeps dependencies fresh.

## Value Score research

`backend/research/` is a read-only, deterministic harness (baseline IC study,
bootstrap CIs, provenance/fingerprint freezing, the purged/embargoed CV, the
look-ahead audit and the shipping gates for any learned score). See
`backend/research/README.md` for how to run it against a database copy and what
its numbers mean.
