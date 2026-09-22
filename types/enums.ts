export enum OrderType {
  DINE_IN = '1',
  TAKE_AWAY = '2',
  HOME_DELIVERY = '3',
}

export const ORDER_TYPE_OPTIONS = [
  { label: 'Dine In', value: OrderType.DINE_IN },
  { label: 'Take-Away', value: OrderType.TAKE_AWAY },
  { label: 'Home Delivery', value: OrderType.HOME_DELIVERY },
];
