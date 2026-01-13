import React, { useEffect, useState } from "react";
import {
  fetchRestaurantPaymentMethods,
  fetchEmployeePaymentMethods,
  refreshRestaurantPaymentMethods,
  refreshEmployeePaymentMethods,
  setRestaurantPreferredPaymentMethod,
  setEmployeePreferredPaymentMethod,
  type MoovPaymentMethod,
} from "../api/moov";

interface PaymentMethodsProps {
  ownerId: number;
  ownerType: "restaurant" | "employee";
  ownerName?: string;
}

export default function PaymentMethods({
  ownerId,
  ownerType,
  ownerName = "Account",
}: PaymentMethodsProps) {
  const [methods, setMethods] = useState<MoovPaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [settingPreferred, setSettingPreferred] = useState<string | null>(null);

  const isRestaurant = ownerType === "restaurant";

  // Load payment methods
  useEffect(() => {
    const loadMethods = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = isRestaurant
          ? await fetchRestaurantPaymentMethods(ownerId)
          : await fetchEmployeePaymentMethods(ownerId);
        setMethods(result || []);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load payment methods"
        );
      } finally {
        setLoading(false);
      }
    };

    loadMethods();
  }, [ownerId, isRestaurant]);

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      setError(null);
      await (isRestaurant
        ? refreshRestaurantPaymentMethods(ownerId)
        : refreshEmployeePaymentMethods(ownerId));

      // Reload methods
      const result = isRestaurant
        ? await fetchRestaurantPaymentMethods(ownerId)
        : await fetchEmployeePaymentMethods(ownerId);
      setMethods(result || []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to refresh payment methods"
      );
    } finally {
      setRefreshing(false);
    }
  };

  const handleSetPreferred = async (methodId: string) => {
    try {
      setSettingPreferred(methodId);
      setError(null);
      await (isRestaurant
        ? setRestaurantPreferredPaymentMethod(ownerId, methodId)
        : setEmployeePreferredPaymentMethod(ownerId, methodId));

      // Update local state
      setMethods(
        methods.map((m) => ({
          ...m,
          is_preferred: m.moov_payment_method_id === methodId,
        }))
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to set preferred method"
      );
    } finally {
      setSettingPreferred(null);
    }
  };

  const formatMethodLabel = (method: MoovPaymentMethod): string => {
    const last4 = method.last4 ? `•••• ${method.last4}` : "••••";
    const brand = method.brand || method.method_type || "Payment Method";
    return `${brand} ${last4}`;
  };

  const getMethodIcon = (method: MoovPaymentMethod): string => {
    const type = method.method_type?.toLowerCase() || "";
    if (type.includes("bank") || type.includes("ach"))
      return "🏦";
    if (type.includes("card") || type.includes("debit"))
      return "💳";
    if (type.includes("rtp")) return "⚡";
    return "💰";
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-700">
            <strong>Error:</strong> {error}
          </p>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">Payment Methods</h3>
        <button
          onClick={handleRefresh}
          disabled={refreshing || loading}
          className="rounded px-3 py-1 text-sm font-medium text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {refreshing ? "Syncing..." : "Sync from Moov"}
        </button>
      </div>

      {loading ? (
        <div className="py-8 text-center">
          <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-gray-900"></div>
          <p className="mt-3 text-sm text-gray-500">Loading payment methods...</p>
        </div>
      ) : methods.length === 0 ? (
        <div className="rounded-lg bg-gray-50 p-4 text-center">
          <p className="text-sm text-gray-600">
            No payment methods linked yet.{" "}
            <a
              href={`${isRestaurant ? "/moov/restaurant" : "/moov/employee"}/onboarding`}
              className="font-semibold text-blue-600 hover:underline"
            >
              Start onboarding
            </a>{" "}
            to add one.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {methods.map((method) => (
            <div
              key={method.moov_payment_method_id}
              className={`flex items-center gap-4 rounded-lg border p-4 transition ${
                method.is_preferred
                  ? "border-blue-200 bg-blue-50"
                  : "border-gray-200 hover:bg-gray-50"
              }`}
            >
              <span className="text-2xl">{getMethodIcon(method)}</span>

              <div className="flex-1">
                <p className="font-medium text-gray-900">
                  {formatMethodLabel(method)}
                </p>
                <div className="mt-1 flex gap-4 text-xs text-gray-500">
                  <span>ID: {method.moov_payment_method_id.slice(0, 12)}...</span>
                  {method.is_verified && (
                    <span className="flex items-center gap-1 text-emerald-600">
                      ✓ Verified
                    </span>
                  )}
                </div>
              </div>

              {!method.is_preferred && (
                <button
                  onClick={() =>
                    handleSetPreferred(method.moov_payment_method_id)
                  }
                  disabled={settingPreferred === method.moov_payment_method_id}
                  className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-900 transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {settingPreferred === method.moov_payment_method_id
                    ? "Setting..."
                    : "Set Preferred"}
                </button>
              )}

              {method.is_preferred && (
                <div className="rounded-lg bg-blue-100 px-4 py-2">
                  <p className="text-sm font-medium text-blue-900">Preferred</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
