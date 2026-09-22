// types/Categories.ts
export interface Category {
  id: string;
  name: string;
  icon: string;
  available: boolean;
  restaurantId?: string;
  cafeId?: string;
  displayOrder?: number;
}
