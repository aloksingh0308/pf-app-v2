import { apiClient } from '../utils/apiClient';

/**
 * Replaces the original app's Firestore `customers/{uid}/addresses` subcollection with the
 * customer-app account's own address book (backend/src/services/customerAddress.service.ts)
 * — platform-wide, same as the account itself, so a saved address is usable while ordering
 * from any restaurant, not just one. `userId` params are accepted for interface-
 * compatibility with existing call sites but ignored — the backend resolves the account
 * from the request's own auth token, never a client-supplied id.
 */

export type UserAddress = {
  id: string;
  userId: string;
  addressLine: string;
  /** House/flat/floor text and the map-resolved location `addressLine` was built from —
   *  null on addresses saved before the backend kept them apart. */
  details?: string | null;
  mapAddress?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  label?: string;
  isDefault?: boolean;
  createdAt?: any;
  updatedAt?: any;
};

interface BackendAddress {
  _id: string;
  addressLine: string;
  details?: string | null;
  mapAddress?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  label: string;
  isDefault: boolean;
  createdAt: string;
}

function mapBackendAddress(userId: string, address: BackendAddress): UserAddress {
  return {
    id: address._id,
    userId,
    addressLine: address.addressLine,
    details: address.details ?? null,
    mapAddress: address.mapAddress ?? null,
    latitude: address.latitude,
    longitude: address.longitude,
    label: address.label,
    isDefault: address.isDefault,
    createdAt: address.createdAt,
  };
}

type AddressPayload = {
  addressLine: string;
  details?: string | null;
  mapAddress?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  label?: string;
};

export const addressService = {
  async listUserAddresses(userId: string): Promise<UserAddress[]> {
    if (!userId) return [];
    const addresses = await apiClient.get<BackendAddress[]>('/public/customers/me/addresses');
    return addresses.map((address) => mapBackendAddress(userId, address));
  },

  async addUserAddress(
    userId: string,
    payload: AddressPayload
  ): Promise<string> {
    if (!userId) throw new Error('User id is required');
    const address = await apiClient.post<BackendAddress>('/public/customers/me/addresses', payload);
    return address._id;
  },

  async updateUserAddress(
    userId: string,
    addressId: string,
    payload: AddressPayload
  ) {
    if (!userId) throw new Error('User id is required');
    if (!addressId) throw new Error('Address id is required');
    await apiClient.patch(`/public/customers/me/addresses/${addressId}`, payload);
  },

  async deleteUserAddress(userId: string, addressId: string) {
    if (!userId) throw new Error('User id is required');
    if (!addressId) throw new Error('Address id is required');
    await apiClient.delete(`/public/customers/me/addresses/${addressId}`);
  },

  async setDefaultAddress(userId: string, addressId: string) {
    if (!userId) throw new Error('User id is required');
    if (!addressId) throw new Error('Address id is required');
    await apiClient.post(`/public/customers/me/addresses/${addressId}/default`);
  },
};
