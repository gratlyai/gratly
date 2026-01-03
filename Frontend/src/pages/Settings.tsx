import { useEffect, useMemo, useState } from "react";
import PaymentRouting from "./PaymentRouting";
import {
  fetchRestaurantRoutingSummary,
  onboardRestaurant,
  type OnboardRestaurantPayload,
  type RestaurantRoutingSummary,
} from "../api/superadmin";

export default function Settings() {
  const userId = Number(localStorage.getItem("userId") || "");
  const [restaurants, setRestaurants] = useState<RestaurantRoutingSummary[]>([]);
  const [selectedRestaurantId, setSelectedRestaurantId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isOnboardOpen, setIsOnboardOpen] = useState(false);
  const [onboardError, setOnboardError] = useState<string | null>(null);
  const [onboardSuccess, setOnboardSuccess] = useState<string | null>(null);
  const [isOnboardSaving, setIsOnboardSaving] = useState(false);
  const [onboardForm, setOnboardForm] = useState<OnboardRestaurantPayload>({
    userId,
    restaurantGuid: "",
    restaurantName: "",
    secretKey: "",
    clientSecret: "",
    userAccessType: "",
    adminName: "",
    adminEmail: "",
  });

  const loadRestaurants = () => {
    return fetchRestaurantRoutingSummary(userId).then((data) => {
      setRestaurants(data);
      const defaultId = data[0]?.restaurantId ?? null;
      setSelectedRestaurantId((current) => current ?? defaultId);
      return data;
    });
  };

  useEffect(() => {
    if (!userId) {
      setErrorMessage("Missing user context.");
      return;
    }
    loadRestaurants()
      .catch((error) => {
        setErrorMessage(error instanceof Error ? error.message : "Failed to load restaurants.");
      });
  }, [userId]);

  const selectedRestaurant = useMemo(() => {
    if (!selectedRestaurantId) {
      return null;
    }
    return restaurants.find((row) => row.restaurantId === selectedRestaurantId) ?? null;
  }, [restaurants, selectedRestaurantId]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10">
      <div className="space-y-6">
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
              <p className="mt-2 text-sm text-gray-600">
                Select a restaurant to manage payment routing and review admin ownership.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setOnboardForm((prev) => ({ ...prev, userId }));
                setOnboardError(null);
                setOnboardSuccess(null);
                setIsOnboardOpen(true);
              }}
              className="inline-flex items-center justify-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-800"
            >
              Onboard New Restaurant
            </button>
          </div>

          {errorMessage ? (
            <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {errorMessage}
            </div>
          ) : null}

          <div className="mt-6 grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Restaurant
              </label>
              <select
                value={selectedRestaurantId ?? ""}
                onChange={(event) => setSelectedRestaurantId(Number(event.target.value))}
                className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-900 focus:border-gray-400 focus:outline-none"
              >
                {restaurants.map((restaurant) => (
                  <option key={restaurant.restaurantId} value={restaurant.restaurantId}>
                    {restaurant.restaurantName ?? "Unknown Restaurant"} (ID {restaurant.restaurantId})
                  </option>
                ))}
              </select>
            </div>

            <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Admin users
              </div>
              <div className="mt-2 text-sm font-semibold text-gray-900">
                {selectedRestaurant?.restaurantName ?? "No restaurant selected"}
              </div>
              <div className="mt-1 text-xs text-gray-600">
                {selectedRestaurant?.adminUsers ?? "Not assigned"}
              </div>
            </div>
          </div>
        </div>

        {selectedRestaurantId ? (
          <PaymentRouting restaurantId={selectedRestaurantId} embedded />
        ) : null}

        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Global Admin</h2>
          <p className="mt-2 text-sm text-gray-600">
            Details update based on the selected restaurant.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Routing Provider
              </div>
              <div className="mt-2 text-sm font-semibold text-gray-900">
                {selectedRestaurant?.provider ?? "stripe"}
              </div>
              <div className="mt-1 text-xs text-gray-600">
                {selectedRestaurant?.locked ? "Locked" : "Not set"}
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Stripe Bank
              </div>
              <div className="mt-2 text-sm font-semibold text-gray-900">
                {selectedRestaurant?.bankName || selectedRestaurant?.bankLast4
                  ? `${selectedRestaurant?.bankName ?? "Bank"} ${
                      selectedRestaurant?.bankLast4 ? `•••• ${selectedRestaurant.bankLast4}` : ""
                    }`
                  : "Not linked"}
              </div>
              <div className="mt-1 text-xs text-gray-600">
                {selectedRestaurant?.usBankPaymentMethodId ?? "No payment method on file"}
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 sm:col-span-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Admin Users
              </div>
              <div className="mt-2 text-sm text-gray-700">
                {selectedRestaurant?.adminUsers ?? "Not assigned"}
              </div>
            </div>
          </div>
        </div>
      </div>

      {isOnboardOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-8 shadow-xl">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Onboard New Restaurant</h2>
                <p className="mt-1 text-sm text-gray-600">
                  Add restaurant credentials and invite the admin user.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsOnboardOpen(false)}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Close
              </button>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="text-sm text-gray-700">
                Restaurant GUID
                <input
                  value={onboardForm.restaurantGuid}
                  onChange={(event) =>
                    setOnboardForm((prev) => ({ ...prev, restaurantGuid: event.target.value }))
                  }
                  className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="text-sm text-gray-700">
                Restaurant Name
                <input
                  value={onboardForm.restaurantName ?? ""}
                  onChange={(event) =>
                    setOnboardForm((prev) => ({ ...prev, restaurantName: event.target.value }))
                  }
                  className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="text-sm text-gray-700">
                Secret Key
                <input
                  value={onboardForm.secretKey}
                  onChange={(event) =>
                    setOnboardForm((prev) => ({ ...prev, secretKey: event.target.value }))
                  }
                  className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="text-sm text-gray-700">
                Client Secret
                <input
                  value={onboardForm.clientSecret}
                  onChange={(event) =>
                    setOnboardForm((prev) => ({ ...prev, clientSecret: event.target.value }))
                  }
                  className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="text-sm text-gray-700">
                User Access Type
                <input
                  value={onboardForm.userAccessType}
                  onChange={(event) =>
                    setOnboardForm((prev) => ({ ...prev, userAccessType: event.target.value }))
                  }
                  className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="text-sm text-gray-700">
                Admin Name
                <input
                  value={onboardForm.adminName}
                  onChange={(event) =>
                    setOnboardForm((prev) => ({ ...prev, adminName: event.target.value }))
                  }
                  className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="text-sm text-gray-700 sm:col-span-2">
                Admin Email
                <input
                  type="email"
                  value={onboardForm.adminEmail}
                  onChange={(event) =>
                    setOnboardForm((prev) => ({ ...prev, adminEmail: event.target.value }))
                  }
                  className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                />
              </label>
            </div>

            {onboardError ? (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
                {onboardError}
              </div>
            ) : null}
            {onboardSuccess ? (
              <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
                {onboardSuccess}
              </div>
            ) : null}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsOnboardOpen(false)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isOnboardSaving}
                onClick={async () => {
                  setIsOnboardSaving(true);
                  setOnboardError(null);
                  setOnboardSuccess(null);
                  try {
                    const payload = { ...onboardForm, userId };
                    const response = await onboardRestaurant(payload);
                    setOnboardSuccess("Restaurant onboarded. Invite email sent.");
                    setOnboardForm({
                      userId,
                      restaurantGuid: "",
                      restaurantName: "",
                      secretKey: "",
                      clientSecret: "",
                      userAccessType: "",
                      adminName: "",
                      adminEmail: "",
                    });
                    const data = await loadRestaurants();
                    const newlyCreated = data.find(
                      (row) => row.restaurantId === response.restaurantId,
                    );
                    if (newlyCreated) {
                      setSelectedRestaurantId(newlyCreated.restaurantId);
                    }
                  } catch (error) {
                    setOnboardError(
                      error instanceof Error ? error.message : "Failed to onboard restaurant.",
                    );
                  } finally {
                    setIsOnboardSaving(false);
                  }
                }}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isOnboardSaving ? "Saving..." : "Save & Send Invite"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
