# Jaipur Prompt-Only Game Experiment

This repository is a deliberately messy experiment in prompt-driven game development.

The project is being built through prompts only:

- No code is hand-written on purpose.
- The repo is used to test the limits of vibe coding / prompt-only iteration.
- Changes are made by continuously prompting for updates instead of designing a clean system first.
- Structural architecture, consistency, and long-term maintainability are not goals of the experiment.

## What This Project Is

This is a browser-based Jaipur-inspired card game prototype with:

- `Next.js` frontend
- `PixiJS` canvas UI
- `Express` backend
- `Socket.IO` realtime game updates
- Multiplayer sessions
- Single-player matches against a computer opponent with `easy`, `medium`, and `hard`
- Prompt-generated audio/settings UX

## What This Project Is Not

This repository should not be treated as:

- a clean reference architecture
- a production-ready codebase
- a stable foundation for extension
- a model of consistent naming, structure, or separation of concerns

The entire point is to push straight through prompting, see what can be produced, and document the result honestly.

## Project Status

Status: experimental

Important caveats:

- Updates may be inconsistent.
- Patterns may change from file to file.
- Architectural decisions may be weak or missing entirely.
- Refactors may be partial.
- The project may be abandoned at any time.

## Preview

Live URL:

- https://jaipur.vendra.cfd

Repository preview:

![Jaipur Preview](./preview/jaipur-preview.svg)

## Current Feature Set

- Prompt-generated PixiJS interface for the game table
- Responsive layout for wide desktop and portrait mobile screens
- Multiplayer invite flow
- Single-player mode against a computer player
- Difficulty selection: `easy`, `medium`, `hard`
- Music and sound settings
- Surrender action
- Session-backed auth

## Stack

- `next@15.5.2`
- `react@18.3.1`
- `pixi.js@8.18.1`
- `@pixi/sound@6.0.1`
- `express`
- `socket.io`
- `express-session`
- `pg`

## Running Locally

Install dependencies:

```bash
npm install
```

Run PostgreSQL if you want persistent users/sessions:

```bash
docker compose up -d db
```

Start the app in development:

```bash
npm run dev
```

Frontend production build:

```bash
npm run build:frontend
```

Production server:

```bash
npm start
```

Default local app URL:

- `http://localhost:8080`

## Container Run

```bash
docker compose up -d --build
```

Container app URL:

- `http://localhost:8087`

## Repository Notes

- The backend serves the Next app through `server.js`.
- `/join/:id` resolves through the same frontend entry.
- Audio assets and UI behavior were added incrementally through prompts.
- Bot logic is heuristic-based and intentionally simple.
- The codebase reflects direct iteration, not a planned architecture.

## Why Keep It This Way

The lack of strict structure is intentional.

The goal is not to clean the repo into a polished engineering artifact. The goal is to observe how far prompt-only development can go when the process is allowed to stay rough, inconsistent, and fast.

If the repo becomes awkward, repetitive, or structurally uneven, that is part of the documented outcome of the experiment.
