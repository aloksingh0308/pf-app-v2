import type { DealMenuView } from '@/types/Deal';
import type { FoodType } from '@/types/Product';
import { apiClient } from '../utils/apiClient';
import { BackendDeal, mapBackendDeal } from './dealsService';
import type { BranchOfferRecord } from './offersService';
import { BackendDirectoryRestaurant, mapDirectoryRestaurant, RestaurantRecord } from './restaurantService';

/** A combo as shown on the Today's Best Deals tab — the same DealMenuView shape the
 *  restaurant screen's combos use (so buildCartItemsForDeal/buildDealDescription work on it
 *  unchanged), plus the food types of the dishes inside it for the veg/non-veg mark. */
export type TodaysDeal = DealMenuView & { foodTypes: FoodType[] };

export type TodaysDealsRow = {
  restaurant: RestaurantRecord;
  deals: TodaysDeal[];
  offers: BranchOfferRecord[];
};

interface BackendTodaysDealsRow {
  restaurant: BackendDirectoryRestaurant;
  deals: BackendDeal[];
  offers: BranchOfferRecord[];
}

/** Every live combo and promotional offer across all restaurants the customer can order
 *  from, one row per restaurant, already in the backend ranking engine's order (see
 *  publicOrderingService.getTodaysBestDeals) — never re-sorted here. Item names come back
 *  with each combo, so no per-restaurant menu fetch is needed just to describe them. */
export const getTodaysBestDeals = async (coords?: { latitude: number; longitude: number } | null): Promise<TodaysDealsRow[]> => {
  const query = coords ? `?lat=${coords.latitude}&lng=${coords.longitude}` : '';
  const rows = await apiClient.get<BackendTodaysDealsRow[]>(`/public/todays-deals${query}`);
  return rows.map(mapTodaysDealsRow);
};

/** One page of restaurant rows for the tab's infinite scroll (a backend that doesn't page
 *  this yet returns them all as one page). */
export const pageTodaysBestDeals = async (
  coords: { latitude: number; longitude: number } | null | undefined,
  page: number
): Promise<{ items: TodaysDealsRow[]; hasMore: boolean }> => {
  const query = coords ? `?lat=${coords.latitude}&lng=${coords.longitude}` : '';
  const result = await apiClient.getPage<BackendTodaysDealsRow>(`/public/todays-deals${query}`, page, 10);
  return { items: result.items.map(mapTodaysDealsRow), hasMore: result.hasMore };
};

function mapTodaysDealsRow(row: BackendTodaysDealsRow): TodaysDealsRow {
  return {
    restaurant: mapDirectoryRestaurant(row.restaurant),
    offers: row.offers,
    deals: row.deals.map((deal) => ({
      ...mapBackendDeal(deal),
      resolvedItems: deal.items.map((item) => ({ itemId: item.menuItemId, qty: item.quantity, name: item.name || 'Item' })),
      foodTypes: Array.from(new Set(deal.items.map((item) => item.foodType || 'VEG'))),
    })),
  };
}
