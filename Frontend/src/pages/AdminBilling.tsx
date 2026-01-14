import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  fetchBillingSummary,
  fetchPaymentMethods,
  startPaymentMethodOnboarding,
  refreshPaymentMethods,
  setPreferredPaymentMethod,
  type BillingSummary,
  type PaymentMethod,
  type MonthlyInvoice,
} from '../api/billing';
import {
  getStoredPermissions,
  type PermissionState,
} from '../auth/permissions';

const AdminBilling: React.FC = () => {
  const navigate = useNavigate();
  const { restaurantKey } = useParams();
  const [billingSummary, setBillingSummary] = useState<BillingSummary | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [invoices, setInvoices] = useState<MonthlyInvoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [permissions] = useState<PermissionState>(() =>
    getStoredPermissions(localStorage.getItem('userId'))
  );

  const restaurantId = restaurantKey ? Number(restaurantKey) : null;

  // Check admin access
  useEffect(() => {
    if (!permissions.adminAccess && !permissions.superadminAccess) {
      navigate('/');
    }
  }, [permissions, navigate]);

  // Load billing data
  useEffect(() => {
    if (!restaurantId) return;

    const loadData = async () => {
      try {
        setIsLoading(true);
        setError('');
        const [summary, methods] = await Promise.all([
          fetchBillingSummary(restaurantId),
          fetchPaymentMethods(restaurantId),
        ]);
        setBillingSummary(summary);
        setPaymentMethods(methods);
        if (summary.recentInvoices) {
          setInvoices(summary.recentInvoices);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load billing data');
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [restaurantId]);

  const handleStartOnboarding = async () => {
    if (!restaurantId) return;

    try {
      setIsOnboarding(true);
      setError('');
      const returnUrl = `${window.location.origin}/business/${restaurantId}/billing`;
      const refreshUrl = returnUrl;
      const result = await startPaymentMethodOnboarding(restaurantId, returnUrl, refreshUrl);
      if (result.redirectUrl) {
        window.location.href = result.redirectUrl;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start onboarding');
    } finally {
      setIsOnboarding(false);
    }
  };

  const handleRefreshMethods = async () => {
    if (!restaurantId) return;

    try {
      setIsRefreshing(true);
      setError('');
      const methods = await refreshPaymentMethods(restaurantId);
      setPaymentMethods(methods);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh payment methods');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSetPreferred = async (methodId: string) => {
    if (!restaurantId) return;

    try {
      setError('');
      await setPreferredPaymentMethod(restaurantId, methodId);
      setPaymentMethods(methods =>
        methods.map(m => ({
          ...m,
          isPreferred: m.moovPaymentMethodId === methodId,
        }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update preferred method');
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'N/A';
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  const formatAmount = (amountCents: number | null) => {
    if (!amountCents) return '$0.00';
    return `$${(amountCents / 100).toFixed(2)}`;
  };

  const getInvoiceStatusColor = (status: string | null) => {
    switch (status?.toLowerCase()) {
      case 'paid':
      case 'completed':
        return 'bg-green-50 text-green-700 border-green-200';
      case 'failed':
        return 'bg-red-50 text-red-700 border-red-200';
      case 'unpaid':
      case 'pending':
        return 'bg-yellow-50 text-yellow-700 border-yellow-200';
      default:
        return 'bg-gray-50 text-gray-700 border-gray-200';
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-xl shadow-md border border-gray-200 p-8">
            <p className="text-gray-600">Loading billing information...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto p-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Billing</h1>
          <p className="text-gray-600 mt-2">Manage your billing settings and payment methods</p>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm font-semibold text-red-700">{error}</p>
          </div>
        )}

        {/* Billing Info Card */}
        {billingSummary && (
          <div className="bg-white rounded-xl shadow-md border border-gray-200 p-6 mb-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Billing Information</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-500">Billing Date</p>
                <p className="text-lg font-semibold text-gray-900">
                  {billingSummary.config?.billingDate
                    ? `Day ${billingSummary.config.billingDate}`
                    : 'Not configured'}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Monthly Amount</p>
                <p className="text-lg font-semibold text-gray-900">
                  {formatAmount(billingSummary.config?.billingAmount)}
                </p>
              </div>
              {billingSummary.upcomingInvoice && (
                <div>
                  <p className="text-sm text-gray-500">Next Invoice Due</p>
                  <p className="text-lg font-semibold text-gray-900">
                    {formatDate(billingSummary.upcomingInvoice.dueDate)}
                  </p>
                </div>
              )}
              <div>
                <p className="text-sm text-gray-500">Status</p>
                <p className="text-lg font-semibold text-gray-900">
                  {billingSummary.config?.paidStatus === 'active' ? '✓ Active' : 'Inactive'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Payment Methods Card */}
        <div className="bg-white rounded-xl shadow-md border border-gray-200 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900">Payment Methods</h2>
            <button
              type="button"
              onClick={handleRefreshMethods}
              disabled={isRefreshing}
              className="text-xs font-semibold text-gray-900 hover:text-gray-700 disabled:text-gray-400 disabled:cursor-not-allowed"
            >
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>

          {paymentMethods.length > 0 ? (
            <div className="space-y-2">
              {paymentMethods.map((method) => (
                <div
                  key={method.moovPaymentMethodId}
                  className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3"
                >
                  <div className="flex-1">
                    <p className="font-semibold text-gray-900">
                      {method.brand || method.methodType}
                      {method.last4 && ` •••${method.last4}`}
                    </p>
                    <p className="text-xs text-gray-500">
                      {method.isVerified ? '✓ Verified' : 'Not verified'} •{' '}
                      {method.status}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {method.isPreferred && (
                      <span className="rounded-full bg-blue-100 px-2 py-1 text-[10px] font-semibold text-blue-700">
                        Preferred
                      </span>
                    )}
                    {!method.isPreferred && (
                      <button
                        type="button"
                        onClick={() => handleSetPreferred(method.moovPaymentMethodId)}
                        className="text-[10px] font-semibold text-gray-900 hover:text-gray-700"
                      >
                        Set preferred
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 mb-4">No payment methods on file</p>
          )}

          <button
            type="button"
            onClick={handleStartOnboarding}
            disabled={isOnboarding}
            className="mt-4 w-full rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-400"
          >
            {isOnboarding ? 'Opening...' : 'Add or Update Payment Method'}
          </button>
        </div>

        {/* Invoices Card */}
        <div className="bg-white rounded-xl shadow-md border border-gray-200 p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Recent Invoices</h2>

          {invoices.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-3 font-semibold text-gray-900">Period</th>
                    <th className="text-left py-2 px-3 font-semibold text-gray-900">Amount</th>
                    <th className="text-left py-2 px-3 font-semibold text-gray-900">Due Date</th>
                    <th className="text-left py-2 px-3 font-semibold text-gray-900">Status</th>
                    <th className="text-left py-2 px-3 font-semibold text-gray-900">Paid On</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => (
                    <tr key={invoice.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-3 px-3 text-gray-900">{invoice.billingPeriod}</td>
                      <td className="py-3 px-3 text-gray-900">
                        {formatAmount(invoice.amountCents)}
                      </td>
                      <td className="py-3 px-3 text-gray-600">
                        {formatDate(invoice.dueDate)}
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={`inline-block rounded-full px-2 py-1 text-[10px] font-semibold border ${getInvoiceStatusColor(
                            invoice.paymentStatus
                          )}`}
                        >
                          {invoice.paymentStatus || 'pending'}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-gray-600">
                        {formatDate(invoice.paidAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-500">No invoices yet</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminBilling;
