import { useEffect, useMemo, useState } from "react";
import { fetchRestaurantRoutingSummary, type RestaurantRoutingSummary } from "../api/superadmin";
import { savePaymentRouting } from "../api/paymentRouting";

type ProviderOption = "stripe" | "astra";

const providerLabels: Record<ProviderOption, string> = {
  stripe: "Stripe",
  astra: "Astra (Astrafi)",
};

export default function GlobalAdmin() {
  const userId = Number(localStorage.getItem("userId") || "");
  const [rows, setRows] = useState<RestaurantRoutingSummary[]>([]);
  const [search, setSearch] = useState("");
  const [pendingProviders, setPendingProviders] = useState<Record<number, ProviderOption>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) {
      setErrorMessage("Missing user context.");
      return;
    }
    setIsLoading(true);
    fetchRestaurantRoutingSummary(userId)
      .then((data) => {
        setRows(data);
        const initial: Record<number, ProviderOption> = {};
        data.forEach((row) => {
          initial[row.restaurantId] = row.provider ?? "stripe";
        });
        setPendingProviders(initial);
        setErrorMessage(null);
      })
      .catch((error) => {
        setErrorMessage(error instanceof Error ? error.message : "Failed to load restaurants.");
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [userId]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return rows;
    }
    return rows.filter((row) => {
      const name = row.restaurantName ?? "";
      return (
        name.toLowerCase().includes(term) ||
        String(row.restaurantId).includes(term) ||
        (row.restaurantGuid ?? "").toLowerCase().includes(term)
      );
    });
  }, [rows, search]);

  const handleSave = async (restaurantId: number) => {
    const provider = pendingProviders[restaurantId] ?? "stripe";
    setIsLoading(true);
    setErrorMessage(null);
    try {
      await savePaymentRouting({ userId, restaurantId, provider });
      setRows((prev) =>
        prev.map((row) =>
          row.restaurantId === restaurantId
            ? { ...row, provider, locked: true, updatedByUserId: userId }
            : row,
        ),
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to save routing.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f4f2ee] px-6 py-10">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-semibold text-gray-900">Global Admin</h1>
          <p className="mt-2 text-sm text-gray-600">
            Set the payment provider once per restaurant. After saving, the provider is locked.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <input
              type="text"
              placeholder="Search by name, ID, or GUID"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full rounded-lg border border-gray-200 px-4 py-2 text-sm focus:border-gray-400 focus:outline-none sm:max-w-md"
            />
            <span className="text-xs text-gray-500">
              {filteredRows.length} restaurant{filteredRows.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        {errorMessage && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMessage}
          </div>
        )}

        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">Restaurant</th>
                  <th className="px-4 py-3">Provider</th>
                  <th className="px-4 py-3">Stripe Bank</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredRows.map((row) => {
                  const provider = pendingProviders[row.restaurantId] ?? row.provider ?? "stripe";
                  const bankSummary =
                    row.bankName || row.bankLast4
                      ? `${row.bankName ?? "Bank"} ${row.bankLast4 ? `•••• ${row.bankLast4}` : ""}`.trim()
                      : "Not linked";
                  return (
                    <tr key={row.restaurantId}>
                      <td className="px-4 py-4">
                        <div className="font-medium text-gray-900">
                          {row.restaurantName ?? "Unknown Restaurant"}
                        </div>
                        <div className="text-xs text-gray-500">
                          ID {row.restaurantId}
                          {row.restaurantGuid ? ` • ${row.restaurantGuid}` : ""}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        {row.locked ? (
                          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700">
                            {providerLabels[row.provider ?? "stripe"]}
                          </span>
                        ) : (
                          <select
                            value={provider}
                            onChange={(event) =>
                              setPendingProviders((prev) => ({
                                ...prev,
                                [row.restaurantId]: event.target.value as ProviderOption,
                              }))
                            }
                            className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
                            disabled={isLoading}
                          >
                            <option value="stripe">Stripe</option>
                            <option value="astra">Astra (Astrafi)</option>
                          </select>
                        )}
                      </td>
                      <td className="px-4 py-4 text-xs text-gray-600">{bankSummary}</td>
                      <td className="px-4 py-4 text-right">
                        {row.locked ? (
                          <span className="text-xs text-gray-500">Locked</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleSave(row.restaurantId)}
                            disabled={isLoading}
                            className="rounded-lg bg-gray-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Save
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!filteredRows.length && (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-sm text-gray-500">
                      {isLoading ? "Loading restaurants..." : "No restaurants found."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

