import { useEffect, useMemo, useState } from "react";
import { fetchApprovals, type ApprovalScheduleWithContributors } from "../api/approvals";

const formatValue = (value: string | null | undefined) => (value ? value : "N/A");

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);

const formatPayoutAmount = (amount: number) => formatCurrency(amount);

const getNetPayout = (_isContributor: string, tips: number, gratuity: number, payoutAmount: number) => {
  const gross = tips + gratuity;
  return gross + payoutAmount;
};
const getDateKey = (value: string | null) => {
  if (!value) {
    return "";
  }
  const key = value.replace(/\D/g, "");
  return key.length ? key : value;
};

const sortSchedulesByDate = (items: ApprovalScheduleWithContributors[]) =>
  [...items].sort((a, b) => {
    const keyA = getDateKey(a.businessDate);
    const keyB = getDateKey(b.businessDate);
    if (keyA === keyB) {
      return b.payoutScheduleId - a.payoutScheduleId;
    }
    return keyA < keyB ? 1 : -1;
  });

export default function Reconciliation() {
  const [restaurantId, setRestaurantId] = useState<number | null>(null);
  const [schedules, setSchedules] = useState<ApprovalScheduleWithContributors[]>([]);
  const [activeScheduleKey, setActiveScheduleKey] = useState<string | null>(null);
  const [expandedEmployees, setExpandedEmployees] = useState<Record<string, boolean>>({});
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
    fetchApprovals(restaurantId)
      .then((data) => {
        if (isMounted) {
          const sortedSchedules = sortSchedulesByDate(data.schedules);
          setSchedules(sortedSchedules);
          const firstSchedule = sortedSchedules[0];
          setActiveScheduleKey(
            firstSchedule ? `${firstSchedule.payoutScheduleId}-${firstSchedule.businessDate}` : null,
          );
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

  const contributorCountLabel = useMemo(() => {
    if (isLoading) {
      return "Loading contributors...";
    }
    if (schedules.length === 0) {
      return "No payout schedules found yet.";
    }
    const contributorCount = schedules.reduce((total, schedule) => total + schedule.contributorCount, 0);
    return `${contributorCount} contributor${contributorCount === 1 ? "" : "s"}`;
  }, [isLoading, schedules]);

  return (
    <main className="px-6 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Approvals</h1>
        <p className="text-sm text-gray-500">
          Read-only payout summaries by contributor. {contributorCountLabel}
        </p>
      </div>

      <div className="space-y-6">
        {isLoading ? (
          <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500 shadow-sm">
            Loading approval details...
          </div>
        ) : schedules.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500 shadow-sm">
            No approvals to show yet.
          </div>
        ) : (
          schedules.map((schedule) => {
            const scheduleKey = `${schedule.payoutScheduleId}-${schedule.businessDate}`;
            const isActive = scheduleKey === activeScheduleKey;
            return (
              <section
                key={scheduleKey}
                className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
              >
                <div
                  className="grid w-full cursor-pointer items-center gap-3 text-left sm:grid-cols-[1fr_auto_1fr]"
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    setActiveScheduleKey(isActive ? null : scheduleKey)
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setActiveScheduleKey(isActive ? null : scheduleKey);
                    }
                  }}
                >
                  <div className="text-left">
                    <h2 className="text-lg font-semibold text-gray-900">
                      {schedule.name ?? "Payout Schedule"}
                      {schedule.businessDate ? (
                        <span className="ml-2 font-semibold text-gray-900">
                          ({schedule.businessDate})
                        </span>
                      ) : null}
                    </h2>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-3 text-sm text-gray-600">
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
                      {schedule.payoutRuleLabel}
                    </span>
                    <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">
                      Contributors: {schedule.contributorCount}
                    </span>
                    <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">
                      Receivers: {schedule.receiverCount}
                    </span>
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setActiveScheduleKey(isActive ? null : scheduleKey);
                      }}
                      className="rounded-lg bg-[#cab99a] px-4 py-2 text-sm font-semibold text-black shadow-md transition hover:bg-[#bfa986] hover:shadow-lg"
                    >
                      Approve
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-4">
                  <div>
                    <p className="text-xs font-semibold uppercase text-gray-500">Start day</p>
                    <p className="mt-1 text-sm text-gray-700">{formatValue(schedule.startDay)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase text-gray-500">End day</p>
                    <p className="mt-1 text-sm text-gray-700">{formatValue(schedule.endDay)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase text-gray-500">Start time</p>
                    <p className="mt-1 text-sm text-gray-700">{formatValue(schedule.startTime)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase text-gray-500">End time</p>
                    <p className="mt-1 text-sm text-gray-700">{formatValue(schedule.endTime)}</p>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-4">
                  <div>
                    <p className="text-xs font-semibold uppercase text-gray-500">Total sales</p>
                    <p className="mt-1 text-sm text-gray-700">{formatCurrency(schedule.totalSales)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase text-gray-500">Net sales</p>
                    <p className="mt-1 text-sm text-gray-700">{formatCurrency(schedule.netSales)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase text-gray-500">Total tips</p>
                    <p className="mt-1 text-sm text-gray-700">{formatCurrency(schedule.totalTips)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase text-gray-500">Total gratuity</p>
                    <p className="mt-1 text-sm text-gray-700">{formatCurrency(schedule.totalGratuity)}</p>
                  </div>
                </div>

                {isActive ? (
                  <div className="mt-6 space-y-6 border-t border-gray-100 pt-6">
                    {schedule.contributors.length === 0 ? (
                      <div className="text-sm text-gray-500">No contributors assigned.</div>
                    ) : (
                      (() => {
                        const contributors = schedule.contributors.filter(
                          (contributor) => contributor.isContributor === "Yes",
                        );
                        const receivers = schedule.contributors.filter(
                          (contributor) => contributor.isContributor === "No",
                        );
                        const totalReceiverPayout = receivers.reduce(
                          (total, receiver) => total + receiver.payoutTips + receiver.payoutGratuity,
                          0,
                        );
                        const contributorPayoutShare =
                          contributors.length > 0 ? -(totalReceiverPayout / contributors.length) : 0;
                        const ordered = [...contributors, ...receivers];
                        const jobTitlesWithEmployees = new Set(
                          ordered
                            .map((contributor) => contributor.jobTitle)
                            .filter((jobTitle): jobTitle is string => Boolean(jobTitle)),
                        );
                        const missingRoles = schedule.receiverRoles.reduce((acc, role) => {
                          if (!role.receiverId || jobTitlesWithEmployees.has(role.receiverId)) {
                            return acc;
                          }
                          if (!acc.some((item) => item.receiverId === role.receiverId)) {
                            acc.push(role);
                          }
                          return acc;
                        }, [] as typeof schedule.receiverRoles);
                        return (
                          <>
                            <div className="space-y-4">
                              <div>
                                <h4 className="text-sm font-semibold text-gray-900">Contributors</h4>
                                <div className="mt-3 space-y-4">
                                  {contributors.length === 0 ? (
                                    <div className="text-sm text-gray-500">No contributors assigned.</div>
                                  ) : (
                                    contributors.map((contributor) => {
                                      const employeeKey = `${scheduleKey}-${contributor.employeeGuid}-${contributor.jobTitle ?? "role"}`;
                                      const isExpanded = Boolean(expandedEmployees[employeeKey]);
                                      return (
                                        <div
                              key={employeeKey}
                              className="rounded-lg border border-gray-200 bg-gray-50 p-5"
                            >
                              <div
                                className="flex flex-wrap items-start justify-between gap-4"
                                role="button"
                                tabIndex={0}
                                onClick={() =>
                                  setExpandedEmployees((current) => ({
                                    ...current,
                                    [employeeKey]: !current[employeeKey],
                                  }))
                                }
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    setExpandedEmployees((current) => ({
                                      ...current,
                                      [employeeKey]: !current[employeeKey],
                                    }));
                                  }
                                }}
                              >
                                <div>
                                  <div className="w-full overflow-x-auto">
                                    <div className="grid min-w-[1180px] items-center gap-2 md:grid-cols-[280px_180px_180px_160px_180px_220px_180px]">
                                      <h3 className="text-base font-semibold text-gray-900 md:pr-2">
                                        <span>
                                          {contributor.employeeName}
                                          {contributor.jobTitle ? ` (${contributor.jobTitle})` : ""}
                                        </span>
                                      </h3>
                                    <div className="flex justify-start">
                                      <span className="whitespace-nowrap rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700">
                                        Total Sales: {formatCurrency(contributor.totalSales)}
                                      </span>
                                    </div>
                                    <div className="flex justify-start">
                                      <span className="whitespace-nowrap rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700">
                                        Net Sales: {formatCurrency(contributor.netSales)}
                                      </span>
                                    </div>
                                    <div className="flex justify-start">
                                      <span className="whitespace-nowrap rounded-full bg-amber-50 px-3 py-1 text-sm text-amber-700">
                                        Tips: {formatCurrency(contributor.totalTips)}
                                      </span>
                                    </div>
                                    <div className="flex justify-start">
                                      <span className="whitespace-nowrap rounded-full bg-sky-50 px-3 py-1 text-sm text-sky-700">
                                        Gratuity: {formatCurrency(contributor.totalGratuity)}
                                      </span>
                                    </div>
                                    <div className="flex justify-start">
                                      <span className="min-w-[220px] whitespace-nowrap rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700">
                                        Payout: {contributor.payoutPercentage.toFixed(2)}% (
                                        {formatPayoutAmount(contributorPayoutShare)})
                                      </span>
                                    </div>
                                    <div className="flex justify-start">
                                      <span className="whitespace-nowrap rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700">
                                        Net Payout: {formatCurrency(
                                          getNetPayout(
                                            contributor.isContributor,
                                            contributor.totalTips,
                                            contributor.totalGratuity,
                                            contributorPayoutShare,
                                          ),
                                        )}
                                      </span>
                                    </div>
                                  </div>
                                  </div>
                                  <p className="text-xs text-gray-500">{contributor.employeeGuid}</p>
                                </div>
                                <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600" />
                              </div>

                              {isExpanded ? (
                                <>
                                  <div className="mt-4 grid gap-4 md:grid-cols-3">
                                    <div>
                                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">In time</p>
                                      <p className="mt-2 text-sm font-semibold text-gray-900">
                                        {formatValue(contributor.inTime)}
                                      </p>
                                    </div>
                                    <div>
                                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Out time</p>
                                      <p className="mt-2 text-sm font-semibold text-gray-900">
                                        {formatValue(contributor.outTime)}
                                      </p>
                                    </div>
                                    <div>
                                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Hours worked</p>
                                      <p className="mt-2 text-sm font-semibold text-gray-900">
                                        {contributor.hoursWorked ? contributor.hoursWorked.toFixed(2) : "0.00"}
                                      </p>
                                    </div>
                                    <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                      Payout percentage
                                      <input
                                        readOnly
                                        value={`${contributor.payoutPercentage.toFixed(2)}%`}
                                        className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700"
                                      />
                                    </label>
                                  </div>

                                  <div className="mt-5">
                                    <h4 className="text-sm font-semibold text-gray-900">Payout details</h4>
                                    <div className="mt-3 grid gap-3 sm:grid-cols-2 md:grid-cols-4">
                                      <div>
                                        <p className="text-xs font-semibold uppercase text-gray-500">Net sales</p>
                                        <p className="mt-1 text-sm text-gray-700">
                                          {formatCurrency(contributor.netSales)}
                                        </p>
                                      </div>
                                      <div>
                                        <p className="text-xs font-semibold uppercase text-gray-500">Overall tips</p>
                                        <p className="mt-1 text-sm text-gray-700">
                                          {formatCurrency(contributor.overallTips)}
                                        </p>
                                      </div>
                                      <div>
                                        <p className="text-xs font-semibold uppercase text-gray-500">Overall gratuity</p>
                                        <p className="mt-1 text-sm text-gray-700">
                                          {formatCurrency(contributor.overallGratuity)}
                                        </p>
                                      </div>
                                      <div>
                                        <p className="text-xs font-semibold uppercase text-gray-500">Payout tips</p>
                                        <p className="mt-1 text-sm text-gray-700">
                                          {formatCurrency(contributor.payoutTips)}
                                        </p>
                                      </div>
                                      <div>
                                        <p className="text-xs font-semibold uppercase text-gray-500">Payout gratuity</p>
                                        <p className="mt-1 text-sm text-gray-700">
                                          {formatCurrency(contributor.payoutGratuity)}
                                        </p>
                                      </div>
                                    </div>
                                  </div>
                                </>
                                          ) : null}
                                        </div>
                                      );
                                    })
                                  )}
                                </div>
                              </div>
                              <div>
                                <h4 className="text-sm font-semibold text-gray-900">Receivers</h4>
                                <div className="mt-3 space-y-4">
                                  {receivers.length === 0 && missingRoles.length === 0 ? (
                                    <div className="text-sm text-gray-500">No receivers assigned.</div>
                                  ) : (
                                    <>
                                      {receivers.map((contributor) => {
                                        const employeeKey = `${scheduleKey}-${contributor.employeeGuid}-${contributor.jobTitle ?? "role"}`;
                                        const isExpanded = Boolean(expandedEmployees[employeeKey]);
                                        return (
                                          <div
                                            key={employeeKey}
                                            className="rounded-lg border border-gray-200 bg-gray-50 p-5"
                                          >
                                            <div
                                              className="flex flex-wrap items-start justify-between gap-4"
                                              role="button"
                                              tabIndex={0}
                                              onClick={() =>
                                                setExpandedEmployees((current) => ({
                                                  ...current,
                                                  [employeeKey]: !current[employeeKey],
                                                }))
                                              }
                                              onKeyDown={(event) => {
                                                if (event.key === "Enter" || event.key === " ") {
                                                  event.preventDefault();
                                                  setExpandedEmployees((current) => ({
                                                    ...current,
                                                    [employeeKey]: !current[employeeKey],
                                                  }));
                                                }
                                              }}
                                            >
                                              <div>
                                              <div className="w-full overflow-x-auto">
                                                <div className="grid min-w-[1180px] items-center gap-2 md:grid-cols-[280px_180px_180px_160px_180px_220px_180px]">
                                                <h3 className="text-base font-semibold text-gray-900 md:pr-2">
                                                  <span>
                                                    {contributor.employeeName}
                                                    {contributor.jobTitle ? ` (${contributor.jobTitle})` : ""}
                                                  </span>
                                                </h3>
                                                <div className="flex justify-start">
                                                  <span className="whitespace-nowrap rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700">
                                                    Total Sales: {formatCurrency(contributor.totalSales)}
                                                  </span>
                                                </div>
                                                <div className="flex justify-start">
                                                  <span className="whitespace-nowrap rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700">
                                                    Net Sales: {formatCurrency(contributor.netSales)}
                                                  </span>
                                                </div>
                                                <div className="flex justify-start">
                                                  <span className="whitespace-nowrap rounded-full bg-amber-50 px-3 py-1 text-sm text-amber-700">
                                                    Tips: {formatCurrency(contributor.totalTips)}
                                                  </span>
                                                </div>
                                                <div className="flex justify-start">
                                                  <span className="whitespace-nowrap rounded-full bg-sky-50 px-3 py-1 text-sm text-sky-700">
                                                    Gratuity: {formatCurrency(contributor.totalGratuity)}
                                                  </span>
                                                </div>
                                                <div className="flex justify-start">
                                                  <span className="min-w-[220px] whitespace-nowrap rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700">
                                                    Payout: {contributor.payoutPercentage.toFixed(2)}% (
                                                    {formatPayoutAmount(contributor.payoutTips + contributor.payoutGratuity)})
                                                  </span>
                                                </div>
                                                <div className="flex justify-start">
                                                  <span className="whitespace-nowrap rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700">
                                                    Net Payout: {formatCurrency(
                                                      getNetPayout(
                                                        contributor.isContributor,
                                                        contributor.totalTips,
                                                        contributor.totalGratuity,
                                                        contributor.payoutTips + contributor.payoutGratuity,
                                                      ),
                                                    )}
                                                  </span>
                                                </div>
                                              </div>
                                              </div>
                                                <p className="text-xs text-gray-500">{contributor.employeeGuid}</p>
                                              </div>
                                              <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600" />
                                            </div>

                                            {isExpanded ? (
                                              <>
                                                <div className="mt-4 grid gap-4 md:grid-cols-3">
                                                  <div>
                                                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">In time</p>
                                                    <p className="mt-2 text-sm font-semibold text-gray-900">
                                                      {formatValue(contributor.inTime)}
                                                    </p>
                                                  </div>
                                                  <div>
                                                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Out time</p>
                                                    <p className="mt-2 text-sm font-semibold text-gray-900">
                                                      {formatValue(contributor.outTime)}
                                                    </p>
                                                  </div>
                                                  <div>
                                                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Hours worked</p>
                                                    <p className="mt-2 text-sm font-semibold text-gray-900">
                                                      {contributor.hoursWorked ? contributor.hoursWorked.toFixed(2) : "0.00"}
                                                    </p>
                                                  </div>
                                                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                                    Payout percentage
                                                    <input
                                                      readOnly
                                                      value={`${contributor.payoutPercentage.toFixed(2)}%`}
                                                      className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700"
                                                    />
                                                  </label>
                                                </div>

                                                <div className="mt-5">
                                                  <h4 className="text-sm font-semibold text-gray-900">Payout details</h4>
                                                  <div className="mt-3 grid gap-3 sm:grid-cols-2 md:grid-cols-4">
                                                    <div>
                                                      <p className="text-xs font-semibold uppercase text-gray-500">Net sales</p>
                                                      <p className="mt-1 text-sm text-gray-700">
                                                        {formatCurrency(contributor.netSales)}
                                                      </p>
                                                    </div>
                                                    <div>
                                                      <p className="text-xs font-semibold uppercase text-gray-500">Overall tips</p>
                                                      <p className="mt-1 text-sm text-gray-700">
                                                        {formatCurrency(contributor.overallTips)}
                                                      </p>
                                                    </div>
                                                    <div>
                                                      <p className="text-xs font-semibold uppercase text-gray-500">Overall gratuity</p>
                                                      <p className="mt-1 text-sm text-gray-700">
                                                        {formatCurrency(contributor.overallGratuity)}
                                                      </p>
                                                    </div>
                                                    <div>
                                                      <p className="text-xs font-semibold uppercase text-gray-500">Payout tips</p>
                                                      <p className="mt-1 text-sm text-gray-700">
                                                        {formatCurrency(contributor.payoutTips)}
                                                      </p>
                                                    </div>
                                                    <div>
                                                      <p className="text-xs font-semibold uppercase text-gray-500">Payout gratuity</p>
                                                      <p className="mt-1 text-sm text-gray-700">
                                                        {formatCurrency(contributor.payoutGratuity)}
                                                      </p>
                                                    </div>
                                                  </div>
                                                </div>
                                              </>
                                            ) : null}
                                          </div>
                                        );
                                      })}
                                      {missingRoles.map((role) => (
                                        <div
                                          key={`${scheduleKey}-role-${role.receiverId}`}
                                          className="rounded-lg border border-dashed border-gray-200 bg-white p-5 text-sm text-gray-600"
                                        >
                                          <div className="flex flex-wrap items-center justify-between gap-3">
                                            <div className="font-semibold text-gray-900">
                                              {role.receiverId}
                                            </div>
                                            <div className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700">
                                              {role.payoutPercentage.toFixed(2)}%
                                            </div>
                                          </div>
                                          <p className="mt-2 text-xs text-gray-500">No employee assigned for this job title.</p>
                                        </div>
                                      ))}
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                          </>
                        );
                      })()
                    )}
                  </div>
                ) : null}
              </section>
            );
          })
        )}
      </div>
    </main>
  );
}
