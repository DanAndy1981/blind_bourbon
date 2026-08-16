# Data Model

```text
games/{gameCode}
  code, title, eventDate, theme, phase, hostUid, publicAverages

  players/{playerId}
    id, name, order, active, claimedBy, bonusPoints

  bottles/{letter}
    letter, order, active, revealed

  bottleDetails/{letter}
    letter, name, distillery, retailPrice, proof, notes

  responses/{playerId_letter}
    playerId, bottleLetter, buyChoice, priceGuess, proofGuess,
    finalRank, notes, priceHL, proofHL

```

Each player's `finalRank` values also determine that player's winner and last-place picks: rank 1 is the winner pick, and the highest valid rank is the last-place pick. Older games may still contain legacy `picks` documents; the current app ignores them and reset cleanup removes them.
