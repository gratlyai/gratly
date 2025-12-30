import { api } from "./client";

export type RestaurantDebitPayload = {
  settlementId: string;
  restaurantId?: number;
  restaurantGuid?: string;
  businessDate?: string;
};

export type RestaurantDebitResponse = {
  id: string;
  clientSecret?: string;
  status?: string;
  amount?: number;
};

export async function createRestaurantDebit(
  payload: RestaurantDebitPayload,
): Promise<RestaurantDebitResponse> {
  return api.post<RestaurantDebitResponse>("/payments/restaurant-debit", payload);
}
