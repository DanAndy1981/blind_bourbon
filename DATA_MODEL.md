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

  picks/{playerId}
    playerId, winnerPick, lastPick
```
