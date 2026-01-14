import { api } from "./client";

export type RestaurantRoutingSummary = {
  restaurantId?: number | null;
  restaurantGuid?: string | null;
  restaurantName?: string | null;
  updatedByUserId?: number | null;
  updatedAt?: string | null;
  adminUsers?: string | null;
};

export async function fetchRestaurantRoutingSummary(
  userId: number,
): Promise<RestaurantRoutingSummary[]> {
  return api.get<RestaurantRoutingSummary[]>(`/superadmin/restaurants?user_id=${userId}`);
}

export type RestaurantDetail = {
  restaurantGuid: string;
  restaurantName?: string | null;
  restaurantId?: number | null;
};

export async function fetchRestaurantDetails(userId: number): Promise<RestaurantDetail[]> {
  return api.get<RestaurantDetail[]>(`/superadmin/restaurant-details?user_id=${userId}`);
}

export type OnboardingDetails = {
  restaurantGuid: string;
  payoutFeePayer?: "restaurant" | "employees" | null;
  payoutFee?: string | null;
  activationDate?: string | null;
  freePeriod?: string | null;
  billingDate?: string | null;
  billingAmount?: string | null;
  adminName?: string | null;
  adminPhone?: string | null;
  adminEmail?: string | null;
};

export async function fetchOnboardingDetails(
  userId: number,
  restaurantGuid: string,
): Promise<OnboardingDetails | null> {
  return api.get<OnboardingDetails | null>(
    `/superadmin/onboarding-details?user_id=${userId}&restaurant_guid=${restaurantGuid}`,
  );
}

export type OnboardRestaurantPayload = {
  userId: number;
  restaurantGuid: string;
  payoutFeePayer?: "restaurant" | "employees" | "";
  payoutFee?: string;
  activationDate?: string;
  freePeriod?: string;
  billingDate?: string;
  billingAmount?: string;
  adminName?: string;
  adminPhone?: string;
  adminEmail?: string;
};

export type OnboardRestaurantResponse = {
  success: boolean;
  restaurantId: number;
};

export async function onboardRestaurant(
  payload: OnboardRestaurantPayload,
): Promise<OnboardRestaurantResponse> {
  return api.post<OnboardRestaurantResponse>("/superadmin/onboard-restaurant", payload);
}

export type BillingConfig = {
  userId?: number | null;
  billingEnabled?: boolean | null;
  billingAmount?: string | null;
  billingDate?: number | null;
};

export async function fetchBillingConfig(userId: number): Promise<BillingConfig | null> {
  return api.get<BillingConfig | null>(`/superadmin/billing-config?user_id=${userId}`);
}

export async function updateBillingConfig(
  userId: number,
  config: BillingConfig,
): Promise<{ success: boolean }> {
  return api.post<{ success: boolean }>("/superadmin/billing-config", { userId, ...config });
}
