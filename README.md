# FoodDrop

FoodDrop is a real-time platform where Yale students can share leftover food. Someone with extra food posts a "drop" (what it is, where it is, how many portions, and how long it'll be around), and it appears instantly on everyone's screen. People tap **Claim** to take a portion, and the remaining count updates live for all viewers until the drop runs out or expires.

In the applications, claims are handled atomically in Redis so two people can never grab the last portion at the same time. PostgreSQL is kept in sync in the background, and updates are pushed to browsers over Server-Sent Events.

## Getting Started

These instructions will get a copy of FoodDrop running on your local machine for development and testing.

### Prerequisites

- [Node.js](https://nodejs.org/) 20 or newer, with npm
- [Docker](https://www.docker.com/) with Docker Compose (runs PostgreSQL and Redis)

```
node --version
docker compose version
```

### Installing

1. Clone the repository and start PostgreSQL and Redis:

   ```
   git clone <repo-url> FoodDrop
   cd FoodDrop
   docker compose up -d
   ```

   PostgreSQL listens on `localhost:5433` and Redis on `localhost:6379`. The `drops` table is created from [server/db/schema.sql](server/db/schema.sql) the first time the Postgres container starts with an empty volume.

2. Install dependencies and start the API server (port 3000):

   ```
   cd server
   npm install
   npm run dev
   ```

3. In a second terminal, install dependencies and start the web app:

   ```
   cd app
   npm install
   npm run dev
   ```

4. Open the URL Vite prints (usually http://localhost:5173). Vite proxies `/api` requests to the server on port 3000.

To try it out, click **+ Post a drop**, fill in the form, and submit. Open a second browser window side by side: the drop shows up in both, and claiming in one updates the count in the other.

You can also use the API directly:

```
# Post a drop: 10 portions, available for 30 minutes
curl -X POST localhost:3000/api/drops \
  -H 'content-type: application/json' \
  -d '{"title":"Leftover pizza","loc":"Library, 2nd floor","desc":"Still warm","quantity":10,"time":30}'

# Claim one portion
curl -X POST localhost:3000/api/claims \
  -H 'content-type: application/json' \
  -d '{"dropId":1}'

# List live drops
curl localhost:3000/api/drops
```

#### Configuration

| Variable       | Default                                        | Purpose                                   |
| -------------- | ---------------------------------------------- | ----------------------------------------- |
| `DATABASE_URL` | `postgres://fooddrop:dev@localhost:5433/fooddrop` | PostgreSQL connection string           |
| `TIMING_LOG`   | unset                                          | Set to any value to log per-request timings |
| `BENCH_URL`    | `http://localhost:3000`                        | Server the benchmark script targets       |

## How It Works

```
 Browser ──POST /api/drops──▶ Express ──INSERT──▶ PostgreSQL
    ▲                            │
    │                            ├──HSET drop:<id>──▶ Redis (live counters, TTL = drop lifetime)
    │                            └──PUBLISH newDrops──▶ Redis pub/sub
    │                                                       │
    └──────── SSE /api/drops/stream ◀──── subscriber ◀──────┘
```

- **Posting a drop** saves it to PostgreSQL, creates a Redis hash `drop:<id>` with the remaining count (expiring when the drop does), and publishes a message on the `newDrops` channel.
- **Claiming** runs a Lua script in Redis that checks the remaining count and decrements it in one atomic step. It returns `409` if the drop is sold out, expired, or doesn't exist. Successful claims are published so every client's count updates.
- **Persisting claims**: claims are tallied in a `claims:pending` hash, and every 200 ms a background flusher writes them to PostgreSQL with one `UPDATE` per drop. Failed writes are put back and retried.
- **Recovery**: on startup the server flushes leftover pending claims, then rebuilds any missing Redis counters for live drops from PostgreSQL.
- **Live updates**: the server subscribes to `newDrops` and forwards each message to connected browsers over Server-Sent Events. The client also removes expired drops every second without a refresh.

### API

| Method | Route                 | Description                                  |
| ------ | --------------------- | -------------------------------------------- |
| GET    | `/api/drops`          | List drops that haven't expired, newest first |
| POST   | `/api/drops`          | Create a drop (`title`, `loc`, `desc`, `quantity`, `time` in minutes) |
| POST   | `/api/claims`         | Claim one portion of a drop (`dropId`)        |
| GET    | `/api/drops/stream`   | SSE stream of new drops and claim updates     |
| GET    | `/api/debug/timings`  | Per-step latency stats (p50/p99/avg)          |
| DELETE | `/api/debug/timings`  | Reset latency stats                           |

## Running the Tests

There is no automated test suite yet. The project includes a load-testing benchmark and linting.

### Benchmarks

[server/bench/bench.ts](server/bench/bench.ts) uses [autocannon](https://github.com/mcollina/autocannon) to load-test claiming, listing, and posting, then saves results to `server/bench/results/` and compares them with the previous run. Everything it creates is tagged `[bench]` and cleaned up afterwards.

With the server running:

```
cd server
npm run bench -- --label before
# make a change
npm run bench -- --label after
```

Options: `--duration <sec>` (default 10), `--connections <n>` (default 50), and `--seed <n>` to insert `n` expired drops first and simulate a large table.

Moving claims from a PostgreSQL row update to an atomic Redis script made claims much faster. Results from 50 connections for 10 seconds on one drop, measured locally:

| Claim path  | Requests/sec | p50 latency | p99 latency |
| ----------- | ------------ | ----------- | ----------- |
| PostgreSQL  | 3,649        | 12 ms       | 27 ms       |
| Redis + Lua | 26,681       | 1 ms        | 5 ms        |

## Built With

- [React](https://react.dev/) + [Vite](https://vite.dev/) – frontend
- [TypeScript](https://www.typescriptlang.org/) – frontend and server
- [Express](https://expressjs.com/) – API server
- [PostgreSQL](https://www.postgresql.org/) – persistent storage
- [Redis](https://redis.io/) – atomic claim counters and pub/sub
- [Zod](https://zod.dev/) – request validation
- [autocannon](https://github.com/mcollina/autocannon) – load testing

## Authors

- **Michael Liu** – *Initial work*

## License

No license has been chosen yet.
