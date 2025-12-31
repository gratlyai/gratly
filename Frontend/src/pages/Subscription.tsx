import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type StripeElementsOptions } from "@stripe/stripe-js";
import {
  createRestaurantSetupIntent,
  fetchRestaurantPaymentMethod,
  saveRestaurantPaymentMethod,
  type StripeBusinessProfile,
  type StripeCardSummary,
} from "../api/stripe";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? "");

type Status = "idle" | "loading" | "ready" | "saving" | "success" | "error";

function SetupIntentForm({
  restaurantId,
  onSaved,
}: {
  restaurantId: number;
  onSaved: (paymentMethodId: string) => Promise<void>;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string>("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!stripe || !elements) {
      return;
    }
    setStatus("saving");
    setError("");
    const result = await stripe.confirmSetup({
      elements,
      confirmParams: {
        return_url: window.location.href,
      },
      redirect: "if_required",
    });

    if (result.error) {
      setError(result.error.message ?? "Unable to confirm bank account.");
      setStatus("error");
      return;
    }

    const setupIntent = result.setupIntent;
    const paymentMethodId = setupIntent?.payment_method as string | undefined;
    if (!paymentMethodId) {
      setError("Payment method not returned by Stripe.");
      setStatus("error");
      return;
    }

    try {
      await saveRestaurantPaymentMethod(restaurantId, paymentMethodId);
      await onSaved(paymentMethodId);
      setStatus("success");
    } catch (saveError) {
      console.warn("Failed to save payment method:", saveError);
      setError("Unable to save payment method.");
      setStatus("error");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      {error ? <p className="text-sm font-semibold text-red-600">{error}</p> : null}
      <button
        type="submit"
        disabled={!stripe || status === "saving"}
        className="inline-flex items-center justify-center rounded-lg bg-[#cab99a] px-4 py-2 text-sm font-semibold text-black hover:bg-[#bfa986] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === "saving" ? "Connecting..." : "Connect bank account"}
      </button>
    </form>
  );
}

export default function Subscription() {
  const { restaurantKey } = useParams();
  const restaurantId = Number(restaurantKey);
  const [status, setStatus] = useState<Status>("loading");
  const [clientSecret, setClientSecret] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [isConfigured, setIsConfigured] = useState(false);
  const [paymentMethodId, setPaymentMethodId] = useState<string | null>(null);
  const [bankLast4, setBankLast4] = useState<string | null>(null);
  const [bankName, setBankName] = useState<string | null>(null);
  const [cardSummary, setCardSummary] = useState<StripeCardSummary | null>(null);
  const [businessProfile, setBusinessProfile] = useState<StripeBusinessProfile | null>(null);
  const [capabilities, setCapabilities] = useState<Record<string, string> | null>(null);
  const [defaultCurrency, setDefaultCurrency] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(restaurantId)) {
      setStatus("error");
      setError("Missing restaurant identifier.");
      return;
    }

    let isMounted = true;
    const load = async () => {
      try {
        const existing = await fetchRestaurantPaymentMethod(restaurantId);
        if (!isMounted) {
          return;
        }
        if (existing.configured) {
          setIsConfigured(true);
          setPaymentMethodId(existing.paymentMethodId ?? null);
          setBankLast4(existing.bankLast4 ?? null);
          setBankName(existing.bankName ?? null);
          setCardSummary(existing.card ?? null);
          setBusinessProfile(existing.businessProfile ?? null);
          setCapabilities(existing.capabilities ?? null);
          setDefaultCurrency(existing.defaultCurrency ?? null);
          setStatus("ready");
          return;
        }
        const setupIntent = await createRestaurantSetupIntent(restaurantId);
        if (!isMounted) {
          return;
        }
        setClientSecret(setupIntent.clientSecret);
        setStatus("ready");
      } catch (loadError) {
        console.warn("Failed to load Stripe setup intent:", loadError);
        if (isMounted) {
          setError("Unable to load Stripe setup.");
          setStatus("error");
        }
      }
    };
    load();

    return () => {
      isMounted = false;
    };
  }, [restaurantId]);

  const elementsOptions = useMemo<StripeElementsOptions>(
    () => ({
      clientSecret,
    }),
    [clientSecret],
  );

  const handleSaved = async (pmId: string) => {
    setIsConfigured(true);
    setPaymentMethodId(pmId);
    if (!Number.isFinite(restaurantId)) {
      return;
    }
    try {
      const refreshed = await fetchRestaurantPaymentMethod(restaurantId);
      if (refreshed.configured) {
        setBankLast4(refreshed.bankLast4 ?? null);
        setBankName(refreshed.bankName ?? null);
        setCardSummary(refreshed.card ?? null);
        setBusinessProfile(refreshed.businessProfile ?? null);
        setCapabilities(refreshed.capabilities ?? null);
        setDefaultCurrency(refreshed.defaultCurrency ?? null);
      }
    } catch (error) {
      console.warn("Failed to refresh Stripe payment method:", error);
    }
  };
  const formatCardDetails = (card: StripeCardSummary | null) => {
    if (!card) {
      return "N/A";
    }
    const brand = card.brand ?? "Card";
    const last4 = card.last4 ? `**** ${card.last4}` : "****";
    const expMonth = card.expMonth ? String(card.expMonth).padStart(2, "0") : "--";
    const expYear = card.expYear ? String(card.expYear) : "--";
    const funding = card.funding ? `, ${card.funding}` : "";
    const country = card.country ? `, ${card.country}` : "";
    return `${brand} ${last4} exp ${expMonth}/${expYear}${funding}${country}`;
  };
  const formatBusinessProfile = (profile: StripeBusinessProfile | null) => {
    if (!profile) {
      return "N/A";
    }
    const parts = [profile.name, profile.email, profile.phone].filter(Boolean);
    return parts.length > 0 ? parts.join(" | ") : "N/A";
  };
  const formatAddress = (address: Record<string, string | null> | null | undefined) => {
    if (!address) {
      return "N/A";
    }
    const parts = [
      address.line1,
      address.line2,
      address.city,
      address.state,
      address.postal_code,
      address.country,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : "N/A";
  };
  const formatCapabilities = (values: Record<string, string> | null) => {
    if (!values) {
      return "N/A";
    }
    const entries = Object.entries(values)
      .map(([key, value]) => `${key}: ${value}`)
      .join(", ");
    return entries.length > 0 ? entries : "N/A";
  };

  return (
    <main className="px-6 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Subscription</h1>
        <p className="text-sm text-gray-500">
          Connect a bank account to fund daily tip settlements.
        </p>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-md">
        <h2 className="mb-4 text-lg font-bold text-gray-900">Restaurant bank account</h2>
        {status === "loading" ? (
          <p className="text-sm text-gray-500">Loading Stripe setup…</p>
        ) : null}
        {status === "error" ? (
          <p className="text-sm font-semibold text-red-600">{error}</p>
        ) : null}
        {status === "ready" && isConfigured ? (
          <div className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700">
            <p className="font-semibold text-gray-900">Connected</p>
            {bankName || bankLast4 ? (
              <p className="mt-1 text-xs text-gray-500">
                {bankName ?? "Bank"} {bankLast4 ? `•••• ${bankLast4}` : ""}
              </p>
            ) : null}
            <p className="mt-1 text-xs text-gray-500">Card: {formatCardDetails(cardSummary)}</p>
            <p className="mt-1 text-xs text-gray-500">
              Business profile: {formatBusinessProfile(businessProfile)}
            </p>
            {businessProfile?.address ? (
              <p className="mt-1 text-xs text-gray-500">
                Business address: {formatAddress(businessProfile.address)}
              </p>
            ) : null}
            <p className="mt-1 text-xs text-gray-500">
              Capabilities: {formatCapabilities(capabilities)}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Default currency: {defaultCurrency ?? "N/A"}
            </p>
            {paymentMethodId ? (
              <p className="mt-1 break-all text-xs text-gray-500">{paymentMethodId}</p>
            ) : null}
          </div>
        ) : null}
        {status === "ready" && !isConfigured && clientSecret ? (
          <Elements stripe={stripePromise} options={elementsOptions}>
            <SetupIntentForm
              restaurantId={restaurantId}
              onSaved={handleSaved}
            />
          </Elements>
        ) : null}
      </section>
    </main>
  );
}
