# Blind Bourbon Derby

A phone-friendly blind bourbon tasting game for **2–10 players** and **2–10 mystery bottles**. The visual language comes directly from the supplied retro Nashville scorecard: cream paper, heavy ink, Tennessee red/navy/gold, ribbon headings, and the gloriously over-served moose.

The site has no build step. It is plain HTML, CSS, and JavaScript, so the front end can live on GitHub Pages. Firebase supplies the shared live data needed for several phones to participate in the same game.

## What is included

- Facilitator setup for player names, event details, and secret bourbon information
- A join link and six-character game code
- One claimed mobile scorecard per player
- Automatic saving on each phone
- `Hell Yes / Maybe / Nope`, price guess, proof guess, tasting notes, and unique final ranking
- Winner and last-place picks
- A facilitator-controlled Higher / Lower round using the club's average price and proof guesses
- Last-to-first bottle reveals
- Automatic scoring and live leaderboards
- Derby Champion, Value Champion, Bourbon Savant, and Biggest Upset awards
- Manual trivia/bonus points
- Installable app icons and an offline app shell
- A populated single-browser demo that works before Firebase is configured

## Scoring carried over from the workbook

| Category | Points |
|---|---:|
| Price Higher / Lower | 1 per active bottle |
| Proof Higher / Lower | 1 per active bottle |
| Price Is Right | 3 for closest without going over; 2 for the lowest guess when everyone goes over |
| Pick the winner | 5 |
| Pick last place | 3 |
| Trivia / bonus | Facilitator enters the points |

Bottle finish is based on average final rank, with `Hell Yes` votes and then `Maybe` votes as tie-breakers. Value Champion uses finish relative to retail price. Biggest Upset compares price rank with blind club finish.

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

1. The facilitator opens the site and selects **Start a Derby**.
2. She adds the players and secret bottle details, then creates the game.
3. She texts or shares the displayed player link.
4. Each guest opens the link, selects his own name, and claims that player card.
5. She advances the round from **Setup** to **Blind Tasting**, **Higher / Lower**, **The Reveal**, and **Final Results**.
6. During the reveal, she can reveal one bottle at a time from last place to first.

The browser that creates a live game owns the facilitator controls through Firebase's anonymous sign-in. Use the same browser/device all night. Avoid clearing that browser's site data until the event is over.

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
├── firestore.rules
├── manifest.webmanifest
├── sw.js
├── css/styles.css
├── js/app.js
├── js/store.js
├── js/scoring.js
└── assets/
```

## Practical notes

- The secret bottle documents are hidden from ordinary players until each bottle is revealed or the game reaches Final Results.
- This is a party game, not a hardened competition platform. A technically determined guest could still inspect front-end behavior or attempt to manipulate his own answers.
- Do not commit unrelated private Firebase credentials. Firebase's web configuration is designed to be present in client code; the included Firestore rules are what enforce access.
- The app polls for changes roughly every few seconds, which is plenty quick for a tasting and keeps the code simple.
