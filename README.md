# B2G Vendor

A multi-agency Thai government procurement disclosure portal — ingests TOR/procurement data from connected government sites, tracks status, and notifies users about work matching their interests. See [ProjectDescription.md](ProjectDescription.md) for the full requirements spec.

## Repo layout

```
B2GVendor/    Next.js frontend (currently a self-contained mock — see below)
Backend/      Express + TypeScript API (scaffold — health check only so far)
testAPI/      Exploration scripts for the real government data sources
docker-compose.yml
```

> **Current state:** `B2GVendor` is a front-end mock driven entirely by in-memory data in `src/lib/mock-data.ts` — it does not call `Backend` yet. `Backend` is a scaffold (env validation, MongoDB connection, `/health`) with no feature routes implemented yet. `testAPI` holds throwaway scripts for exploring the real data.go.th / e-GP APIs, not part of the shipped app.

## Prerequisites

- Node.js 20+
- npm
- Docker Desktop (only needed for the Docker path below)

## Quick start (Docker — runs everything together)

```bash
cp .env.example .env
cp Backend/.env.example Backend/.env
cp B2GVendor/.env.example B2GVendor/.env

docker compose up --build
```

- Frontend: http://localhost:3000
- Backend health check: http://localhost:4000/health
- MongoDB: localhost:27017 (local dev only — point `MONGODB_URI` at Atlas for anything real)

Stop everything with `docker compose down` (add `-v` to also drop the Mongo volume).

Ports are configurable via the root `.env` (`FRONTEND_PORT`, `BACKEND_PORT`, `MONGO_PORT`) if any of the defaults are already taken on your machine.

## Running pieces individually (local dev, no Docker)

### Frontend (`B2GVendor`)

```bash
cd B2GVendor
npm install
cp .env.example .env
npm run dev
```

Runs at http://localhost:3000. It's a mock — no backend or database required to use it.

### Backend (`Backend`)

```bash
cd Backend
npm install
cp .env.example .env
npm run dev
```

Needs a reachable MongoDB (`MONGODB_URI` in `.env`) — either run just the `mongo` service from Docker (`docker compose up mongo`) or point it at an Atlas connection string. Runs at http://localhost:4000; check http://localhost:4000/health.

Other scripts: `npm run build` (compile to `dist/`), `npm run start` (run the compiled build), `npm run typecheck`.

### testAPI

Exploration scripts against the real e-GP RSS feed and data.go.th — see [testAPI/readme.md](testAPI/readme.md) for the full command list.

```bash
cd testAPI
npm install
cp .env.example .env   # optional — public reads worked without a key in testing
npm run rss -- 4520101 B0,D0
npm run explore -- orgs
```

## Environment files

Every service has a `.env.example` — copy each to `.env` before running (the real `.env` files are gitignored):

| File | Used by |
|---|---|
| `.env.example` (root) | `docker-compose.yml` — host ports, frontend build arg |
| `Backend/.env.example` | The Express API — port, Mongo URI, CORS origin |
| `B2GVendor/.env.example` | The Next.js frontend — backend API URL |
| `testAPI/.env.example` | The exploration scripts — optional data.go.th API key |

## Tech stack

Next.js (frontend) · Node.js/Express (backend) · MongoDB Atlas (database) · Vertex AI (planned — auto-tagging/Thai NLP search)
