import { useState, useEffect } from "react";
import {
  fetchBillingSummary,
  fetchInvoices,
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
  const [isLoadingSummary, setIsLoadingSummary] = useState(true);
  const [isLoadingInvoices, setIsLoadingInvoices] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setIsLoadingSummary(true);
    fetchBillingSummary(0)
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
      .then((data) => {
        if (Array.isArray(data)) {
          setInvoices(data);
        } else if (data && typeof data === 'object' && 'invoices' in data) {
          setInvoices(Array.isArray(data.invoices) ? data.invoices : []);
        } else {
          setInvoices([]);
        }
      })
      .catch((error) => {
        setErrorMessage(error instanceof Error ? error.message : "Failed to load invoices.");
      })
      .finally(() => setIsLoadingInvoices(false));
  }, []);

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
                        {invoice.number ?? invoice.id}
                      </td>
                      <td className="px-4 py-3 text-gray-700">{invoice.status}</td>
                      <td className="px-4 py-3 text-gray-700">
                        {formatCurrency(invoice.amountDue, invoice.currency)}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {formatDate(invoice.created)}
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
