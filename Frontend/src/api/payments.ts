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

export type RecentSettlement = {
  settlementId: string;
  employeeGuid?: string | null;
  employeeName?: string | null;
  amount: number;
  businessDate?: string | null;
  createdAt?: string | null;
};

export type RecentSettlementsResponse = {
  settlements: RecentSettlement[];
};

export async function createRestaurantDebit(
  payload: RestaurantDebitPayload,
): Promise<RestaurantDebitResponse> {
  return api.post<RestaurantDebitResponse>("/payments/restaurant-debit", payload);
}

export async function fetchRecentSettlements(
  userId: number,
  limit = 5,
): Promise<RecentSettlementsResponse> {
  const params = new URLSearchParams({ user_id: String(userId), limit: String(limit) });
  return api.get<RecentSettlementsResponse>(`/recent-settlements?${params.toString()}`);
}
