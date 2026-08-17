export const DRUNK_FRIENDLY_RULES = Object.freeze([
  Object.freeze({
    id: 'higher-lower',
    points: '+1 each',
    title: 'Higher? Lower?',
    copy: 'Price and proof each pay 1 point per bottle. Exact actual = club average? Push. Nobody scores that call.',
  }),
  Object.freeze({
    id: 'price-is-right',
    points: '+3 / +2',
    title: 'Price Is Right-ish',
    copy: 'Closest price without going over gets 3. Everybody over? Lowest guess gets 2. Matching winners all score.',
  }),
  Object.freeze({
    id: 'winner-pick',
    points: '+5',
    title: 'Call the Winner',
    copy: 'Rank the club’s eventual champion #1 and pocket 5 points.',
  }),
  Object.freeze({
    id: 'last-pick',
    points: '+3',
    title: 'Spot the Stinker',
    copy: 'Rank the club’s last-place bottle dead last and collect 3.',
  }),
  Object.freeze({
    id: 'bonus',
    points: '+?',
    title: 'Trivia & Bonus',
    copy: 'Whatever bonus points the host awards go straight onto your total. Flattery may or may not help.',
  }),
  Object.freeze({
    id: 'ties',
    points: 'Ties',
    title: 'No Sudden Death',
    copy: 'Same total means a shared place and shared crown. Bottle ties break by Hell Yes votes, then Maybe votes, then sample order.',
  }),
]);
