import { useState, useEffect } from "react";
import {
  fetchBillingSummary,
  fetchInvoices,
  startPaymentMethodOnboarding,
  fetchPaymentMethods,
  refreshPaymentMethods,
  setPreferredPaymentMethod,
} from "../api/billing";

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
  const [summary, setSummary] = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  const [isLoadingSummary, setIsLoadingSummary] = useState(true);
  const [isLoadingInvoices, setIsLoadingInvoices] = useState(true);
  const [isLoadingMethods, setIsLoadingMethods] = useState(false);
  const [isStartingOnboarding, setIsStartingOnboarding] = useState(false);
  const [isRefreshingMethods, setIsRefreshingMethods] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Get restaurant ID from localStorage
  const restaurantId = Number(localStorage.getItem("restaurantKey") || "0");

  useEffect(() => {
    if (!restaurantId) {
      setErrorMessage("Restaurant ID not found. Please log in again.");
      setIsLoadingSummary(false);
      setIsLoadingInvoices(false);
      return;
    }

    setIsLoadingSummary(true);
    fetchBillingSummary(restaurantId)
      .then((data) => {
        setSummary(data);
      })
      .catch((error) => {
        setErrorMessage(error instanceof Error ? error.message : "Failed to load billing summary.");
      })
      .finally(() => setIsLoadingSummary(false));
  }, [restaurantId]);

  useEffect(() => {
    if (!restaurantId) {
      return;
    }

    setIsLoadingInvoices(true);
    fetchInvoices(restaurantId, 50) // Fetch 50 invoices per page
      .then((data: any) => {
        setInvoices(Array.isArray(data) ? data : []);
      })
      .catch((error) => {
        setErrorMessage(error instanceof Error ? error.message : "Failed to load invoices.");
      })
      .finally(() => setIsLoadingInvoices(false));
  }, [restaurantId]);

  useEffect(() => {
    if (!restaurantId || !summary?.config) {
      return;
    }

    setIsLoadingMethods(true);
    fetchPaymentMethods(restaurantId)
      .then((data) => {
        setPaymentMethods(Array.isArray(data) ? data : []);
      })
      .catch((error) => {
        console.error("Failed to load payment methods:", error);
      })
      .finally(() => setIsLoadingMethods(false));
  }, [restaurantId, summary]);

  const handleStartOnboarding = async () => {
    if (!restaurantId) return;

    try {
      setIsStartingOnboarding(true);
      setErrorMessage(null);
      const returnUrl = `${window.location.origin}/billing`;
      const refreshUrl = returnUrl;
      const result = await startPaymentMethodOnboarding(restaurantId, returnUrl, refreshUrl);
      if (result.redirectUrl) {
        window.location.href = result.redirectUrl;
      } else {
        setErrorMessage("Failed to start onboarding");
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to start onboarding");
    } finally {
      setIsStartingOnboarding(false);
    }
  };

  const handleRefreshMethods = async () => {
    if (!restaurantId) return;

    try {
      setIsRefreshingMethods(true);
      setErrorMessage(null);
      const data = await refreshPaymentMethods(restaurantId);
      setPaymentMethods(Array.isArray(data) ? data : []);
      setSuccessMessage("Payment methods synced successfully");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to refresh payment methods");
    } finally {
      setIsRefreshingMethods(false);
    }
  };

  const handleSetPreferredMethod = async (methodId: string) => {
    if (!restaurantId) return;

    try {
      setErrorMessage(null);
      await setPreferredPaymentMethod(restaurantId, methodId);
      setPaymentMethods(
        paymentMethods.map((m) => ({
          ...m,
          isPreferred: m.moovPaymentMethodId === methodId,
        }))
      );
      setSuccessMessage("Preferred payment method updated");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to set preferred method");
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

      {errorMessage ? (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </div>
      ) : null}

      {successMessage ? (
        <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {successMessage}
        </div>
      ) : null}

      <div className="space-y-6">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Billing Summary</h2>

          {isLoadingSummary ? (
            <div className="text-sm text-gray-500">Loading billing summary...</div>
          ) : summary ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-gray-200 p-4">
                <p className="text-sm text-gray-600">Monthly Charge</p>
                <p className="mt-1 text-2xl font-semibold text-gray-900">
                  {summary?.monthlyCharge ? formatCurrency(summary.monthlyCharge, "USD") : "—"}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 p-4">
                <p className="text-sm text-gray-600">Status</p>
                <p className="mt-1 text-lg font-semibold text-gray-900">Active</p>
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-600">No billing information available.</div>
          )}
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Moov Account</h2>

          {isLoadingSummary ? (
            <div className="text-sm text-gray-500">Loading account status...</div>
          ) : summary?.config ? (
            <>
              <div className="mb-4 rounded-lg border border-gray-200 p-4">
                <p className="text-sm text-gray-600">Account Status</p>
                <p className="mt-1 text-lg font-semibold text-gray-900">
                  {summary.config.moovAccountId ? "✓ Active" : "Not Created"}
                </p>
                {summary.config.moovAccountId && (
                  <p className="mt-2 text-xs text-gray-500">
                    Account ID: {summary.config.moovAccountId.slice(0, 12)}...
                  </p>
                )}
              </div>

              {!summary.config.moovAccountId && (
                <button
                  onClick={handleStartOnboarding}
                  disabled={isStartingOnboarding}
                  className="w-full rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isStartingOnboarding ? "Starting..." : "Create Moov Account"}
                </button>
              )}
            </>
          ) : null}
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Payment Methods</h2>
            <button
              onClick={handleRefreshMethods}
              disabled={isRefreshingMethods || isLoadingMethods}
              className="text-xs font-semibold text-blue-600 hover:text-blue-700 disabled:cursor-not-allowed disabled:text-gray-400"
            >
              {isRefreshingMethods ? "Syncing..." : "Sync from Moov"}
            </button>
          </div>

          {isLoadingMethods ? (
            <p className="text-sm text-gray-500">Loading payment methods...</p>
          ) : paymentMethods.length === 0 ? (
            <p className="text-sm text-gray-600">No payment methods linked yet.</p>
          ) : (
            <div className="space-y-2">
              {paymentMethods.map((method) => (
                <div
                  key={method.moovPaymentMethodId}
                  className={`flex items-center justify-between rounded-lg border p-3 transition ${
                    method.isPreferred
                      ? "border-blue-200 bg-blue-50"
                      : "border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  <div className="flex-1">
                    <p className="font-semibold text-gray-900">
                      {method.brand || method.methodType}
                      {method.last4 && ` •••• ${method.last4}`}
                    </p>
                    <p className="text-xs text-gray-500">
                      {method.isVerified ? "✓ Verified" : "Unverified"} • {method.status}
                    </p>
                  </div>
                  <div className="ml-4 flex items-center gap-2">
                    {method.isPreferred && (
                      <span className="rounded-full bg-blue-100 px-2 py-1 text-[10px] font-semibold text-blue-700">
                        Preferred
                      </span>
                    )}
                    {!method.isPreferred && (
                      <button
                        onClick={() => handleSetPreferredMethod(method.moovPaymentMethodId)}
                        className="text-[10px] font-semibold text-gray-600 hover:text-gray-900"
                      >
                        Set Preferred
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {summary?.config?.moovAccountId && paymentMethods.length === 0 && !isLoadingMethods && (
            <button
              onClick={handleStartOnboarding}
              disabled={isStartingOnboarding}
              className="mt-4 w-full rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isStartingOnboarding ? "Starting..." : "Add Payment Method"}
            </button>
          )}
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Invoice History</h2>

          {isLoadingInvoices ? (
            <div className="text-sm text-gray-500">Loading invoices...</div>
          ) : invoices.length === 0 ? (
            <div className="text-sm text-gray-600">No invoices yet.</div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-gray-200">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Invoice</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Amount</th>
                    <th className="px-4 py-3">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td className="px-4 py-3 font-semibold text-gray-900">
                        {invoice.billingPeriod ?? `Invoice ${invoice.id}`}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {invoice.paymentStatus ?? invoice.moovInvoiceStatus ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {formatCurrency(invoice.amountCents, invoice.currency)}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {formatDate(invoice.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
