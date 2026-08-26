# Fantaszy Szentre

**Smarter Fantasy Decisions**

A mobile-first Fantasy Premier League intelligence dashboard built for a 9-team portfolio.

## V1 features

- Full FPL player list from `bootstrap-static`
- Search/filter by position and club
- **SZxP v0.1** expected points for the next 1–4 Gameweeks
- Expected-minutes / availability adjustment
- Fixture-difficulty adjustment
- Full 4-GW cumulative projections
- Price / transfer-momentum watch
- Injury and availability centre
- Nine pre-configured FPL entries
- Latest publicly available squad and score for each entry
- Captain watch
- Candidate transfer engine
- Portfolio-specific team objectives
- Mobile-first interface

## Your 9 teams

- Joaoassic Park — 113200
- Permas Jaya FC — 119375
- KK Old Boys FC — 114940
- Toastin Adarabioyo — 139195
- Enzopreneur — 131073
- Colwill of Fortune — 132558
- Palmerlaysia Boleh! — 128817
- Roger and Out — 137607
- Petrol Neto — 130090

## How the data works

The app reads public FPL JSON endpoints directly from the browser:

- `/api/bootstrap-static/`
- `/api/fixtures/`
- `/api/entry/{id}/`
- `/api/entry/{id}/history/`
- `/api/entry/{id}/event/{gw}/picks/`

No FPL password is requested or stored.

### Important public API limitation

Pre-deadline transfers/picks are private. Public entry endpoints normally expose the latest locked/published Gameweek squad, so transfer suggestions should be treated as a baseline until the current private squad is confirmed.

## SZxP v0.1

The first projection model blends:

- FPL `ep_next` when available for the immediate Gameweek
- points per game
- current form
- expected goal involvements per 90
- bonus tendency
- expected minutes
- injury / chance of playing
- home/away
- FPL fixture difficulty

The aim of V1 is to establish a transparent baseline. It should be calibrated after each Gameweek against actual points before it is treated as a mature predictive model.

## Run locally

Because this is a static app, any simple local web server works. For example:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Deploy

The easiest route is GitHub Pages:

1. Create a public repository.
2. Upload `index.html`, `styles.css`, and `app.js` to the repository root.
3. Open **Settings → Pages**.
4. Choose **Deploy from a branch**.
5. Select your main branch and `/root`.
6. Save.

The same files can also be hosted on Netlify, Cloudflare Pages or another static host.

## Next build targets

### V1.1 — Projection calibration
- Store predicted vs actual points each GW
- Position-specific models
- Club attacking/defensive strength
- bookie/market probabilities if a permitted source is added
- richer expected-minutes model
- defensive contribution modelling

### V1.2 — Planner
- Manual current-squad editor before deadline
- Exact selling prices and bank entry
- 1FT / 2FT / -4 comparison
- captain and vice-captain optimiser
- bench order optimiser

### V1.3 — Portfolio intelligence
- player exposure across all nine squads
- correlated-risk warnings
- diversification targets by competition type
- monthly / weekly / cup strategy profiles

### V2 — Backend
Move FPL fetching and model computation to a backend/database so the site can cache historical projections, run scheduled jobs, monitor price changes and provide richer analytics.
