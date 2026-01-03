import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  fetchPaymentRouting,
  savePaymentRouting,
  type PaymentRoutingStatus,
} from "../api/paymentRouting";

type ProviderOption = "stripe" | "astra";

type PaymentRoutingProps = {
  restaurantId?: number | null;
  embedded?: boolean;
};

const providerLabels: Record<ProviderOption, string> = {
  stripe: "Stripe",
  astra: "Astra (Astrafi)",
};

export default function PaymentRouting({
  restaurantId: overrideRestaurantId,
  embedded = false,
}: PaymentRoutingProps) {
  const { restaurantKey } = useParams();
  const restaurantId =
    overrideRestaurantId ?? (restaurantKey ? Number(restaurantKey) : Number.NaN);
  const userId = Number(localStorage.getItem("userId") || "");
  const isValidContext = Number.isFinite(restaurantId) && restaurantId > 0 && userId > 0;

  const [status, setStatus] = useState<PaymentRoutingStatus | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<ProviderOption>("stripe");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const isLocked = status?.locked ?? false;
  const currentProvider = useMemo(() => {
    if (status?.provider) {
      return status.provider;
    }
    return "stripe";
  }, [status]);

  useEffect(() => {
    if (!isValidContext) {
      setErrorMessage("Missing restaurant or user context.");
      return;
    }
    setIsLoading(true);
    fetchPaymentRouting(restaurantId, userId)
      .then((data) => {
        setStatus(data);
        setSelectedProvider(data.provider ?? "stripe");
        setErrorMessage(null);
      })
      .catch((error) => {
        setErrorMessage(error instanceof Error ? error.message : "Failed to load routing.");
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [restaurantId, userId, isValidContext]);

  const handleSave = async () => {
    if (!isValidContext) {
      setErrorMessage("Missing restaurant or user context.");
      return;
    }
    setIsLoading(true);
    setSuccessMessage(null);
    setErrorMessage(null);
    try {
      const updated = await savePaymentRouting({
        userId,
        restaurantId,
        provider: selectedProvider,
      });
      setStatus(updated);
      setSuccessMessage("Payment routing saved.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to save routing.");
    } finally {
      setIsLoading(false);
    }
  };

  const containerClass = embedded
    ? "w-full"
    : "mx-auto w-full max-w-4xl px-4 py-10";

  return (
    <div className={containerClass}>
      <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-gray-900">Payment Routing</h1>
        <p className="mt-2 text-sm text-gray-600">
          Choose which provider to use when a payout is approved. This is a one-time choice per
          restaurant and cannot be changed once saved.
        </p>

        {!isValidContext && (
          <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Unable to load restaurant context. Please refresh and try again.
          </div>
        )}

        {errorMessage && (
          <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMessage}
          </div>
        )}

        {successMessage && (
          <div className="mt-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
            {successMessage}
          </div>
        )}

        <div className="mt-8 space-y-4">
          {(Object.keys(providerLabels) as ProviderOption[]).map((provider) => (
            <label
              key={provider}
              className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${
                selectedProvider === provider ? "border-gray-900" : "border-gray-200"
              } ${isLocked ? "opacity-70" : "cursor-pointer"}`}
            >
              <input
                type="radio"
                name="payment-provider"
                value={provider}
                checked={selectedProvider === provider}
                disabled={isLocked || isLoading}
                onChange={() => setSelectedProvider(provider)}
                className="h-4 w-4"
              />
              <span className="text-sm font-medium text-gray-900">{providerLabels[provider]}</span>
            </label>
          ))}
        </div>

        {isLocked && (
          <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
            Provider locked to <strong>{providerLabels[currentProvider as ProviderOption]}</strong>
            {status?.updatedAt ? ` on ${status.updatedAt}.` : "."}
          </div>
        )}

        <div className="mt-8 flex items-center gap-4">
          <button
            type="button"
            onClick={handleSave}
            disabled={isLocked || isLoading}
            className="rounded-lg bg-gray-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? "Saving..." : "Save Provider"}
          </button>
          <span className="text-xs text-gray-500">
            Current provider: {providerLabels[currentProvider as ProviderOption]}
          </span>
        </div>
      </div>
    </div>
  );
}
