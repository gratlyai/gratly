import { api } from "./client";

export type AstraConnection = {
  connected: boolean;
  ownerType?: "restaurant" | "employee";
  ownerId?: number;
  astraUserId?: string | null;
  onboardingStatus?: string | null;
  lastStatusReason?: string | null;
  kyxType?: string | null;
  revokedAt?: string | null;
};

export type AstraPayoutMethod = {
  id: string;
  methodType: "bank_account" | "debit_card";
  astraAccountId?: string | null;
  astraCardId?: string | null;
  label: string;
  brand?: string | null;
  last4?: string | null;
  status?: string | null;
  isPreferred: boolean;
};

export type AstraRedirectResponse = {
  redirectUrl: string;
};

export async function startRestaurantConnect(
  restaurantId: number,
  userId: number,
): Promise<AstraRedirectResponse> {
  return api.post<AstraRedirectResponse>(
    `/api/restaurants/${restaurantId}/astra/connect/start`,
    { userId },
  );
}

export async function startEmployeeConnect(
  userId: number,
): Promise<AstraRedirectResponse> {
  return api.post<AstraRedirectResponse>(
    `/api/employees/${userId}/astra/connect/start`,
    { userId },
  );
}

export async function startRestaurantCardsConnect(
  restaurantId: number,
  userId: number,
): Promise<AstraRedirectResponse> {
  return api.post<AstraRedirectResponse>(
    `/api/restaurants/${restaurantId}/astra/cards/connect/start`,
    { userId },
  );
}

export async function startEmployeeCardsConnect(
  userId: number,
): Promise<AstraRedirectResponse> {
  return api.post<AstraRedirectResponse>(
    `/api/employees/${userId}/astra/cards/connect/start`,
    { userId },
  );
}

export async function fetchRestaurantConnection(
  restaurantId: number,
): Promise<AstraConnection> {
  return api.get<AstraConnection>(`/api/restaurants/${restaurantId}/astra/connection`);
}

export async function fetchEmployeeConnection(
  userId: number,
): Promise<AstraConnection> {
  return api.get<AstraConnection>(`/api/employees/${userId}/astra/connection`);
}

export async function fetchRestaurantPayoutMethods(
  restaurantId: number,
): Promise<{ methods: AstraPayoutMethod[] }> {
  return api.get<{ methods: AstraPayoutMethod[] }>(
    `/api/restaurants/${restaurantId}/astra/payout-methods`,
  );
}

export async function fetchEmployeePayoutMethods(
  userId: number,
): Promise<{ methods: AstraPayoutMethod[] }> {
  return api.get<{ methods: AstraPayoutMethod[] }>(
    `/api/employees/${userId}/astra/payout-methods`,
  );
}

export async function syncRestaurantPayoutMethods(
  restaurantId: number,
): Promise<{ methods: AstraPayoutMethod[]; cardError?: string }> {
  return api.get<{ methods: AstraPayoutMethod[]; cardError?: string }>(
    `/api/restaurants/${restaurantId}/astra/payout-methods/sync`,
  );
}

export async function syncEmployeePayoutMethods(
  userId: number,
): Promise<{ methods: AstraPayoutMethod[]; cardError?: string }> {
  return api.get<{ methods: AstraPayoutMethod[]; cardError?: string }>(
    `/api/employees/${userId}/astra/payout-methods/sync`,
  );
}

export async function setRestaurantPreferredPayoutMethod(
  restaurantId: number,
  payoutMethodId: string,
): Promise<void> {
  await api.post(`/api/restaurants/${restaurantId}/payout-methods/preferred`, {
    payout_method_id: payoutMethodId,
  });
}

export async function setEmployeePreferredPayoutMethod(
  userId: number,
  payoutMethodId: string,
): Promise<void> {
  await api.post(`/api/employees/${userId}/payout-methods/preferred`, {
    payout_method_id: payoutMethodId,
  });
}
