import { useEffect, useMemo, useRef, useState } from "react";
import { type ApprovalScheduleWithContributors } from "../api/approvals";
import {
  fetchPayrollReport,
  fetchThisMonthReport,
  fetchThisWeekReport,
  fetchYesterdayReport,
} from "../api/reports";
import { getStoredPermissions } from "../auth/permissions";

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
  const [userId, setUserId] = useState<number | null>(null);
  const [schedules, setSchedules] = useState<ApprovalScheduleWithContributors[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [payrollStartDate, setPayrollStartDate] = useState("");
  const [payrollEndDate, setPayrollEndDate] = useState("");
  const [payrollRows, setPayrollRows] = useState<
    { employeeGuid: string | null; employeeName: string; totalPayout: number }[]
  >([]);
  const [isPayrollLoading, setIsPayrollLoading] = useState(false);
  const [periodRows, setPeriodRows] = useState<
    { employeeGuid: string | null; employeeName: string; totalPayout: number }[]
  >([]);
  const [periodRange, setPeriodRange] = useState<{ start?: string | null; end?: string | null }>({});
  const [isPeriodLoading, setIsPeriodLoading] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const storedRestaurantId = localStorage.getItem("restaurantKey");
    if (storedRestaurantId) {
      const parsedId = Number(storedRestaurantId);
      if (Number.isFinite(parsedId)) {
        setRestaurantId(parsedId);
      }
    }
    const storedUserId = localStorage.getItem("userId");
    if (storedUserId) {
      const parsedUserId = Number(storedUserId);
      if (Number.isFinite(parsedUserId)) {
        setUserId(parsedUserId);
      }
    }
    const permissions = getStoredPermissions(storedUserId);
    setIsAdminUser(permissions.adminAccess);
  }, []);

  useEffect(() => {
    let isMounted = true;
    if (restaurantId === null && userId === null) {
      setIsLoading(false);
      return () => {
        isMounted = false;
      };
    }
    fetchYesterdayReport(restaurantId, userId)
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
  }, [restaurantId, userId]);

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

  const visibleReportOptions = useMemo(
    () => reportOptions.filter((option) => option.id !== "payroll" || isAdminUser),
    [isAdminUser],
  );

  useEffect(() => {
    if (!isAdminUser && selectedReport === "payroll") {
      setSelectedReport(visibleReportOptions[0]?.id ?? "yesterday");
    }
  }, [isAdminUser, selectedReport, visibleReportOptions]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target || !exportMenuRef.current) {
        return;
      }
      if (!exportMenuRef.current.contains(target)) {
        setIsExportMenuOpen(false);
      }
    };
    document.addEventListener("click", handleClick);
    return () => {
      document.removeEventListener("click", handleClick);
    };
  }, []);

  useEffect(() => {
    if (selectedReport !== "payroll") {
      return;
    }
    const storedUserId = localStorage.getItem("userId");
    const userId = storedUserId ? Number(storedUserId) : NaN;
    if (!Number.isFinite(userId) || !payrollStartDate || !payrollEndDate) {
      setPayrollRows([]);
      return;
    }
    setIsPayrollLoading(true);
    fetchPayrollReport(userId, payrollStartDate, payrollEndDate)
      .then((data) => {
        setPayrollRows(data.employees || []);
      })
      .finally(() => {
        setIsPayrollLoading(false);
      });
  }, [selectedReport, payrollStartDate, payrollEndDate]);

  useEffect(() => {
    if (selectedReport !== "this-week" && selectedReport !== "this-month") {
      setPeriodRows([]);
      setPeriodRange({});
      return;
    }
    const storedUserId = localStorage.getItem("userId");
    const userId = storedUserId ? Number(storedUserId) : NaN;
    if (!Number.isFinite(userId)) {
      return;
    }
    setIsPeriodLoading(true);
    const fetcher = selectedReport === "this-week" ? fetchThisWeekReport : fetchThisMonthReport;
    fetcher(userId)
      .then((data) => {
        setPeriodRows(data.employees || []);
        setPeriodRange({ start: data.startDate, end: data.endDate });
      })
      .finally(() => {
        setIsPeriodLoading(false);
      });
  }, [selectedReport]);

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

  const exportData = useMemo(() => {
    if (selectedReport === "yesterday") {
      if (yesterdaySchedules.length === 0) {
        return null;
      }
      const headers = [
        "Schedule ID",
        "Schedule Name",
        "Business Date",
        "Employee",
        "Job Title",
        "Total Sales",
        "Total Tips",
        "Total Gratuity",
        "Paid Tips",
        "Paid Gratuity",
        "Net Payout",
      ];
      const rows = yesterdaySchedules.flatMap((schedule) => {
        const totals = buildScheduleTotals(schedule);
        return totals.entries.map((contributor) => {
          const netPayout =
            contributor.netPayout ??
            (contributor.payoutTips || 0) + (contributor.payoutGratuity || 0);
          return [
            String(schedule.payoutScheduleId),
            schedule.name || `Payout Schedule #${schedule.payoutScheduleId}`,
            schedule.businessDate || "",
            contributor.employeeName || "Unnamed",
            contributor.jobTitle || "Unassigned",
            String(contributor.totalSales || 0),
            String(contributor.totalTips || 0),
            String(contributor.totalGratuity || 0),
            String(contributor.payoutTips || 0),
            String(contributor.payoutGratuity || 0),
            String(netPayout),
          ];
        });
      });
      return { title: "yesterday-report", headers, rows };
    }

    if (selectedReport === "payroll") {
      if (payrollRows.length === 0 || !payrollStartDate || !payrollEndDate) {
        return null;
      }
      const headers = ["Employee", "Total Payout", "Start Date", "End Date"];
      const rows = payrollRows.map((row) => [
        row.employeeName,
        String(row.totalPayout),
        payrollStartDate,
        payrollEndDate,
      ]);
      return { title: "payroll-report", headers, rows };
    }

    if (selectedReport === "this-week" || selectedReport === "this-month") {
      if (periodRows.length === 0) {
        return null;
      }
      const headers = ["Employee", "Total Payout", "Start Date", "End Date"];
      const startDate = periodRange.start || "";
      const endDate = periodRange.end || "";
      const rows = periodRows.map((row) => [
        row.employeeName,
        String(row.totalPayout),
        startDate,
        endDate,
      ]);
      return { title: `${selectedReport}-report`, headers, rows };
    }

    return null;
  }, [
    selectedReport,
    yesterdaySchedules,
    payrollRows,
    payrollStartDate,
    payrollEndDate,
    periodRows,
    periodRange.start,
    periodRange.end,
  ]);

  const exportToCsv = (extension: "csv" | "xls") => {
    if (!exportData) {
      return;
    }
    const escapeCell = (value: string) => {
      const safe = value.replace(/"/g, '""');
      return `"${safe}"`;
    };
    const content = [
      exportData.headers.map(escapeCell).join(","),
      ...exportData.rows.map((row) => row.map(escapeCell).join(",")),
    ].join("\n");
    const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${exportData.title}.${extension}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const exportToPdf = () => {
    if (!exportData) {
      return;
    }
    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) {
      return;
    }
    const tableRows = exportData.rows
      .map(
        (row) =>
          `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`,
      )
      .join("");
    win.document.write(`
      <html>
        <head>
          <title>${exportData.title}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background: #f4f2ee; text-transform: uppercase; font-size: 11px; letter-spacing: 0.04em; }
            h1 { font-size: 18px; margin-bottom: 16px; }
          </style>
        </head>
        <body>
          <h1>${exportData.title}</h1>
          <table>
            <thead>
              <tr>${exportData.headers.map((header) => `<th>${header}</th>`).join("")}</tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
        </body>
      </html>
    `);
    win.document.close();
    win.focus();
    win.print();
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-gray-900">Report Range</h2>
            <div ref={exportMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setIsExportMenuOpen((prev) => !prev)}
                disabled={!exportData}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold uppercase tracking-wide ${
                  exportData
                    ? "border-[#cab99a] bg-white text-gray-700 hover:bg-[#faf7f2]"
                    : "cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400"
                }`}
              >
                Export
                <span className="text-base leading-none">▾</span>
              </button>
              {isExportMenuOpen && exportData ? (
                <div className="absolute right-0 z-10 mt-2 w-40 rounded-lg border border-[#e4dccf] bg-white shadow-lg">
                  <button
                    type="button"
                    onClick={() => exportToCsv("csv")}
                    className="w-full px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-700 hover:bg-[#faf7f2]"
                  >
                    CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => exportToCsv("xls")}
                    className="w-full px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-700 hover:bg-[#faf7f2]"
                  >
                    Excel
                  </button>
                  <button
                    type="button"
                    onClick={exportToPdf}
                    className="w-full px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-700 hover:bg-[#faf7f2]"
                  >
                    PDF
                  </button>
                </div>
              ) : null}
            </div>
          </div>
          <fieldset className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <legend className="sr-only">Select a report range</legend>
            {visibleReportOptions.map((option) => (
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
          {selectedReport === "payroll" ? (
            <div className="mt-6 rounded-xl border border-[#e4dccf] bg-[#faf7f2] p-4">
              <p className="text-sm font-semibold text-gray-900">Select your Pay period</p>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium text-gray-700">
                  Start date
                  <input
                    type="date"
                    value={payrollStartDate}
                    onChange={(event) => setPayrollStartDate(event.target.value)}
                    className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-[#cab99a] focus:outline-none focus:ring-2 focus:ring-[#cab99a]/30"
                  />
                </label>
                <label className="text-sm font-medium text-gray-700">
                  End date
                  <input
                    type="date"
                    value={payrollEndDate}
                    onChange={(event) => setPayrollEndDate(event.target.value)}
                    className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-[#cab99a] focus:outline-none focus:ring-2 focus:ring-[#cab99a]/30"
                  />
                </label>
              </div>
              <div className="mt-4 rounded-xl border border-[#e4dccf] bg-white">
                {isPayrollLoading ? (
                  <div className="p-4 text-sm text-gray-600">Loading payroll totals...</div>
                ) : payrollStartDate && payrollEndDate ? (
                  payrollRows.length === 0 ? (
                    <div className="p-4 text-sm text-gray-600">No settlements found for this period.</div>
                  ) : (
                    <table className="min-w-full text-sm">
                      <thead className="bg-[#f4f2ee] text-left text-xs uppercase tracking-wide text-gray-500">
                        <tr>
                          <th className="px-4 py-3">Employee</th>
                          <th className="px-4 py-3">Total Payout</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#e4dccf]">
                        {payrollRows.map((row) => (
                          <tr key={row.employeeGuid ?? row.employeeName}>
                            <td className="px-4 py-3 font-medium text-gray-900">
                              {row.employeeName}
                            </td>
                            <td className="px-4 py-3 text-gray-700">
                              {formatCurrency(row.totalPayout)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )
                ) : (
                  <div className="p-4 text-sm text-gray-600">
                    Choose a start and end date to view payroll totals.
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </section>

        {selectedReport === "yesterday" ? (
          <section className="mt-8 rounded-2xl border border-[#e4dccf] bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Yesterday</h2>
                <p className="mt-1 text-sm text-gray-600">
                  Detailed payout results for the previous business day.
                </p>
              </div>
            </div>

            {isLoading ? (
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
        ) : null}

        {selectedReport === "this-week" || selectedReport === "this-month" ? (
          <section className="mt-8 rounded-2xl border border-[#e4dccf] bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {selectedReport === "this-week" ? "This Week" : "This Month"}
                </h2>
                <p className="mt-1 text-sm text-gray-600">
                  Total payouts by employee for the selected period.
                </p>
              </div>
            </div>

            {isPeriodLoading ? (
              <div className="mt-6 rounded-xl border border-dashed border-[#e4dccf] bg-[#faf7f2] p-6 text-sm text-gray-600">
                Loading report data...
              </div>
            ) : periodRows.length === 0 ? (
              <div className="mt-6 rounded-xl border border-dashed border-[#e4dccf] bg-[#faf7f2] p-6 text-sm text-gray-600">
                No settlements found for this period.
              </div>
            ) : (
              <div className="mt-6 space-y-4">
                {periodRange.start && periodRange.end ? (
                  <p className="text-sm text-gray-600">
                    {periodRange.start} through {periodRange.end}
                  </p>
                ) : null}
                <div className="overflow-x-auto rounded-xl border border-[#e4dccf] bg-white">
                  <table className="min-w-full text-sm">
                    <thead className="bg-[#f4f2ee] text-left text-xs uppercase tracking-wide text-gray-500">
                      <tr>
                        <th className="px-4 py-3">Employee</th>
                        <th className="px-4 py-3">Total Payout</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#e4dccf]">
                      {periodRows.map((row) => (
                        <tr key={row.employeeGuid ?? row.employeeName}>
                          <td className="px-4 py-3 font-medium text-gray-900">
                            {row.employeeName}
                          </td>
                          <td className="px-4 py-3 text-gray-700">
                            {formatCurrency(row.totalPayout)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        ) : null}

      </div>
    </main>
  );
}
