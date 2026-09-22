import { getAddons } from './menuService';

export type AddonItem = {
  id: string;
  name: string;
  imageUrl: string;
  price: number;
  isAdOns: boolean;
  isAvailable: boolean;
};

/** Replaces the original Firestore query (`menuItems` where `isAdOns == true`) — the new
 *  backend has a dedicated Addon collection instead of a flag on menu items, fetched via
 *  menuService.getAddons(). The "recommend addons based on cart item names" logic below is
 *  unchanged from the original — it only ever operated on already-fetched data, never on
 *  Firestore directly. */
export async function fetchAddons(cartItems: string[]): Promise<AddonItem[]> {
  const backendAddons = await getAddons();
  const addons: AddonItem[] = backendAddons.map((a) => ({
    id: a.id,
    name: a.name,
    imageUrl: '',
    price: a.price,
    isAdOns: true,
    isAvailable: a.isActive,
  }));

  // Recommendation logic (simple example)
  const recommendations: Record<string, string[]> = {
    biryani: ['rabadi', 'lassi'],
    burger: ['fries', 'cold coffee'],
    chinese: ['ice cream', 'chocolate'],
  };
  let prioritized: AddonItem[] = [];
  for (const item of cartItems) {
    const recs = recommendations[item.toLowerCase()];
    if (recs) {
      prioritized = [
        ...prioritized,
        ...addons.filter(a => recs.includes(a.name.toLowerCase())),
      ];
    }
  }
  // Remove duplicates and fill with popular if needed
  const unique = new Map(prioritized.map(a => [a.id, a]));
  addons.forEach(a => {
    if (!unique.has(a.id)) unique.set(a.id, a);
  });
  return Array.from(unique.values()).slice(0, 8);
}
