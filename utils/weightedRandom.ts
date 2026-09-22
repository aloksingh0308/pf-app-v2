type WeightedItem = {
  weight: number;
};

export function weightedRandom<T extends WeightedItem>(items: T[]): T | null {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  const normalized = items
    .map((item) => ({
      item,
      weight: Number(item.weight) > 0 ? Number(item.weight) : 0,
    }))
    .filter((row) => row.weight > 0);

  if (normalized.length === 0) {
    return null;
  }

  const totalWeight = normalized.reduce((sum, row) => sum + row.weight, 0);
  let cursor = Math.random() * totalWeight;

  for (const row of normalized) {
    cursor -= row.weight;
    if (cursor <= 0) {
      return row.item;
    }
  }

  return normalized[normalized.length - 1].item;
}
