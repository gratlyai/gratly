import { api } from "./client";

export type BillingConfig = {
  billingDate?: number | null;
  billingAmount?: number | null;
  paidStatus?: string | null;
};

export type PaymentMethod = {
  id: string;
  moovPaymentMethodId: string;
  methodType: string;
  brand?: string | null;
  last4?: string | null;
  status: string;
  isPreferred: boolean;
  isVerified: boolean;
};

export type MonthlyInvoice = {
  id: number;
  billingPeriod: string;
  amountCents: number;
  currency: string;
  moovInvoiceId?: string | null;
  moovInvoiceStatus?: string | null;
  paymentStatus?: string | null;
  dueDate?: string | null;
  paidAt?: string | null;
  failureReason?: string | null;
  createdAt: string;
};

export type BillingSummary = {
  config: BillingConfig;
  paymentMethods: PaymentMethod[];
  upcomingInvoice?: {
    dueDate?: string | null;
    amountCents: number;
  } | null;
  recentInvoices: MonthlyInvoice[];
};

export type InvoiceListResponse = {
  invoices: MonthlyInvoice[];
};

export async function fetchBillingSummary(restaurantId: number): Promise<BillingSummary> {
  return api.get<BillingSummary>(`/api/billing/summary?restaurant_id=${restaurantId}`);
}

export async function fetchInvoices(restaurantId: number, limit: number = 10): Promise<InvoiceListResponse> {
  return api.get<InvoiceListResponse>(`/api/billing/invoices?restaurant_id=${restaurantId}&limit=${limit}`);
}

export async function createBillingPaymentMethodLink(
  restaurantId: number,
  returnUrl: string,
  refreshUrl?: string,
): Promise<{ url: string }> {
  return api.post<{ url: string }>(`/api/restaurants/${restaurantId}/moov/onboarding-link`, {
    returnUrl,
    refreshUrl,
  });
}
