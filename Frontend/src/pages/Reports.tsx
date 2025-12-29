import { useEffect, useMemo, useState } from "react";
import { type ApprovalScheduleWithContributors } from "../api/approvals";
import { fetchYesterdayReport } from "../api/reports";

const reportOptions = [
  {
    id: "yesterday",
    label: "Yesterday",
    description: "One-day snapshot of sales, tips, and payouts.",
  },
  {
    id: "this-week",
    label: "This Week",
    description: "Week-to-date performance and payout coverage.",
  },
  {
    id: "this-month",
    label: "This Month",
    description: "Month-to-date totals with trend highlights.",
  },
  {
    id: "payroll",
    label: "Payroll",
    description: "Payroll-ready summary for the current cycle.",
  },
];

export default function Reports() {
  const [selectedReport, setSelectedReport] = useState(reportOptions[0]?.id ?? "yesterday");
  const [restaurantId, setRestaurantId] = useState<number | null>(null);
  const [schedules, setSchedules] = useState<ApprovalScheduleWithContributors[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const storedRestaurantId = localStorage.getItem("restaurantKey");
    if (storedRestaurantId) {
      const parsedId = Number(storedRestaurantId);
      if (Number.isFinite(parsedId)) {
        setRestaurantId(parsedId);
      }
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    if (restaurantId === null) {
      setIsLoading(false);
      return () => {
        isMounted = false;
      };
    }
    fetchYesterdayReport(restaurantId)
      .then((data) => {
        if (isMounted) {
          setSchedules(data.schedules);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });
    return () => {
      isMounted = false;
    };
  }, [restaurantId]);

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);

  const getDateKey = (value: string | null) => {
    if (!value) {
      return "";
    }
    const cleaned = value.replace(/\D/g, "");
    return cleaned.length ? cleaned : value;
  };

  const parseDateFromKey = (key: string, fallback: string | null) => {
    if (key.length === 8) {
      const year = Number(key.slice(0, 4));
      const month = Number(key.slice(4, 6));
      const day = Number(key.slice(6, 8));
      const parsed = new Date(year, month - 1, day);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    if (!fallback) {
      return null;
    }
    const parsed = new Date(fallback);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const formatBusinessDate = (value: string | null) => {
    const key = getDateKey(value);
    const parsed = parseDateFromKey(key, value);
    if (!parsed) {
      return value ?? "Unknown date";
    }
    const dayName = parsed.toLocaleDateString("en-US", { weekday: "long" });
    const dateValue = parsed.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    return `${dayName} • ${dateValue}`;
  };

  const yesterdayKey = useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}${month}${day}`;
  }, []);

  const yesterdaySchedules = useMemo(() => {
    if (selectedReport !== "yesterday") {
      return [];
    }
    return schedules
      .filter((schedule) => getDateKey(schedule.businessDate) === yesterdayKey)
      .sort((a, b) => b.payoutScheduleId - a.payoutScheduleId);
  }, [schedules, selectedReport, yesterdayKey]);

  const buildScheduleTotals = (schedule: ApprovalScheduleWithContributors) => {
    const entries = schedule.contributors;
    const payoutTipsTotal = entries.reduce((sum, item) => sum + (item.payoutTips || 0), 0);
    const payoutGratuityTotal = entries.reduce((sum, item) => sum + (item.payoutGratuity || 0), 0);
    const netPayoutTotal = entries.reduce((sum, item) => {
      const payout = item.netPayout ?? (item.payoutTips || 0) + (item.payoutGratuity || 0);
      return sum + payout;
    }, 0);
    return {
      entries,
      payoutTipsTotal,
      payoutGratuityTotal,
      netPayoutTotal,
    };
  };

  return (
    <main className="min-h-full bg-[#f4f2ee] p-8">
      <div className="w-full">
        <header>
          <h1 className="text-3xl font-semibold text-gray-900">Reports</h1>
          <p className="mt-2 text-sm text-gray-600">
            Choose a reporting window to review sales performance and payout coverage.
          </p>
        </header>

        <section className="mt-8 rounded-2xl border border-[#e4dccf] bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Report Range</h2>
          </div>
          <fieldset className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <legend className="sr-only">Select a report range</legend>
            {reportOptions.map((option) => (
              <label
                key={option.id}
                className="group relative flex cursor-pointer items-start gap-4 rounded-xl border border-[#e4dccf] bg-[#faf7f2] p-4 transition hover:border-[#cab99a]"
              >
                <input
                  type="radio"
                  name="report-range"
                  value={option.id}
                  checked={selectedReport === option.id}
                  onChange={() => setSelectedReport(option.id)}
                  className="peer sr-only"
                />
                <span className="mt-1 h-4 w-4 rounded-full border border-gray-400 bg-white shadow-inner transition peer-checked:border-[#cab99a] peer-checked:bg-[#cab99a]" />
                <span className="flex-1">
                  <span className="block text-sm font-semibold text-gray-900">
                    {option.label}
                  </span>
                  <span className="mt-1 block text-xs text-gray-600">
                    {option.description}
                  </span>
                </span>
                <span className="pointer-events-none absolute inset-0 rounded-xl border-2 border-transparent transition group-hover:border-[#cab99a]/40 peer-checked:border-[#cab99a]" />
              </label>
            ))}
          </fieldset>
        </section>

        <section className="mt-8 rounded-2xl border border-[#e4dccf] bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Yesterday</h2>
              <p className="mt-1 text-sm text-gray-600">
                Detailed payout results for the previous business day.
              </p>
            </div>
          </div>

          {selectedReport !== "yesterday" ? (
            <div className="mt-6 rounded-xl border border-dashed border-[#e4dccf] bg-[#faf7f2] p-6 text-sm text-gray-600">
              Select Yesterday to view payout details.
            </div>
          ) : isLoading ? (
            <div className="mt-6 rounded-xl border border-dashed border-[#e4dccf] bg-[#faf7f2] p-6 text-sm text-gray-600">
              Loading report data...
            </div>
          ) : restaurantId === null ? (
            <div className="mt-6 rounded-xl border border-dashed border-[#e4dccf] bg-[#faf7f2] p-6 text-sm text-gray-600">
              Select a restaurant to view report details.
            </div>
          ) : yesterdaySchedules.length === 0 ? (
            <div className="mt-6 rounded-xl border border-dashed border-[#e4dccf] bg-[#faf7f2] p-6 text-sm text-gray-600">
              No payouts found for yesterday.
            </div>
          ) : (
            <div className="mt-6 space-y-6">
              {yesterdaySchedules.map((schedule) => {
                const totals = buildScheduleTotals(schedule);
                return (
                  <article
                    key={`${schedule.payoutScheduleId}-${schedule.businessDate ?? "unknown"}`}
                    className="rounded-2xl border border-[#e4dccf] bg-[#faf7f2] p-5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <h3 className="text-base font-semibold text-gray-900">
                          {schedule.name || `Payout Schedule #${schedule.payoutScheduleId}`}
                        </h3>
                        <p className="mt-1 text-sm text-gray-600">
                          {formatBusinessDate(schedule.businessDate)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-4 rounded-xl border border-[#e4dccf] bg-white p-4 text-sm text-gray-700 sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <span className="block text-xs uppercase tracking-wide text-gray-500">
                          Total Sales
                        </span>
                        <span className="font-semibold">
                          {formatCurrency(schedule.totalSales || 0)}
                        </span>
                      </div>
                      <div>
                        <span className="block text-xs uppercase tracking-wide text-gray-500">
                          Total Tips
                        </span>
                        <span className="font-semibold">
                          {formatCurrency(schedule.totalTips || 0)}
                        </span>
                      </div>
                      <div>
                        <span className="block text-xs uppercase tracking-wide text-gray-500">
                          Total Gratuity
                        </span>
                        <span className="font-semibold">
                          {formatCurrency(schedule.totalGratuity || 0)}
                        </span>
                      </div>
                      <div>
                        <span className="block text-xs uppercase tracking-wide text-gray-500">
                          Net Payout
                        </span>
                        <span className="font-semibold">
                          {formatCurrency(totals.netPayoutTotal)}
                        </span>
                      </div>
                    </div>

                    <div className="mt-6 overflow-x-auto rounded-xl border border-[#e4dccf] bg-white">
                      <table className="min-w-full text-sm">
                        <thead className="bg-[#f4f2ee] text-left text-xs uppercase tracking-wide text-gray-500">
                          <tr>
                            <th className="px-4 py-3">Employee</th>
                            <th className="px-4 py-3">Job Title</th>
                            <th className="px-4 py-3">Total Sales</th>
                            <th className="px-4 py-3">Total Tips</th>
                            <th className="px-4 py-3">Total Gratuity</th>
                            <th className="px-4 py-3">Paid Tips</th>
                            <th className="px-4 py-3">Paid Gratuity</th>
                            <th className="px-4 py-3">Net Payout</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#e4dccf]">
                          {totals.entries.map((contributor) => {
                            const netPayout =
                              contributor.netPayout ??
                              (contributor.payoutTips || 0) + (contributor.payoutGratuity || 0);
                            return (
                              <tr key={`${contributor.employeeGuid}-${contributor.payoutReceiverId}`}>
                                <td className="px-4 py-3 font-medium text-gray-900">
                                  {contributor.employeeName || "Unnamed"}
                                </td>
                                <td className="px-4 py-3 text-gray-700">
                                  {contributor.jobTitle || "Unassigned"}
                                </td>
                                <td className="px-4 py-3 text-gray-700">
                                  {formatCurrency(contributor.totalSales || 0)}
                                </td>
                                <td className="px-4 py-3 text-gray-700">
                                  {formatCurrency(contributor.totalTips || 0)}
                                </td>
                                <td className="px-4 py-3 text-gray-700">
                                  {formatCurrency(contributor.totalGratuity || 0)}
                                </td>
                                <td className="px-4 py-3 text-gray-700">
                                  {formatCurrency(contributor.payoutTips || 0)}
                                </td>
                                <td className="px-4 py-3 text-gray-700">
                                  {formatCurrency(contributor.payoutGratuity || 0)}
                                </td>
                                <td className="px-4 py-3 font-semibold text-gray-900">
                                  {formatCurrency(netPayout)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

      </div>
    </main>
  );
}
