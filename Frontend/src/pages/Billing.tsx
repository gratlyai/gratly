import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  createBillingPortal,
  createCheckoutSession,
  fetchBillingSummary,
  fetchInvoices,
  type BillingSummary,
  type InvoiceRecord,
} from "../api/billing";

const planCard = {
  name: "Gratly Monthly",
  highlight: "Fixed monthly billing",
  description: "A single monthly subscription billed directly by Gratly.",
  features: [
    "Monthly subscription",
    "Invoice history",
    "Billing portal access",
    "Email receipts",
  ],
};

const formatDate = (value?: string | null) => {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString();
};

const formatCurrency = (amount: number, currency: string) => {
  const normalized = currency ? currency.toUpperCase() : "USD";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalized,
    }).format(amount / 100);
  } catch {
    return `${amount / 100} ${normalized}`;
  }
};

export default function Billing() {
  const location = useLocation();
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [isLoadingSummary, setIsLoadingSummary] = useState(true);
  const [isLoadingInvoices, setIsLoadingInvoices] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isActionLoading, setIsActionLoading] = useState(false);

  const checkoutState = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("checkout");
  }, [location.search]);

  useEffect(() => {
    setIsLoadingSummary(true);
    fetchBillingSummary()
      .then((data) => {
        setSummary(data);
      })
      .catch((error) => {
        setErrorMessage(error instanceof Error ? error.message : "Failed to load billing summary.");
      })
      .finally(() => setIsLoadingSummary(false));
  }, []);

  useEffect(() => {
    setIsLoadingInvoices(true);
    fetchInvoices(10)
      .then((data) => setInvoices(data.invoices))
      .catch((error) => {
        setErrorMessage(error instanceof Error ? error.message : "Failed to load invoices.");
      })
      .finally(() => setIsLoadingInvoices(false));
  }, []);

  const subscription = summary?.subscription ?? null;
  const paymentMethod = summary?.paymentMethod ?? null;
  const currentPlanKey = subscription?.planKey ?? null;

  const handleCheckout = async () => {
    setIsActionLoading(true);
    setActionError(null);
    try {
      const { url } = await createCheckoutSession();
      window.location.href = url;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to start checkout.");
    } finally {
      setIsActionLoading(false);
    }
  };

  const handlePortal = async () => {
    setIsActionLoading(true);
    setActionError(null);
    try {
      const { url } = await createBillingPortal();
      window.location.href = url;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to open billing portal.");
    } finally {
      setIsActionLoading(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="mb-8 flex flex-col gap-3">
        <h1 className="text-2xl font-semibold text-gray-900">Billing</h1>
        <p className="text-sm text-gray-600">
          Manage your Gratly subscription, payment methods, and invoice history.
        </p>
      </div>

      {checkoutState === "success" ? (
        <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          Checkout completed. We will update your subscription shortly.
        </div>
      ) : null}
      {checkoutState === "cancel" ? (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Checkout was canceled. You can restart the subscription at any time.
        </div>
      ) : null}
      {errorMessage ? (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </div>
      ) : null}
      {actionError ? (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionError}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Subscription</h2>
                <p className="text-sm text-gray-600">Your current plan and renewal status.</p>
              </div>
              {subscription ? (
                <button
                  type="button"
                  onClick={handlePortal}
                  disabled={isActionLoading}
                  className="inline-flex items-center justify-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Manage billing
                </button>
              ) : null}
            </div>

            {isLoadingSummary ? (
              <div className="mt-6 text-sm text-gray-500">Loading subscription details...</div>
            ) : subscription ? (
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Plan
                  </div>
                  <div className="mt-2 text-lg font-semibold text-gray-900">
                    {currentPlanKey ? currentPlanKey.toUpperCase() : "GRATLY MONTHLY"}
                  </div>
                  <div className="mt-1 text-xs text-gray-600">Status: {subscription.status}</div>
                </div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Renewal
                  </div>
                  <div className="mt-2 text-lg font-semibold text-gray-900">
                    {formatDate(subscription.currentPeriodEnd)}
                  </div>
                  <div className="mt-1 text-xs text-gray-600">
                    {subscription.cancelAtPeriodEnd ? "Cancels at period end" : "Auto-renewing"}
                  </div>
                </div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Trial Ends
                  </div>
                  <div className="mt-2 text-lg font-semibold text-gray-900">
                    {formatDate(subscription.trialEnd)}
                  </div>
                </div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Payment Method
                  </div>
                  <div className="mt-2 text-lg font-semibold text-gray-900">
                    {paymentMethod?.brand
                      ? paymentMethod.last4
                        ? `${paymentMethod.brand.toUpperCase()} •••• ${paymentMethod.last4}`
                        : paymentMethod.brand.toUpperCase()
                      : "No payment method on file"}
                  </div>
                  <button
                    type="button"
                    onClick={handlePortal}
                    disabled={isActionLoading}
                    className="mt-2 text-xs font-semibold text-gray-700 hover:text-gray-900"
                  >
                    Update payment method
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-6">
                <p className="text-sm text-gray-600">
                  No active subscription found. Choose a plan to get started.
                </p>
                <div className="mt-6">
                  <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {planCard.highlight}
                    </div>
                    <div className="mt-2 text-xl font-semibold text-gray-900">{planCard.name}</div>
                    <p className="mt-2 text-sm text-gray-600">{planCard.description}</p>
                    <ul className="mt-4 space-y-2 text-sm text-gray-700">
                      {planCard.features.map((feature) => (
                        <li key={feature} className="flex items-start gap-2">
                          <span className="mt-1 h-1.5 w-1.5 rounded-full bg-gray-500" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      onClick={handleCheckout}
                      disabled={isActionLoading}
                      className="mt-5 inline-flex w-full items-center justify-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Start subscription
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Invoice History</h2>
                <p className="text-sm text-gray-600">Recent invoices and payment records.</p>
              </div>
              <button
                type="button"
                onClick={handlePortal}
                disabled={isActionLoading}
                className="text-xs font-semibold text-gray-700 hover:text-gray-900"
              >
                Open portal
              </button>
            </div>
            {isLoadingInvoices ? (
              <div className="mt-6 text-sm text-gray-500">Loading invoices...</div>
            ) : invoices.length === 0 ? (
              <div className="mt-6 text-sm text-gray-600">No invoices yet.</div>
            ) : (
              <div className="mt-6 overflow-hidden rounded-xl border border-gray-200">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-4 py-3">Invoice</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Amount</th>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Links</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {invoices.map((invoice) => (
                      <tr key={invoice.id}>
                        <td className="px-4 py-3 font-semibold text-gray-900">
                          {invoice.number ?? invoice.id}
                        </td>
                        <td className="px-4 py-3 text-gray-700">{invoice.status}</td>
                        <td className="px-4 py-3 text-gray-700">
                          {formatCurrency(invoice.amountDue, invoice.currency)}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {formatDate(invoice.created)}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <div className="flex gap-3">
                            {invoice.hostedInvoiceUrl ? (
                              <a
                                href={invoice.hostedInvoiceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="font-semibold text-gray-700 hover:text-gray-900"
                              >
                                View
                              </a>
                            ) : null}
                            {invoice.invoicePdf ? (
                              <a
                                href={invoice.invoicePdf}
                                target="_blank"
                                rel="noreferrer"
                                className="font-semibold text-gray-700 hover:text-gray-900"
                              >
                                PDF
                              </a>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">Payment Method</h2>
            <p className="mt-2 text-sm text-gray-600">
              We never store full card details. Update anytime in the portal.
            </p>
            <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
              {paymentMethod?.brand ? (
                <div className="font-semibold text-gray-900">
                  {paymentMethod.last4
                    ? `${paymentMethod.brand.toUpperCase()} •••• ${paymentMethod.last4}`
                    : paymentMethod.brand.toUpperCase()}
                </div>
              ) : (
                <div className="text-gray-600">No payment method on file yet.</div>
              )}
            </div>
            <button
              type="button"
              onClick={handlePortal}
              disabled={isActionLoading}
              className="mt-4 inline-flex w-full items-center justify-center rounded-lg border border-gray-900 px-4 py-2 text-sm font-semibold text-gray-900 transition hover:bg-gray-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              Manage payment methods
            </button>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">Billing Support</h2>
            <p className="mt-2 text-sm text-gray-600">
              Need to cancel, upgrade, or update tax info? The billing portal is the fastest
              path.
            </p>
            <button
              type="button"
              onClick={handlePortal}
              disabled={isActionLoading}
              className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Open billing portal
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
