import { api } from "./client";

export type MoovConnection = {
  connected: boolean;
  moov_account_id?: string | null;
  moovAccountId?: string | null;
  onboardingStatus?: string | null;
  onboarding_status?: string | null;
  status?: string | null;
  kyb_status?: string | null;
  kyc_status?: string | null;
};

export type MoovPaymentMethod = {
  id: number;
  moovPaymentMethodId: string;
  methodType: string;
  brand?: string | null;
  last4?: string | null;
  status?: string | null;
  isPreferred?: boolean;
  isVerified?: boolean;
};

export type MoovRedirectResponse = {
  redirectUrl: string;
};

export async function startRestaurantOnboarding(
  restaurantId: number,
  returnUrl: string,
  refreshUrl?: string,
): Promise<MoovRedirectResponse> {
  return api.post<MoovRedirectResponse>(`/api/restaurants/${restaurantId}/moov/onboarding-link`, {
    returnUrl,
    refreshUrl,
  });
}

export async function startEmployeeOnboarding(
  userId: number,
  returnUrl: string,
  refreshUrl?: string,
): Promise<MoovRedirectResponse> {
  return api.post<MoovRedirectResponse>(`/api/employees/${userId}/moov/onboarding-link`, {
    returnUrl,
    refreshUrl,
  });
}

export async function fetchRestaurantConnection(restaurantId: number): Promise<MoovConnection> {
  return api.get<MoovConnection>(`/api/restaurants/${restaurantId}/moov/connection`);
}

export async function fetchEmployeeConnection(userId: number): Promise<MoovConnection> {
  return api.get<MoovConnection>(`/api/employees/${userId}/moov/connection`);
}

export async function fetchRestaurantPaymentMethods(
  restaurantId: number,
): Promise<{ methods: MoovPaymentMethod[] }> {
  return api.get<{ methods: MoovPaymentMethod[] }>(
    `/api/restaurants/${restaurantId}/moov/payment-methods`,
  );
}

export async function fetchEmployeePaymentMethods(
  userId: number,
): Promise<{ methods: MoovPaymentMethod[] }> {
  return api.get<{ methods: MoovPaymentMethod[] }>(`/api/employees/${userId}/moov/payment-methods`);
}

export async function refreshRestaurantPaymentMethods(
  restaurantId: number,
): Promise<{ methods: MoovPaymentMethod[] }> {
  return api.post<{ methods: MoovPaymentMethod[] }>(
    `/api/restaurants/${restaurantId}/moov/payment-methods/refresh`,
    {},
  );
}

export async function refreshEmployeePaymentMethods(
  userId: number,
): Promise<{ methods: MoovPaymentMethod[] }> {
  return api.post<{ methods: MoovPaymentMethod[] }>(
    `/api/employees/${userId}/moov/payment-methods/refresh`,
    {},
  );
}

export async function setRestaurantPreferredPaymentMethod(
  restaurantId: number,
  paymentMethodId: string,
): Promise<{ success: boolean }> {
  return api.post<{ success: boolean }>(
    `/api/restaurants/${restaurantId}/moov/payment-methods/preferred`,
    { paymentMethodId },
  );
}

export async function setEmployeePreferredPaymentMethod(
  userId: number,
  paymentMethodId: string,
): Promise<{ success: boolean }> {
  return api.post<{ success: boolean }>(`/api/employees/${userId}/moov/payment-methods/preferred`, {
    paymentMethodId,
  });
}
