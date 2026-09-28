# Gridiron Scoreboard

A live scoreboard for NFL and college football. It is built to be easy to scan on a
phone or a big screen: pick a league, pick a group, and every game is one tap away.

## What it does

- **NFL and college in one place.** Switch leagues at the top. College covers FBS and
  FCS.
- **Top 25 and conference breakdowns.** By default the college slate is split into
  **Top 25**, then each conference (Power 4 first, then Group of 6), then
  non-conference games. The sidebar also filters to Top 25, ranked-vs-ranked
  matchups, a whole tier (Power 4, Group of 6) or a single conference. The NFL
  sidebar does the same for AFC/NFC and each division.
- **Favorite matchups.** Tap the ☆ on any game to pin it to the top of the page.
  Open a game and tap **Follow** on a team, and all of that team's games become
  favorites automatically. You can save games in future weeks ahead of time;
  the Favorites view lists them. Favorites are stored in your browser.
- **Filters.** Live / Upcoming / Final tabs, team search (`Georgia vs Alabama`,
  `UGA @ ALA`, `ohio state`), TV network, grouping (conference, day, status,
  division) and sorting by kickoff or best matchup. Each filter shows how many
  games it would leave, so you never land on an empty page by surprise.
- **Live updates.** Scores refresh every 30 seconds while games are in
  progress, and score changes flash so you notice them. Refreshing slows down
  when nothing is live and pauses when the tab is hidden.
- **Game details.** Tap a game for the quarter-by-quarter line score, down and
  distance, last play, win probability, game leaders, venue, TV and betting
  line.
- **AP Top 25 panel** (college) with each ranked team's result or kickoff this
  week. You can switch to the Coaches Poll, or the CFP rankings once they're
  released.
- **Week picker** for any week of the season, including bowls and playoffs.
- Light and dark themes (follows your device by default), works on phones, and
  every view has a shareable link.

## Run it on your computer

You need [Node.js](https://nodejs.org) 18 or newer. There is nothing to install.

```sh
npm start
```

Then open <http://localhost:8080>. To open it from a phone on the same Wi-Fi,
run `HOST=0.0.0.0 npm start` and visit your computer's IP address on port 8080.

Any static file server also works (for example `python3 -m http.server 8080`).
Opening `index.html` straight from disk does not work, because browsers block
JavaScript modules on `file://` pages.

## Put it online for free

The site is plain HTML, CSS and JavaScript with no build step, so any static
host can serve it.

**GitHub Pages:** in the repository go to **Settings → Pages**, set **Source**
to *Deploy from a branch*, and choose `main` and `/ (root)`. The site appears at
`https://<your-username>.github.io/scoreboard/` a minute later. (Pages is free
for public repositories; private ones need a paid GitHub plan.)

Netlify, Cloudflare Pages and Vercel also work: point them at the repository
root and leave the build command empty.

## Where the scores come from

Scores, schedules and rankings come from ESPN's public scoreboard feed
(`site.api.espn.com`), which needs no account or API key. The browser calls it
directly. If a network blocks that request, the app retries through the small
relay built into `server.js` (only when you run it with `npm start`). The feed
is unofficial, so ESPN could change it. All the parsing is in
`assets/js/normalize.js`, so a change there is a one-file fix.

This project is not affiliated with ESPN, the NFL or the NCAA.

## Customizing

- **Conference realignment:** conference names and tiers (Power 4 / Group of 6)
  are listed in `assets/js/conferences.js`. Team membership comes from the live
  data, so only a tier change needs an edit.
- **Colors and fonts:** the palette is a set of CSS variables at the top of
  `assets/css/styles.css`, with separate light and dark sets.

## Development

```
index.html              page shell
assets/css/styles.css   all styles (light and dark themes, responsive layout)
assets/js/app.js        loading, auto-refresh, URL state and event wiring
assets/js/api.js        ESPN endpoints and fetch with timeout and fallback
assets/js/normalize.js  ESPN JSON → clean game objects
assets/js/views.js      sidebar groups (Top 25, tiers, conferences, divisions)
assets/js/filters.js    filtering, facet counts, sorting and sections
assets/js/favorites.js  favorite matchups and followed teams
assets/js/state.js      preferences, shareable URLs, what's remembered
assets/js/render.js     HTML for cards, sidebar, rankings and the game sheet
server.js               zero-dependency local server and ESPN relay
tests/                  unit tests with sample ESPN responses
```

Run the tests (Node's built-in test runner, no packages needed):

```sh
npm test
```
