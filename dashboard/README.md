# Dashboard

The operator-facing web app for [Broni](../README.md). Businesses log in to watch their AI agent handle live phone calls, review call history, and manage bookings — built with **React 19**, **Vite**, and **TypeScript**.

## Features

- **Login** — JWT-based auth against the [backend](../backend/README.md)'s `/api/auth` endpoints.
- **Live Monitor** — a real-time transcript of the call currently in progress, streamed over the backend's `/api/ws` WebSocket, with a connection/activity indicator.
- **Calendar** — upcoming and past bookings created by the agent, rendered on a day/week calendar.
- **Dashboard overview** — call history and company settings.

## Pages

```
src/pages/
├── Login.tsx          Auth form, stores the JWT in localStorage
├── Dashboard.tsx       Shell: tab navigation, WebSocket connection, shared call state
├── LiveMonitorTab.tsx  Real-time call transcript view
└── CalendarTab.tsx     Booking calendar
```

`src/api.ts` is the single place that talks to the backend — it attaches the stored JWT to every request.

## Local development

```bash
bun install
bun run dev        # http://localhost:5173
```

By default the app points at `http://localhost:3001/api` (see `src/api.ts`) — the port the root `docker-compose.yml` exposes the backend on. Update `BASE_URL` there if you're running the backend elsewhere.

## Build

```bash
bun run build       # type-checks and builds to dist/
bun run preview      # serve the production build locally
```
