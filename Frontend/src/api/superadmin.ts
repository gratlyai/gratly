import { api } from "./client";

export type RestaurantRoutingSummary = {
  restaurantId: number;
  restaurantGuid?: string | null;
  restaurantName?: string | null;
  provider: "stripe" | "astra";
  locked: boolean;
  updatedByUserId?: number | null;
  updatedAt?: string | null;
  bankLast4?: string | null;
  bankName?: string | null;
  usBankPaymentMethodId?: string | null;
  adminUsers?: string | null;
};

export async function fetchRestaurantRoutingSummary(
  userId: number,
): Promise<RestaurantRoutingSummary[]> {
  return api.get<RestaurantRoutingSummary[]>(`/superadmin/restaurants?user_id=${userId}`);
}

export type OnboardRestaurantPayload = {
  userId: number;
  restaurantGuid: string;
  secretKey: string;
  clientSecret: string;
  userAccessType: string;
  adminName: string;
  adminEmail: string;
  restaurantName?: string;
};

export type OnboardRestaurantResponse = {
  success: boolean;
  restaurantId: number;
  inviteId: number;
  signupLink: string;
};

export async function onboardRestaurant(
  payload: OnboardRestaurantPayload,
): Promise<OnboardRestaurantResponse> {
  return api.post<OnboardRestaurantResponse>("/superadmin/onboard-restaurant", payload);
}
