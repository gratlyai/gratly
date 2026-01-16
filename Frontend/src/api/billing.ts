import { api } from "./client";

export type BillingConfig = {
  billingDate: number | null;
  billingAmount: number | null;
  paidStatus: string | null;
  moovAccountId: string | null;
  onboardingStatus: string | null;
};

export type PaymentMethod = {
  id: string;
  moovPaymentMethodId: string;
  methodType: string;
  brand: string | null;
  last4: string | null;
  status: string;
  isPreferred: boolean;
  isVerified: boolean;
};

export type MonthlyInvoice = {
  id: number;
  billingPeriod: string;
  amountCents: number;
  currency: string;
  moovInvoiceId: string | null;
  moovInvoiceStatus: string | null;
  paymentStatus: string | null;
  dueDate: string | null;
  paidAt: string | null;
  failureReason: string | null;
  createdAt: string;
};

export type BillingSummary = {
  config: BillingConfig;
  paymentMethods: PaymentMethod[];
  upcomingInvoice: {
    dueDate: string;
    amountCents: number;
  } | null;
  recentInvoices: MonthlyInvoice[];
};

export async function fetchBillingConfig(restaurantId: number): Promise<BillingConfig> {
  return api.get<BillingConfig>(
    `/api/billing/config?restaurant_id=${restaurantId}`
  );
}

export async function fetchBillingSummary(restaurantId: number): Promise<BillingSummary> {
  return api.get<BillingSummary>(
    `/api/billing/summary?restaurant_id=${restaurantId}`
  );
}

export async function fetchPaymentMethods(restaurantId: number): Promise<PaymentMethod[]> {
  const response = await api.get<{ methods: PaymentMethod[] }>(
    `/api/restaurants/${restaurantId}/moov/payment-methods`
  );
  return response.methods || [];
}

export async function fetchInvoices(
  restaurantId: number,
  limit: number = 10
): Promise<MonthlyInvoice[]> {
  const response = await api.get<{ invoices: MonthlyInvoice[] }>(
    `/api/billing/invoices?restaurant_id=${restaurantId}&limit=${limit}`
  );
  return response.invoices || [];
}

export async function startPaymentMethodOnboarding(
  restaurantId: number,
  returnUrl: string,
  refreshUrl: string
): Promise<{ redirectUrl: string }> {
  return api.post<{ redirectUrl: string }>(
    `/api/restaurants/${restaurantId}/moov/onboarding-link`,
    {
      returnUrl,
      refreshUrl,
    }
  );
}

export async function refreshPaymentMethods(restaurantId: number): Promise<PaymentMethod[]> {
  const response = await api.post<{ methods: PaymentMethod[] }>(
    `/api/restaurants/${restaurantId}/moov/payment-methods/refresh`,
    {}
  );
  return response.methods || [];
}

export async function setPreferredPaymentMethod(
  restaurantId: number,
  methodId: string
): Promise<{ success: boolean }> {
  return api.post<{ success: boolean }>(
    `/api/restaurants/${restaurantId}/moov/payment-methods/preferred`,
    { paymentMethodId: methodId }
  );
}
