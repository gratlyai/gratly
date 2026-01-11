import { api } from "./client";

export type BillingSummary = {
  billingDate?: string | null;
  billingDayOfMonth?: number | null;
  billingAmountCents?: number | null;
  billingCurrency?: string | null;
  paymentMethod?: {
    methodType?: string;
    brand?: string | null;
    last4?: string | null;
    isPreferred?: boolean;
  } | null;
  latestInvoice?: {
    id: number;
    billingPeriod: string;
    amountCents: number;
    currency: string;
    status: string;
    dueDate?: string | null;
    paidAt?: string | null;
    invoiceId?: string | null;
  } | null;
};

export type InvoiceRecord = {
  id: number;
  billingPeriod: string;
  amountCents: number;
  currency: string;
  status: string;
  dueDate?: string | null;
  paidAt?: string | null;
  invoiceId?: string | null;
  createdAt?: string | null;
};

export type InvoiceListResponse = {
  invoices: InvoiceRecord[];
};

export async function fetchBillingSummary(): Promise<BillingSummary> {
  return api.get<BillingSummary>("/api/billing/summary");
}

export async function fetchInvoices(): Promise<InvoiceListResponse> {
  return api.get<InvoiceListResponse>("/api/billing/invoices");
}

export async function createBillingPaymentMethodLink(
  returnUrl: string,
  refreshUrl?: string,
): Promise<{ url: string }> {
  return api.post<{ url: string }>("/api/billing/payment-method-link", { returnUrl, refreshUrl });
}
