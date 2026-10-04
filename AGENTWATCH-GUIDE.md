# AgentWatch — Local Setup Guide (Windows)

AgentWatch is a **100% local** dashboard that watches a project folder on your
machine, saves a checkpoint for every meaningful change, and analyzes what your
AI agents (or you) build — plan, dependencies, function health, console errors,
snapshots & restore. Your code and your data **never leave this machine**.

---

## Quick start

1. Put this folder anywhere you like (example: `C:\Users\loq\Documents\AgentWatch`).
2. Double-click **`start.bat`**
   - First run: it installs dependencies, creates the local database and builds
     the app (one-time, a few minutes — needs internet for npm).
   - Then it starts the dashboard and opens **http://localhost:4517** in your browser.
3. Click **+ Add project** (top bar) and pick a folder you want to watch.
   The first scan indexes it and saves a baseline checkpoint.
4. To stop: double-click **`close.bat`** (or just close the AgentWatch window).

Requirements: **Node.js 20+** (LTS recommended, https://nodejs.org) and internet
once for `npm install`. Everything else is local.

---

## What you get (8 views)

| View | What it shows |
|------|---------------|
| **Dashboard** | Health score, open issues, change activity, agents, recent checkpoints & errors |
| **Timeline** | Every checkpoint with real file diffs, +/- stats, labels written by your local LLM |
| **Project Plan** | A living plan derived from REAL evidence: TODO/FIXME comments, stubs, recurring errors, recent work |
| **Dependencies** | Interactive graph of imports between files; broken imports & orphans highlighted |
| **Function Health** | Every function/class: complexity, stubs, duplicates, dead code, missing tests — click to open the exact line |
| **Console & Errors** | Capture a terminal run (`npm run build`, tests...) — errors are parsed and linked to the changes that caused them |
| **Snapshots & Restore** | Browse any checkpoint, view the diff, restore files to that point (only with your explicit click) |
| **Settings** | Rename the app to your name, configure the AI provider, manage monitored projects |

---

## Local AI (Ollama) — real intelligence, zero cloud

AgentWatch uses **your local Ollama models** to write checkpoint labels and plan
wording. It auto-picks an installed model on every call.

1. Install Ollama from https://ollama.com (already installed on this machine if
   `http://localhost:11434` responds).
2. Make sure at least one chat model is installed, e.g.:
   `ollama pull qwen2.5-coder:3b`
3. In the app: **Settings → Intelligence provider → Ollama**, then press
   **“Test Ollama connection”** — it should report e.g.
   `4 installed · using qwen2.5-coder:3b`.
4. Save. From now on, checkpoint labels are written by your own local model.

If Ollama is off or has no models, AgentWatch falls back to built-in summaries —
it keeps working either way. **No API keys, no cloud, no accounts.**

---

## Read-only promise

AgentWatch only **reads** your project files and observes output you explicitly
capture. The only time it writes into a watched project is when **you** click
**Restore** on a snapshot (it asks for confirmation).

---

## Daily use

| Task | How |
|------|-----|
| Start | `start.bat` → http://localhost:4517 |
| Stop | `close.bat` |
| Watch another project | top bar → **+ Add project** (add as many as you like) |
| Pause / resume / remove a project | Settings → Monitored projects |
| Change port | edit `PORT=4517` in `start.bat` |
| Reinstall from scratch | delete `node_modules`, `.next`, `db`, `.env`, then run `setup.bat` |
| Rename the app to your name | `npm run rebrand -- "Your Name"` in a terminal opened in this folder |

## Troubleshooting

- **start.bat closes instantly** → run it from a terminal (`cmd.exe`) to read the error.
- **“Setup failed”** → check the message; most common is a network hiccup during
  `npm install` — run `setup.bat` again.
- **Port already in use** → change `PORT` in `start.bat` (both lines that mention 4517).
- **AI says “Ollama not reachable”** → is Ollama running? Start the Ollama app or
  run `ollama serve`, then press Test again.
- **Where is my data?** Everything lives inside this folder:
  `db\custom.db` (checkpoints, analysis, settings). Delete it to start clean.
