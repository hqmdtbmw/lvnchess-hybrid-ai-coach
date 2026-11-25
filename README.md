# Hybrid AI Chess Coach — #BuildHybridAI 2026

A chess coach that runs hybrid inference with Firebase AI Logic: instant
hints try on-device Gemini Nano first, and deep game reviews run in the
cloud with Gemini. The UI always shows which inference actually ran —
on-device, in-cloud, or local fallback — so the hybrid behaviour is visible,
not just claimed.

## What it does

- **Instant hint** — `PREFER_ON_DEVICE`. Chrome's on-device Gemini Nano
  answers first (fast, offline-capable) and the cloud only fills in when
  on-device is unavailable.
- **Deep review** — `PREFER_IN_CLOUD`. The cloud Gemini model
  (`gemini-3.1-flash-lite`) does the heavier game review: turning point, one
  lesson, and why the best candidate move works.
- **The UI shows which inference actually ran.** Each answer is labelled
  on-device / in-cloud / local fallback, and says whether the Firebase AI
  SDK reported the inference source for that call. When the SDK does not
  report a source, the label says so instead of claiming a run that cannot
  be proven.
- **It cannot hallucinate a move.** Prompts are built from verified board
  facts only (SAN history, legal candidate moves, hanging pieces, check
  state). Every reply is checked by `validateCoachText()`: any square or
  move not in the supplied facts is stripped, a reply with nothing
  verifiable left falls back to the local deterministic coach line, and the
  coach never returns empty text.

The demo board is a minimal 2D board (chess.js): legal moves, click-to-move,
a move list, and Instant hint / Deep review buttons. You play White; the
demo opponent replies with a random legal move — it is not an engine, and
the candidate moves sent to the coach are legal moves from chess.js (up to
10), not engine-ranked. There is no 3D, no LvnChess engine, no artwork, and
no server, Stellar, or rewards code in this repo.

## How to run

1. Create a Firebase project at <https://console.firebase.google.com>.
2. Enable **Firebase AI Logic** and **App Check** for the project.
3. Copy the web config into `.env.local`:
   ```bash
   cp .env.example .env.local
   ```
   Then fill in the six values from your Firebase project settings
   (Project settings → Your apps → Web app). No secrets go in code — these
   are the public web-config keys.
4. Install and run:
   ```bash
   npm install
   npm run dev
   ```
   Open <http://localhost:5173>.
5. Other commands: `npm run typecheck`, `npm run build`.

## On-device requirements

On-device hints need desktop Chrome 139+ with Gemini Nano available. Enable
the Prompt API flag:

- Open `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` and
  enable it, then restart Chrome.

If Gemini Nano is unavailable in the browser, the hint call falls back to
the cloud, and then to the local deterministic coach — it never shows an
error or an invented line. On-device was **not** live-tested in headless
environments; confirm it in real desktop Chrome before recording a demo.

## Built on LvnChess

The coach was built 11–30 Nov 2026 on top of
[LvnChess](https://lvnchess.com), Daniel Innocent Attah's Living 3D Chess
app. The full game — 3D engine, characters, arenas, server, and rewards —
stays in its private repo. This public repo is the coach
(`src/services/hybridAiCoach.ts`) plus a minimal demo board only.

## License

MIT — see [LICENSE](LICENSE).
