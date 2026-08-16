export const BOTTLE_LETTERS = 'ABCDEFGHIJ'.split('');

export function hasBottleSetupInfo(bottle) {
  return Boolean(String(bottle?.name || '').trim());
}

export function activeBottlesFromDraft(bottles = []) {
  return bottles
    .slice(0, BOTTLE_LETTERS.length)
    .filter(hasBottleSetupInfo)
    .map((bottle, order) => ({
      ...bottle,
      name: String(bottle.name || '').trim(),
      order,
      active: true,
    }));
}
