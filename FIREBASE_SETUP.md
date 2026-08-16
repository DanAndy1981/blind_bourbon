# Firebase + GitHub Pages Setup

The front end can be hosted entirely on GitHub Pages, but GitHub Pages does not provide a shared database. Firebase gives the facilitator and all player phones one live game state.

## 1. Create the Firebase project

1. Open the Firebase console and choose **Create a project**.
2. Give it a name such as `blind-bourbon-derby`.
3. Google Analytics is optional for this party app.
4. From the project overview, choose the **Web** app button (`</>`).
5. Register a web app. Firebase will show a configuration object containing `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, and `appId`.

Do not select Firebase Hosting; GitHub Pages will host the site.

## 2. Enable anonymous sign-in

1. In Firebase, open **Build → Authentication**.
2. Choose **Get started**.
3. Open **Sign-in method**.
4. Enable **Anonymous** and save.

Each phone gets a persistent anonymous Firebase identity. The browser that creates the game becomes the facilitator for that game.

## 3. Create Cloud Firestore

1. Open **Build → Firestore Database**.
2. Choose **Create database**.
3. Start in **Production mode**.
4. Pick a region reasonably close to Tennessee and finish creation.

## 4. Publish the security rules

1. In Firestore, open the **Rules** tab.
2. Replace the editor contents with everything in [`firestore.rules`](./firestore.rules).
3. Select **Publish**.

These rules allow players to see names and mystery letters, write only to the player card they claimed, and keep bottle names/prices/proofs hidden until reveal. The game creator can manage the facilitator booth.

## 5. Paste the Firebase web configuration

Open [`firebase-config.js`](./firebase-config.js) and replace the `PASTE_*` values with the values from the Firebase web-app configuration.

Example shape:

```js
window.DERBY_FIREBASE_CONFIG = {
  apiKey: "your-api-key",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.firebasestorage.app",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abc123"
};
```

The Firebase web configuration is not a server password. Do not weaken the Firestore rules; those rules are the important protection.

## 6. Test live mode locally

From the project folder:

```bash
python -m http.server 8000
```

Open `http://localhost:8000`. The pill in the upper-right should say **Live shared mode** rather than **Local demo mode**.

Recommended test:

1. Create a two-player, two-bottle game in a normal browser window.
2. Copy the player link.
3. Open the link in a private/incognito window to simulate another phone.
4. Claim one player in each window.
5. Enter answers, advance rounds from the host window, and verify both windows update.

## 7. Publish with GitHub Pages

1. Create a GitHub repository and put all files from this folder at the repository root.
2. Push the files to the `main` branch.
3. In the repository, open **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select branch `main`, folder `/ (root)`, and save.
6. Wait for GitHub to publish the site, then open the Pages URL shown in the same settings screen.

The facilitator can now create the game from that URL and share the generated player link.

## 8. Party-night checklist

- Create the game on the facilitator's actual phone/tablet/laptop.
- Do not use a private/incognito window for the facilitator.
- Do not clear browser data after creating the game.
- Confirm every guest sees his own name as available before tasting.
- Keep the facilitator booth open during the event.
- Use **Release player card** if someone claimed the wrong name or changed phones.

## Troubleshooting

**The site says Local demo mode**  
One or more `firebase-config.js` values still contain `PASTE_`, or the config file did not deploy.

**The derby could not start**  
Anonymous Authentication is usually not enabled yet, or the Firestore rules were not published.

**A guest cannot claim a name**  
Another browser already owns it. In the facilitator booth, use the circular release button beside that player.

**Players cannot save answers**  
Confirm the exact included Firestore rules are published and the player claimed his name from that same browser.

**The facilitator controls disappeared**  
The host identity is tied to the anonymous Firebase user in the browser that created the game. Return to that browser/device. If its site data was cleared, create a new game.

**A newly deployed change does not appear**  
The service worker may still have the previous app shell. Reload once or close/reopen the page. Updating the `CACHE_NAME` in `sw.js` forces a fresh app-shell cache.
