# ChessViewLive

Simple prototype for ChessViewLive.
Make it easy for tournament organisers to broadcast chess games with minimal setup.

## One-line
Broadcast chess tournaments from mobile devices to your website with optional digital boards and PGN export.

## Current status
- Prototype live at: https://harshalpatilchess.github.io/Chessviewlive/
- Purpose: validate demand and device setup.

## Who this is for
- Organisers who want a low-cost streaming solution.
- Chess clubs and schools.
- Developers and partners helping build the product.

## How to demo
1. Open the GitHub Pages prototype link above.
2. Use the "Demo — Watch sample stream" link on the prototype (if available).

## Short technical notes
- Streams will be ingested via RTMP or managed streaming service. (RTMP: standard protocol devices push to.)
- Game moves will be shown using a digital board (chessboard.js or chessground) and stored as PGN. (PGN: text format for chess games.)

## Next small milestones
1. Clear landing headline and two CTAs.
2. Add 1–2 embedded demo players.
3. Create Issues and an MVP milestone.
4. Add a simple organiser dashboard mock.
5. Add initial contact info.

## How you can help
- Add issue ideas in GitHub Issues.
- Share prototype link with 5 organisers for feedback.

## Contact
Harshal Patil — harshalpatilchess (GitHub profile)

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open http://localhost:3000 with your browser to see the result.

You can start editing the page by modifying app/page.tsx. The page auto-updates as you edit the file.

This project uses next/font to automatically optimize and load Geist, a new font family for Vercel.

## Engine service (dev)
- The local engine-service listens on `PORT` (default `4000`).
- Set `CLOUD_ENGINE_URL=http://localhost:4000/engine/eval` in your Next.js env to proxy `/api/engine/eval`.

## Learn More

To learn more about Next.js, take a look at the following resources:

- Next.js Documentation: https://nextjs.org/docs
- Learn Next.js: https://nextjs.org/learn

You can check out the Next.js GitHub repository: https://github.com/vercel/next.js

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the Vercel Platform:
https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme

Check out the Next.js deployment documentation for more details:
https://nextjs.org/docs/app/building-your-application/deploying

## Engine Eval Cache Tuning

Suggested defaults for the proxy cache (set as env vars on the Next.js app):

- Replay scrubbing (dev): ENGINE_EVAL_CACHE_TTL_MS=30000, ENGINE_EVAL_CACHE_MAX_ENTRIES=1000, ENGINE_EVAL_MIN_REEVAL_MS=1200
- Live viewing (prod): ENGINE_EVAL_CACHE_TTL_MS=15000, ENGINE_EVAL_CACHE_MAX_ENTRIES=400, ENGINE_EVAL_MIN_REEVAL_MS=1200

## Manifest Verification (Dev-only)
- Set `ALLOW_DEV_MANIFEST_CHECK=true` in your environment (dev only).
- Authenticate with an admin session or supply the header `x-admin-secret: $ADMIN_SECRET`.
- Example curl:
  `curl -H "x-admin-secret: $ADMIN_SECRET" "http://localhost:3000/api/dev/manifest/check?boardId=7-1"`
- The response lists MP4/manifest counts, any missing sidecars, and sample manifest data to inspect.

## Recording Cleanup (Dev-only)
- Set `ALLOW_DEV_CLEANUP=true` before starting the dev server (never enable in production).
- Authenticate with an admin cookie or send the header `x-admin-secret: $ADMIN_SECRET`.
- Dry-run example:
  `curl -H "x-admin-secret: $ADMIN_SECRET" "http://localhost:3000/api/dev/cleanup?boardId=7-1&olderThanDays=45"`
- Provide `dryRun=0` when you actually want to delete old recordings; defaults to dry-run.

## LiveChessCloud Probe (Dev-only)
- Set `ALLOW_DEV_LCC_PROBE=true` in your environment (dev only).
- Authenticate with an admin session or supply the header `x-admin-secret: $ADMIN_SECRET`.
- Example request:
  `curl -H "x-admin-secret: $ADMIN_SECRET" "http://localhost:3000/api/dev/lcc/probe?tournamentId=<TOURNAMENT_ID>&round=1&limit=32&debug=1"`

## License
Proprietary prototype. Update when ready for public release.
