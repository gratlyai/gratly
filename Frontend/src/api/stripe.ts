import { api } from "./client";

export type SetupIntentResponse = {
  clientSecret: string;
  customerId: string;
};

export type PaymentMethodStatus = {
  configured: boolean;
  customerId?: string;
  paymentMethodId?: string;
  bankLast4?: string | null;
  bankName?: string | null;
  card?: StripeCardSummary | null;
  businessProfile?: StripeBusinessProfile | null;
  capabilities?: Record<string, string> | null;
  defaultCurrency?: string | null;
};

export type StripeCardSummary = {
  brand?: string | null;
  last4?: string | null;
  expMonth?: number | null;
  expYear?: number | null;
  funding?: string | null;
  country?: string | null;
};

export type StripeBusinessProfile = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: Record<string, string | null> | null;
};

export async function createRestaurantSetupIntent(restaurantId: number): Promise<SetupIntentResponse> {
  return api.post<SetupIntentResponse>(`/stripe/restaurants/${restaurantId}/setup-intent`);
}

export async function saveRestaurantPaymentMethod(
  restaurantId: number,
  paymentMethodId: string,
): Promise<void> {
  await api.post(`/stripe/restaurants/${restaurantId}/payment-method`, { paymentMethodId });
}

export async function fetchRestaurantPaymentMethod(
  restaurantId: number,
): Promise<PaymentMethodStatus> {
  return api.get<PaymentMethodStatus>(`/stripe/restaurants/${restaurantId}/payment-method`);
}
