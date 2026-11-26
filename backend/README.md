# Backend

The call orchestration engine for [Broni](../README.md): a REST + WebSocket API built on **Bun**, **Elysia**, and **Prisma**, that drives outbound/inbound calls through **Asterisk ARI**, transcribes speech with **Vosk**, generates dialogue with **Gemini**, and speaks with **Edge TTS**.

## Responsibilities

- **HTTP API** — task intake from the Telegram bot, auth + CRUD for dashboard companies, call logs, bookings.
- **WebSocket (`/api/ws`)** — broadcasts live call events (`dashboard_updates` room) to the dashboard as a call progresses.
- **`integrations/asterisk.ts`** — talks to Asterisk's ARI (REST + WebSocket events): originates/answers calls, plays synthesized audio, records the channel, and implements barge-in (stop playback the instant the other side starts speaking).
- **`integrations/gemini.ts`** — turns free-form user text into a structured task, and turns a live transcript into the agent's next line.
- **`utils/edge-tts-stream.ts`** — streams Microsoft Edge TTS audio for the agent's voice, no API key required.

## Project layout

```
src/
├── index.ts                  Entry point — HTTP/WS server, auth middleware, route mounting
├── config/                   Centralized env-based config
├── integrations/
│   ├── asterisk.ts           ARI client: call control, barge-in, recording
│   └── gemini.ts             Dialogue generation + task extraction
├── modules/
│   ├── auth/                 Company register/login (JWT)
│   ├── companies/            Company profile, call logs, bookings
│   ├── calls/                Call state and the live-call store
│   └── tasks/                Telegram-driven task lifecycle
├── lib/db.ts                 Prisma client
└── utils/                    Logger, JSON helpers, TTS streaming
```

## API

All routes are mounted under `/api` and require `Authorization: Bearer <API_SECRET_KEY>` **except** `/api/auth/*`, `/api/companies/*`, and `/api/recordings/*`.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/process-request` | Submit a new booking task (used by the Telegram bot) |
| `GET` | `/api/tasks/:userId` | List a user's tasks |
| `PUT` | `/api/tasks/:taskId/approve` | Approve a pending task → triggers the call |
| `PUT` | `/api/tasks/:taskId/reject` | Reject a pending task |
| `GET` | `/api/task-result/:taskId` | Fetch the outcome of a completed call |
| `POST` | `/api/auth/register` | Register a company (dashboard) |
| `POST` | `/api/auth/login` | Log in, returns a JWT |
| `GET` | `/api/companies/me` | Current company profile |
| `PUT` | `/api/companies/me` | Update company profile |
| `GET` | `/api/companies/me/logs` | Paginated call logs |
| `GET` | `/api/companies/me/bookings` | Bookings for the calendar view |
| `WS` | `/api/ws` | Live call event stream for the dashboard |

More detailed request/response examples: [`POSTMAN_EXAMPLES.md`](./POSTMAN_EXAMPLES.md).

## Environment variables

| Variable | Description |
|---|---|
| `PORT` | HTTP port (default `3000`) |
| `DATABASE_URL` | PostgreSQL connection string |
| `API_SECRET_KEY` | Shared bearer token for internal service-to-service calls |
| `GEMINI_API_KEY` | Google Gemini API key |
| `ZADARMA_API_KEY` / `ZADARMA_API_SECRET` / `ZADARMA_SIP_ID` / `ZADARMA_PHONE_NUMBER` | Zadarma account + number used to place calls |
| `ASTERISK_ARI_HOST` / `ASTERISK_ARI_PORT` | Where Asterisk's ARI is reachable |
| `ASTERISK_ARI_USER` / `ASTERISK_ARI_PASS` | ARI credentials — **must match** `backend/asterisk/ari.conf` |
| `VOSK_HOST` | Vosk STT server host |

Copy `docker-compose.yml`'s expectations into a root `.env` — see the [main README](../README.md#quick-start-docker).

## Local development

```bash
bun install
bunx prisma generate
bunx prisma db push      # or: bun run db:migrate
bun run dev               # http://localhost:3000
```

Bring up just the infrastructure (Postgres, Asterisk, Vosk) with `docker-compose up -d` from this directory before running the backend natively.

> **Note:** Asterisk's `ari.conf`/`pjsip.conf` are static files mounted read-only into the container — they don't read environment variables. Edit the placeholders in `asterisk/ari.conf` and `asterisk/pjsip.conf` directly with your own credentials before deploying.
