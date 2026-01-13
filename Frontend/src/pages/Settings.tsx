import { useEffect, useMemo, useState } from "react";
import {
  fetchRestaurantDetails,
  fetchOnboardingDetails,
  fetchRestaurantRoutingSummary,
  onboardRestaurant,
  fetchBillingConfig,
  updateBillingConfig,
  type OnboardingDetails,
  type OnboardRestaurantPayload,
  type RestaurantDetail,
  type RestaurantRoutingSummary,
  type BillingConfig,
} from "../api/superadmin";

export default function Settings() {
  const userId = Number(localStorage.getItem("userId") || "");
  const [restaurantOptions, setRestaurantOptions] = useState<RestaurantDetail[]>([]);
  const [restaurants, setRestaurants] = useState<RestaurantRoutingSummary[]>([]);
  const [selectedRestaurantGuid, setSelectedRestaurantGuid] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isOnboardOpen, setIsOnboardOpen] = useState(false);
  const [onboardError, setOnboardError] = useState<string | null>(null);
  const [onboardSuccess, setOnboardSuccess] = useState<string | null>(null);
  const [isOnboardSaving, setIsOnboardSaving] = useState(false);
  const [onboardForm, setOnboardForm] = useState<OnboardRestaurantPayload>({
    userId,
    restaurantGuid: "",
    payoutFeePayer: "",
    payoutFee: "",
    activationDate: "",
    freePeriod: "",
    billingDate: "",
    billingAmount: "",
    adminName: "",
    adminPhone: "",
    adminEmail: "",
  });
  const [onboardingDetails, setOnboardingDetails] = useState<OnboardingDetails | null>(null);
  const [billingConfig, setBillingConfig] = useState<BillingConfig | null>(null);
  const [billingConfigStatus, setBillingConfigStatus] = useState<string | null>(null);
  const [billingConfigError, setBillingConfigError] = useState<string | null>(null);
  const [isSavingBillingConfig, setIsSavingBillingConfig] = useState(false);

  const loadRestaurants = () => {
    return fetchRestaurantRoutingSummary(userId).then((data) => {
      setRestaurants(data);
      return data;
    });
  };

  const loadRestaurantOptions = () => {
    return fetchRestaurantDetails(userId).then((data) => {
      setRestaurantOptions(data);
      const defaultGuid = data[0]?.restaurantGuid ?? "";
      setSelectedRestaurantGuid((current) => current || defaultGuid);
      return data;
    });
  };

  useEffect(() => {
    if (!userId) {
      setErrorMessage("Missing user context.");
      return;
    }
    loadRestaurantOptions().catch((error) => {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load restaurants.");
    });
    loadRestaurants().catch((error) => {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load restaurants.");
    });
    fetchBillingConfig(userId)
      .then((data) => {
        setBillingConfig(data);
      })
      .catch((error) => {
        setBillingConfigError(
          error instanceof Error ? error.message : "Failed to load billing config.",
        );
      });
  }, [userId]);

  const selectedRestaurantOption = useMemo(() => {
    if (!selectedRestaurantGuid) {
      return null;
    }
    return restaurantOptions.find((row) => row.restaurantGuid === selectedRestaurantGuid) ?? null;
  }, [restaurantOptions, selectedRestaurantGuid]);

  const selectedRestaurantSummary = useMemo(() => {
    if (!selectedRestaurantGuid) {
      return null;
    }
    return restaurants.find((row) => row.restaurantGuid === selectedRestaurantGuid) ?? null;
  }, [restaurants, selectedRestaurantGuid]);


  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10">
      <div className="space-y-6">
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
              <p className="mt-2 text-sm text-gray-600">
                Select a restaurant to review admin ownership.
              </p>
            </div>
            <button
              type="button"
              onClick={async () => {
                const restaurantGuid = selectedRestaurantOption?.restaurantGuid ?? "";
                setOnboardError(null);
                setOnboardSuccess(null);
                setOnboardForm((prev) => ({
                  ...prev,
                  userId,
                  restaurantGuid,
                }));
                setIsOnboardOpen(true);
                if (!restaurantGuid) {
                  return;
                }
                try {
                  const details = await fetchOnboardingDetails(userId, restaurantGuid);
                  setOnboardingDetails(details);
                  if (details) {
                    setOnboardForm((prev) => ({
                      ...prev,
                      payoutFeePayer: details.payoutFeePayer ?? "",
                      payoutFee: details.payoutFee ?? "",
                      activationDate: details.activationDate ?? "",
                      freePeriod: details.freePeriod ?? "",
                      billingDate: details.billingDate ?? "",
                      billingAmount: details.billingAmount ?? "",
                      adminName: details.adminName ?? "",
                      adminPhone: details.adminPhone ?? "",
                      adminEmail: details.adminEmail ?? "",
                    }));
                  } else {
                    setOnboardForm((prev) => ({
                      ...prev,
                      payoutFeePayer: "",
                      payoutFee: "",
                      activationDate: "",
                      freePeriod: "",
                      billingDate: "",
                      billingAmount: "",
                      adminName: "",
                      adminPhone: "",
                      adminEmail: "",
                    }));
                  }
                } catch (error) {
                  setOnboardError(
                    error instanceof Error ? error.message : "Failed to load settings.",
                  );
                }
              }}
              disabled={!selectedRestaurantOption?.restaurantGuid}
              className="inline-flex items-center justify-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Update Restaurant Settings
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
                value={selectedRestaurantGuid}
                onChange={(event) => setSelectedRestaurantGuid(event.target.value)}
                className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-900 focus:border-gray-400 focus:outline-none"
              >
                {restaurantOptions.map((restaurant) => (
                  <option
                    key={restaurant.restaurantGuid ?? restaurant.restaurantId ?? "unknown"}
                    value={restaurant.restaurantGuid ?? ""}
                  >
                    {restaurant.restaurantName ?? "Unknown Restaurant"}
                    {restaurant.restaurantId ? ` (ID ${restaurant.restaurantId})` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Admin users
              </div>
              <div className="mt-2 text-sm font-semibold text-gray-900">
                {selectedRestaurantOption?.restaurantName ?? "No restaurant selected"}
              </div>
              <div className="mt-1 text-xs text-gray-600">
                {selectedRestaurantSummary?.adminUsers ?? "Not assigned"}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Global Admin</h2>
          <p className="mt-2 text-sm text-gray-600">
            Details update based on the selected restaurant.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 sm:col-span-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Admin Users
              </div>
              <div className="mt-2 text-sm text-gray-700">
                {selectedRestaurantSummary?.adminUsers ?? "Not assigned"}
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
                <h2 className="text-xl font-semibold text-gray-900">Update Restaurant Settings</h2>
                <p className="mt-1 text-sm text-gray-600">
                  Update payout fees and billing details for the selected restaurant.
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

            <div className="mt-6 space-y-4">
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Restaurant Name
                </div>
                <div className="mt-2 text-sm font-semibold text-gray-900">
                  {selectedRestaurantOption?.restaurantName ?? "Unknown Restaurant"}
                </div>
                <div className="mt-1 text-xs text-gray-600">
                  {selectedRestaurantOption?.restaurantGuid ?? "No restaurant GUID available"}
                </div>
              </div>
              {onboardingDetails ? (
                <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-2 text-xs text-blue-700">
                  Loaded saved settings. Update any fields and click save to apply changes.
                </div>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="text-sm text-gray-700 sm:col-span-2">
                  <span className="block text-sm text-gray-700">
                    Who pays payout fee per transaction
                  </span>
                  <div className="mt-2 flex flex-wrap gap-4">
                    <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="radio"
                        name="payoutFeePayer"
                        value="restaurant"
                        checked={onboardForm.payoutFeePayer === "restaurant"}
                        onChange={(event) =>
                          setOnboardForm((prev) => ({
                            ...prev,
                            payoutFeePayer: event.target.value as "restaurant",
                          }))
                        }
                        className="h-4 w-4"
                      />
                      Restaurant
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="radio"
                        name="payoutFeePayer"
                        value="employees"
                        checked={onboardForm.payoutFeePayer === "employees"}
                        onChange={(event) =>
                          setOnboardForm((prev) => ({
                            ...prev,
                            payoutFeePayer: event.target.value as "employees",
                          }))
                        }
                        className="h-4 w-4"
                      />
                      Employees
                    </label>
                  </div>
                </div>
                <label className="text-sm text-gray-700">
                  Fees
                  <input
                    value={onboardForm.payoutFee ?? ""}
                    onChange={(event) =>
                      setOnboardForm((prev) => ({ ...prev, payoutFee: event.target.value }))
                    }
                    className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-sm text-gray-700">
                  Activation Date
                  <input
                    type="date"
                    value={onboardForm.activationDate ?? ""}
                    onChange={(event) =>
                      setOnboardForm((prev) => ({
                        ...prev,
                        activationDate: event.target.value,
                      }))
                    }
                    className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-sm text-gray-700">
                  Free Period
                  <input
                    value={onboardForm.freePeriod ?? ""}
                    onChange={(event) =>
                      setOnboardForm((prev) => ({ ...prev, freePeriod: event.target.value }))
                    }
                    className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-sm text-gray-700">
                  Billing Date
                  <input
                    type="date"
                    value={onboardForm.billingDate ?? ""}
                    onChange={(event) =>
                      setOnboardForm((prev) => ({
                        ...prev,
                        billingDate: event.target.value,
                      }))
                    }
                    className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-sm text-gray-700">
                  Billing Amount
                  <input
                    value={onboardForm.billingAmount ?? ""}
                    onChange={(event) =>
                      setOnboardForm((prev) => ({ ...prev, billingAmount: event.target.value }))
                    }
                    className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-sm text-gray-700">
                  Admin Name
                  <input
                    value={onboardForm.adminName ?? ""}
                    onChange={(event) =>
                      setOnboardForm((prev) => ({ ...prev, adminName: event.target.value }))
                    }
                    className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-sm text-gray-700">
                  Admin Phone
                  <input
                    value={onboardForm.adminPhone ?? ""}
                    onChange={(event) =>
                      setOnboardForm((prev) => ({ ...prev, adminPhone: event.target.value }))
                    }
                    className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-sm text-gray-700 sm:col-span-2">
                  Admin Email
                  <input
                    type="email"
                    value={onboardForm.adminEmail ?? ""}
                    onChange={(event) =>
                      setOnboardForm((prev) => ({ ...prev, adminEmail: event.target.value }))
                    }
                    className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  />
                </label>
              </div>
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
                    setOnboardSuccess("Restaurant settings updated.");
                    setOnboardForm({
                      userId,
                      restaurantGuid: "",
                      payoutFeePayer: "",
                      payoutFee: "",
                      activationDate: "",
                      freePeriod: "",
                      billingDate: "",
                      billingAmount: "",
                      adminName: "",
                      adminPhone: "",
                      adminEmail: "",
                    });
                    setOnboardingDetails(null);
                    if (payload.restaurantGuid) {
                      const details = await fetchOnboardingDetails(
                        userId,
                        payload.restaurantGuid,
                      );
                      setOnboardingDetails(details);
                      if (details) {
                        setOnboardForm((prev) => ({
                          ...prev,
                          restaurantGuid: payload.restaurantGuid,
                          payoutFeePayer: details.payoutFeePayer ?? "",
                          payoutFee: details.payoutFee ?? "",
                          activationDate: details.activationDate ?? "",
                          freePeriod: details.freePeriod ?? "",
                          billingDate: details.billingDate ?? "",
                          billingAmount: details.billingAmount ?? "",
                          adminName: details.adminName ?? "",
                          adminPhone: details.adminPhone ?? "",
                          adminEmail: details.adminEmail ?? "",
                        }));
                      }
                    }
                    const data = await loadRestaurants();
                    const newlyCreated = data.find(
                      (row) => row.restaurantId === response.restaurantId,
                    );
                    if (newlyCreated?.restaurantGuid) {
                      setSelectedRestaurantGuid(newlyCreated.restaurantGuid);
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
                {isOnboardSaving ? "Saving..." : "Save Settings"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
