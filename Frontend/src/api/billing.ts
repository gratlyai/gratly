import { api } from "./client";

export type BillingSummary = {
  subscription: {
    status: string;
    planKey: string | null;
    priceId: string;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    trialEnd: string | null;
  } | null;
  paymentMethod: {
    brand: string | null;
    last4: string | null;
  } | null;
};

export type InvoiceRecord = {
  id: string;
  number: string | null;
  status: string;
  amountDue: number;
  amountPaid: number;
  currency: string;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
  created: string | null;
};

export type InvoiceListResponse = {
  invoices: InvoiceRecord[];
  hasMore: boolean;
  nextStartingAfter: string | null;
};

export async function createCheckoutSession(): Promise<{ url: string }> {
  return api.post<{ url: string }>("/api/billing/checkout", {});
}

export async function createBillingPortal(): Promise<{ url: string }> {
  return api.post<{ url: string }>("/api/billing/portal");
}

export async function fetchBillingSummary(): Promise<BillingSummary> {
  return api.get<BillingSummary>("/api/billing/summary");
}

export async function fetchInvoices(
  limit = 10,
  startingAfter?: string | null,
): Promise<InvoiceListResponse> {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (startingAfter) {
    params.set("starting_after", startingAfter);
  }
  const query = params.toString();
  return api.get<InvoiceListResponse>(`/api/billing/invoices?${query}`);
}
