# Blind Bourbon Derby

A phone-friendly blind bourbon tasting game for **2–10 players** and **2–10 mystery bottles**. The visual language comes directly from the supplied retro Nashville scorecard: cream paper, heavy ink, Tennessee red/navy/gold, ribbon headings, and the gloriously over-served moose.

The site has no build step. It is plain HTML, CSS, and JavaScript, so the front end can live on GitHub Pages. Firebase supplies the shared live data needed for several phones to participate in the same game.

## What is included

- Facilitator setup for event details and secret bourbon information
- QR self-registration for up to 10 player-created names
- A join link and six-character game code
- One claimed mobile scorecard per player
- Automatic saving on each phone
- `Hell Yes / Maybe / Nope`, price guess, proof guess, tasting notes, and unique final ranking
- Winner and last-place picks derived automatically from each player's unique final rankings
- A facilitator-controlled Higher / Lower round using the club's average price and proof guesses
- Last-to-first bottle reveals
- Automatic scoring and live leaderboards
- Derby Champion, Punches Above Its Weight, Biggest Waste of Money, Bourbon Savant, and a deliberately awful Biggest Loser award
- An always-active, phase-aware retro TV gameboard for Chromecast
- Manual trivia/bonus points
- Installable app icons and an offline app shell
- A populated single-browser demo that works before Firebase is configured

## Scoring carried over from the workbook

| Category | Points |
|---|---:|
| Price Higher / Lower | 1 per active bottle |
| Proof Higher / Lower | 1 per active bottle |
| Price Is Right | 3 for closest without going over; 2 for the lowest guess when everyone goes over |
| Rank the club winner #1 | 5 |
| Rank the club last-place bottle last | 3 |
| Trivia / bonus | Facilitator enters the points |

Bottle finish is based on average final rank, with `Hell Yes` votes and then `Maybe` votes as tie-breakers. Punches Above Its Weight goes to the less-expensive bottle that most outruns its price rank. Biggest Waste of Money goes to the expensive bottle that falls farthest below its price rank.

An exact actual price or proof matching the club average is a push, so neither Higher nor Lower earns a point. Matching Price Is Right winning guesses all receive the available points. Players with the same final score share the same rank (and the crown when tied for first). If bottle averages and buy votes are all tied, setup/sample order is the final bottle tie-breaker.

## Run the local demo

Because the app uses JavaScript modules, serve the folder rather than double-clicking `index.html`.

```bash
cd blind-bourbon-derby
python -m http.server 8000
```

Open `http://localhost:8000`, then choose **Open the Populated Demo**. Local demo mode stores everything in that one browser. It is for testing, not for the actual multi-phone party.

## Turn on live multi-phone play

Follow [`FIREBASE_SETUP.md`](./FIREBASE_SETUP.md). The short version is:

1. Create a Firebase project and web app.
2. Enable Anonymous Authentication.
3. Create Cloud Firestore.
4. Publish the included `firestore.rules`.
5. Paste the web app configuration into `firebase-config.js`.
6. Push this folder to GitHub and turn on GitHub Pages.

## Facilitator workflow

1. The facilitator opens the site, enters the event and secret bottle details, then creates the game.
2. She opens the scoreboard on the TV.
3. Guests scan its QR code, invent their own names, and register their player cards (up to 10).
4. The facilitator keeps the booth open on her phone or laptop.
5. She advances the round from **Setup** to **Blind Tasting**, **Higher / Lower**, **The Reveal**, and **Final Results**.
6. During the reveal, she can reveal one bottle at a time from last place to first.

Only rows with a Bourbon name are active. Blank setup rows never appear on player cards, and the field is capped at samples A–J. The separate Live Results URL is designed to stay open on a TV all night. It automatically changes from contestant check-in to the live mystery-glass progress race, Higher / Lower game-show set, bottle reveal, and final awards without clicks or scrolling.

The browser that creates a live game owns the facilitator controls through Firebase's anonymous sign-in. Use the same browser/device all night. Avoid clearing that browser's site data until the event is over.

### Event-night checklist

- Use a normal browser rather than an incognito/private window, especially for the facilitator.
- Plug in the facilitator and TV devices, disable automatic sleep, and keep the booth and scoreboard open.
- After publishing a new version, reload the facilitator and scoreboard once before creating the real game.
- Watch the persistent **Live / Reconnecting / Offline** badge. It can be tapped to reconnect immediately.
- Ask players to wait for **Saved** before locking their phones. If a write fails, their queued answers remain on the card and **Retry Save** sends them again.
- Round changes warn when active players are unfinished, but the facilitator can deliberately continue when somebody has stepped away.

## GitHub Pages

The project is intentionally deployable from the repository root:

- Branch: `main`
- Folder: `/ (root)`
- Entry file: `index.html`

All URLs and assets are relative, so the app works both on a custom domain and under a normal `username.github.io/repository-name/` path.

## Project structure

```text
blind-bourbon-derby/
├── index.html
├── 404.html
├── firebase-config.js
├── firebase.json
├── firestore.rules
├── manifest.webmanifest
├── sw.js
├── css/styles.css
├── js/app.js
├── js/event-guardrails.js
├── js/live-game-subscription.js
├── js/scoreboard.js
├── js/setup.js
├── js/store.js
├── js/scoring.js
└── assets/
```

## Practical notes

- Player cards stay blind through the reveal and Final Results. Secret bottle details appear only in the facilitator booth and on Live Results for bottles the facilitator has explicitly revealed.
- Before the reveal, player documents expose only sanitized completion percentages and finished sample letters so the TV can animate progress without exposing anybody's guesses or rankings.
- This is a party game, not a hardened competition platform. A technically determined guest could still inspect front-end behavior or attempt to manipulate his own answers.
- Do not commit unrelated private Firebase credentials. Firebase's web configuration is designed to be present in client code; the included Firestore rules are what enforce access.
- Live games use role-scoped Firestore listeners: the TV receives public progress immediately, each participant receives only that player's responses, and the facilitator receives the full scoring dataset.
