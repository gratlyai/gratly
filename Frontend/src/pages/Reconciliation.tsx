import { useEffect, useMemo, useState } from "react";
import {
  approvePayoutSchedule,
  fetchApprovals,
  saveApprovalOverrides,
  type ApprovalScheduleWithContributors,
} from "../api/approvals";
import { fetchActiveEmployeesByJobTitle, type EmployeeWithJob } from "../api/employees";

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
  const [editingScheduleKey, setEditingScheduleKey] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState(0);
  const [activeEmployeesByJob, setActiveEmployeesByJob] = useState<EmployeeWithJob[]>([]);
  const [addMemberSelections, setAddMemberSelections] = useState<
    Record<string, Record<string, { id: string; name: string } | null>>
  >({});
  const [addMemberDropdowns, setAddMemberDropdowns] = useState<Record<string, Record<string, boolean>>>({});
  const [addMemberSlots, setAddMemberSlots] = useState<Record<string, string[]>>({});
  const [payoutEdits, setPayoutEdits] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [approvedScheduleKeys, setApprovedScheduleKeys] = useState<Set<string>>(new Set());

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
          setActiveScheduleKey(null);
          setEditingScheduleKey(null);
          setApprovedScheduleKeys(
            new Set(
              sortedSchedules
                .filter((item) => item.isApproved)
                .map((item) => `${item.payoutScheduleId}-${item.businessDate}`),
            ),
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

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && target.closest('[data-add-member-dropdown="true"]')) {
        return;
      }
      setAddMemberDropdowns({});
    };
    document.addEventListener("click", handleClick);
    return () => {
      document.removeEventListener("click", handleClick);
    };
  }, []);

  const parsePercentage = (value: string) => {
    const cleaned = value.replace(/[^0-9.-]/g, "");
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const roundCurrency = (value: number) => Math.round(value * 100) / 100;

  const getOverallBase = (schedule: ApprovalScheduleWithContributors) => {
    const match = schedule.contributors.find(
      (contributor) => contributor.overallTips || contributor.overallGratuity,
    );
    return {
      overallTips: match?.overallTips ?? schedule.totalTips,
      overallGratuity: match?.overallGratuity ?? schedule.totalGratuity,
    };
  };

  const buildApprovalItems = (schedule: ApprovalScheduleWithContributors) => {
    const receivers = schedule.contributors.filter(
      (contributor) => (contributor.isContributor || "").toLowerCase() === "no",
    );
    const contributors = schedule.contributors.filter(
      (contributor) => (contributor.isContributor || "").toLowerCase() === "yes",
    );
    const eligibleContributors = contributors.filter((contributor) => {
      const tipTotal =
        Number(contributor.totalTips || 0) + Number(contributor.totalGratuity || 0);
      return tipTotal > 0;
    });
    const totalReceiverTips = receivers.reduce((total, receiver) => total + receiver.payoutTips, 0);
    const totalReceiverGratuity = receivers.reduce(
      (total, receiver) => total + receiver.payoutGratuity,
      0,
    );
    const contributorTipsShare =
      eligibleContributors.length > 0 ? -(totalReceiverTips / eligibleContributors.length) : 0;
    const contributorGratuityShare =
      eligibleContributors.length > 0
        ? -(totalReceiverGratuity / eligibleContributors.length)
        : 0;

    return schedule.contributors.map((item) => {
      const isContributor = (item.isContributor || "").toLowerCase() === "yes";
      const tipTotal = Number(item.totalTips || 0) + Number(item.totalGratuity || 0);
      const payoutTips = isContributor && tipTotal > 0 ? contributorTipsShare : item.payoutTips;
      const payoutGratuity =
        isContributor && tipTotal > 0 ? contributorGratuityShare : item.payoutGratuity;
      const payoutAmount = payoutTips + payoutGratuity;
      const netPayout = Math.max(
        0,
        getNetPayout(item.isContributor, item.totalTips, item.totalGratuity, payoutAmount),
      );
      return {
        employeeGuid: item.employeeGuid,
        employeeName: item.employeeName,
        jobTitle: item.jobTitle,
        isContributor: item.isContributor,
        payoutReceiverId: item.payoutReceiverId,
        payoutPercentage: item.payoutPercentage,
        totalSales: item.totalSales,
        netSales: item.netSales,
        totalTips: item.totalTips,
        totalGratuity: item.totalGratuity,
        overallTips: item.overallTips,
        overallGratuity: item.overallGratuity,
        payoutTips,
        payoutGratuity,
        netPayout,
      };
    });
  };

  const getMissingRoles = (schedule: ApprovalScheduleWithContributors) => {
    const jobTitlesWithEmployees = new Set(
      schedule.contributors
        .map((contributor) => contributor.jobTitle)
        .filter((jobTitle): jobTitle is string => Boolean(jobTitle)),
    );
    return schedule.receiverRoles.reduce((acc, role) => {
      if (!role.receiverId || jobTitlesWithEmployees.has(role.receiverId)) {
        return acc;
      }
      if (!acc.some((item) => item.receiverId === role.receiverId)) {
        acc.push(role);
      }
      return acc;
    }, [] as typeof schedule.receiverRoles);
  };

  useEffect(() => {
    let isMounted = true;
    if (restaurantId === null) {
      setActiveEmployeesByJob([]);
      return () => {
        isMounted = false;
      };
    }
    fetchActiveEmployeesByJobTitle(restaurantId).then((data) => {
      if (isMounted) {
        setActiveEmployeesByJob(data);
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

      <div className="space-y-4">
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
                    setActiveScheduleKey((current) => {
                      const next = isActive ? null : scheduleKey;
                      if (next === null) {
                        setEditingScheduleKey(null);
                      }
                      return next;
                    })
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setActiveScheduleKey((current) => {
                        const next = isActive ? null : scheduleKey;
                        if (next === null) {
                          setEditingScheduleKey(null);
                        }
                        return next;
                      });
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
                    <div className="flex w-32 flex-col items-end gap-2">
                      <button
                        type="button"
                        onClick={async (event) => {
                          event.stopPropagation();
                          if (!restaurantId || !schedule.businessDate) {
                            return;
                          }
                          const payloadItems = buildApprovalItems(schedule);
                          await saveApprovalOverrides({
                            restaurantId,
                            payoutScheduleId: schedule.payoutScheduleId,
                            businessDate: schedule.businessDate,
                            items: payloadItems,
                          });
                          await approvePayoutSchedule({
                            restaurantId,
                            payoutScheduleId: schedule.payoutScheduleId,
                            businessDate: schedule.businessDate,
                          });
                          setApprovedScheduleKeys((current) => {
                            const next = new Set(current);
                            next.add(scheduleKey);
                            return next;
                          });
                        }}
                        className="w-full rounded-lg bg-[#cab99a] px-4 py-2 text-sm font-semibold text-black shadow-md transition hover:bg-[#bfa986] hover:shadow-lg"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setActiveScheduleKey(scheduleKey);
                          setEditingScheduleKey(scheduleKey);
                          const expandedMap = schedule.contributors.reduce(
                            (acc, contributor) => {
                              const employeeKey = `${scheduleKey}-${contributor.employeeGuid}-${contributor.jobTitle ?? "role"}`;
                              acc[employeeKey] = true;
                              return acc;
                            },
                            {} as Record<string, boolean>,
                          );
                          setExpandedEmployees((current) => ({
                            ...current,
                            ...expandedMap,
                          }));
                          const missingRoles = getMissingRoles(schedule);
                          if (missingRoles.length > 0) {
                            const now = Date.now();
                            setAddMemberSlots((current) => {
                              const next = { ...current };
                              missingRoles.forEach((role, index) => {
                                const roleKey = `${scheduleKey}-role-${role.receiverId ?? "role"}`;
                                if (!next[roleKey] || next[roleKey].length === 0) {
                                  next[roleKey] = [`slot-${now}-${index}`];
                                }
                              });
                              return next;
                            });
                          }
                        }}
                        disabled={approvedScheduleKeys.has(scheduleKey)}
                        className={`w-full rounded-lg px-4 py-2 text-sm font-semibold shadow-md transition ${
                          approvedScheduleKeys.has(scheduleKey)
                            ? "cursor-not-allowed bg-gray-200 text-gray-400"
                            : "bg-[#cab99a] text-black hover:bg-[#bfa986] hover:shadow-lg"
                        }`}
                      >
                        Edit
                      </button>
                    </div>
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
                        const eligibleContributors = contributors.filter((contributor) => {
                          const tipTotal =
                            Number(contributor.totalTips || 0) + Number(contributor.totalGratuity || 0);
                          return tipTotal > 0;
                        });
                        const receivers = schedule.contributors.filter(
                          (contributor) => contributor.isContributor === "No",
                        );
                        const totalReceiverTips = receivers.reduce(
                          (total, receiver) => total + receiver.payoutTips,
                          0,
                        );
                        const totalReceiverGratuity = receivers.reduce(
                          (total, receiver) => total + receiver.payoutGratuity,
                          0,
                        );
                        const totalReceiverPayout = totalReceiverTips + totalReceiverGratuity;
                        const contributorPayoutShare =
                          eligibleContributors.length > 0
                            ? -(totalReceiverPayout / eligibleContributors.length)
                            : 0;
                        const ordered = [...contributors, ...receivers];
                        const missingRoles = getMissingRoles(schedule);
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
                                      const tipTotal =
                                        Number(contributor.totalTips || 0) + Number(contributor.totalGratuity || 0);
                                      const isEligible = tipTotal > 0;
                                      const contributorTipsShare =
                                        eligibleContributors.length > 0
                                          ? -(totalReceiverTips / eligibleContributors.length)
                                          : 0;
                                      const contributorGratuityShare =
                                        eligibleContributors.length > 0
                                          ? -(totalReceiverGratuity / eligibleContributors.length)
                                          : 0;
                                      const effectivePayoutShare = isEligible ? contributorPayoutShare : 0;
                                      const payoutTipsDisplay = isEligible ? contributorTipsShare : 0;
                                      const payoutGratuityDisplay = isEligible ? contributorGratuityShare : 0;
                                      const payoutDisplay = Math.abs(effectivePayoutShare);
                                      const netPayoutDisplay = Math.max(
                                        0,
                                        getNetPayout(
                                          contributor.isContributor,
                                          contributor.totalTips,
                                          contributor.totalGratuity,
                                          effectivePayoutShare,
                                        ),
                                      );
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
                                    <div className="grid min-w-[1280px] items-start gap-2 md:grid-cols-[280px_180px_180px_160px_180px_220px_180px_180px]">
                                      <h3 className="text-base font-semibold text-gray-900 md:pr-2">
                                        <span>
                                          {contributor.employeeName}
                                          {contributor.jobTitle ? ` (${contributor.jobTitle})` : ""}
                                        </span>
                                      </h3>
                                    <div className="flex flex-col gap-2 self-start">
                                      <span className="whitespace-nowrap rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700">
                                        Total Sales: {formatCurrency(contributor.totalSales)}
                                      </span>
                                      <span className="whitespace-nowrap rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700">
                                        Net Sales: {formatCurrency(contributor.netSales)}
                                      </span>
                                    </div>
                                    <div className="flex flex-col gap-2">
                                      <span className="whitespace-nowrap rounded-full bg-amber-50 px-3 py-1 text-sm text-amber-700">
                                        Tips: {formatCurrency(contributor.totalTips)}
                                      </span>
                                      <span className="whitespace-nowrap rounded-full bg-sky-50 px-3 py-1 text-sm text-sky-700">
                                        Gratuity: {formatCurrency(contributor.totalGratuity)}
                                      </span>
                                    </div>
                                    <div className="mt-1 text-center">
                                      <p className="text-sm font-normal text-gray-700">Total Tips &amp; Gratuity</p>
                                      <p className="mt-2 text-sm font-semibold text-gray-900">
                                        {formatCurrency(contributor.totalTips + contributor.totalGratuity)}
                                      </p>
                                    </div>
                                    <div className="ml-auto flex justify-end">
                                      <span className="min-w-[220px] whitespace-nowrap rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700">
                                        Payout: {contributor.payoutPercentage.toFixed(2)}% (
                                        <span className="font-semibold text-red-600">
                                          {formatPayoutAmount(payoutDisplay)}
                                        </span>
                                        )
                                      </span>
                                    </div>
                                    <div className="ml-4 flex justify-start">
                                      <span className="whitespace-nowrap rounded-full bg-emerald-50 pl-3 pr-2 py-1 text-sm font-semibold text-emerald-700">
                                        Net Payout: {formatCurrency(netPayoutDisplay)}
                                      </span>
                                    </div>
                                    <div />
                                  </div>
                                  </div>
                                  <p className="-mt-6 text-xs text-gray-500">{contributor.employeeGuid}</p>
                                </div>
                                <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600" />
                              </div>

                              {isExpanded ? (
                                <>
                                  <div className="mt-4 grid grid-cols-[220px_220px_140px_180px_180px_1fr] gap-4">
                                    <div>
                                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">In time</p>
                                      <p className="mt-2 text-sm font-semibold text-gray-900">
                                        {formatValue(contributor.inTime)}
                                      </p>
                                    </div>
                                    <div className="col-start-2">
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
                                    <div>
                                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Total sales</p>
                                      <p className="mt-2 text-sm font-semibold text-gray-900">
                                        {formatCurrency(contributor.totalSales)}
                                      </p>
                                    </div>
                                    <div>
                                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Net sales</p>
                                      <p className="mt-2 text-sm font-semibold text-gray-900">
                                        {formatCurrency(contributor.netSales)}
                                      </p>
                                    </div>
                                    <div />
                                  </div>

                                  <div className="mt-5">
                                    <h4 className="text-sm font-semibold text-gray-900">Payout details</h4>
                                    <div className="mt-3 grid items-start gap-2 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(160px,auto)_minmax(160px,auto)]">
                                      <div>
                                        <p className="text-xs font-semibold uppercase text-gray-500">Overall</p>
                                        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-700">
                                          <span className="font-semibold text-gray-600">Tips:</span>
                                          <span>{formatCurrency(contributor.overallTips)}</span>
                                          <span className="text-gray-400">|</span>
                                          <span className="font-semibold text-gray-600">Gratuity:</span>
                                          <span>{formatCurrency(contributor.overallGratuity)}</span>
                                        </p>
                                      </div>
                                      <div>
                                        <p className="text-xs font-semibold uppercase text-gray-500">Payout</p>
                                        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-700">
                                          <span className="font-semibold text-gray-600">Tips:</span>
                                          <span className="font-semibold text-red-600">
                                            {formatCurrency(Math.abs(payoutTipsDisplay))}
                                          </span>
                                          <span className="text-gray-400">|</span>
                                          <span className="font-semibold text-gray-600">Gratuity:</span>
                                          <span className="font-semibold text-red-600">
                                            {formatCurrency(Math.abs(payoutGratuityDisplay))}
                                          </span>
                                        </p>
                                      </div>
                                      <label className="-ml-[36px] text-xs font-semibold uppercase tracking-wide text-gray-500">
                                        Payout percentage
                                        <input
                                          readOnly
                                          value={`${contributor.payoutPercentage.toFixed(2)}%`}
                                          className="mt-2 w-[140px] rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700"
                                        />
                                      </label>
                                      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                        Net payout
                                        <div className="mt-2 text-sm font-semibold text-gray-900">
                                          {formatCurrency(
                                            Math.max(
                                              0,
                                              getNetPayout(
                                                contributor.isContributor,
                                                contributor.totalTips,
                                                contributor.totalGratuity,
                                                effectivePayoutShare,
                                              ),
                                            ),
                                          )}
                                        </div>
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
                                        const payoutAmount = contributor.payoutTips + contributor.payoutGratuity;
                                        const payoutDisplay = Math.max(0, payoutAmount);
                                        const netPayoutDisplay = Math.max(
                                          0,
                                          getNetPayout(
                                            contributor.isContributor,
                                            contributor.totalTips,
                                            contributor.totalGratuity,
                                            payoutAmount,
                                          ),
                                        );
                                        const payoutTipsDisplay = contributor.payoutTips;
                                        const payoutGratuityDisplay = contributor.payoutGratuity;
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
                                                <div className="grid min-w-[1280px] items-start gap-2 md:grid-cols-[280px_180px_180px_160px_180px_220px_180px_180px]">
                                                <h3 className="text-base font-semibold text-gray-900 md:pr-2">
                                                  <span>
                                                    {contributor.employeeName}
                                                    {contributor.jobTitle ? ` (${contributor.jobTitle})` : ""}
                                                  </span>
                                                </h3>
                                                <div className="flex flex-col gap-2 self-start">
                                                  <span className="whitespace-nowrap rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700">
                                                    Total Sales: {formatCurrency(contributor.totalSales)}
                                                  </span>
                                                  <span className="whitespace-nowrap rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700">
                                                    Net Sales: {formatCurrency(contributor.netSales)}
                                                  </span>
                                                </div>
                                                <div className="flex flex-col gap-2">
                                                  <span className="whitespace-nowrap rounded-full bg-amber-50 px-3 py-1 text-sm text-amber-700">
                                                    Tips: {formatCurrency(contributor.totalTips)}
                                                  </span>
                                                  <span className="whitespace-nowrap rounded-full bg-sky-50 px-3 py-1 text-sm text-sky-700">
                                                    Gratuity: {formatCurrency(contributor.totalGratuity)}
                                                  </span>
                                                </div>
                                                <div className="mt-1 text-center">
                                                  <p className="text-sm font-normal text-gray-700">Total Tips &amp; Gratuity</p>
                                                  <p className="mt-2 text-sm font-semibold text-gray-900">
                                                    {formatCurrency(contributor.totalTips + contributor.totalGratuity)}
                                                  </p>
                                                </div>
                                                <div className="ml-auto flex justify-end">
                                                  <span className="min-w-[220px] whitespace-nowrap rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700">
                                                    Payout: {contributor.payoutPercentage.toFixed(2)}% (
                                                    <span
                                                      className={
                                                        payoutDisplay === 0
                                                          ? "font-semibold text-gray-500"
                                                          : payoutDisplay < 0
                                                          ? "font-semibold text-red-600"
                                                          : "font-semibold text-emerald-700"
                                                      }
                                                    >
                                                      {formatPayoutAmount(payoutDisplay)}
                                                    </span>
                                                    )
                                                  </span>
                                                </div>
                                                <div className="ml-4 flex justify-start">
                                                  <span className="whitespace-nowrap rounded-full bg-emerald-50 pl-3 pr-2 py-1 text-sm font-semibold text-emerald-700">
                                                    Net Payout: {formatCurrency(netPayoutDisplay)}
                                                  </span>
                                                </div>
                                                <div />
                                              </div>
                                              </div>
                                                <p className="-mt-6 text-xs text-gray-500">{contributor.employeeGuid}</p>
                                              </div>
                                              <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600" />
                                            </div>

                                            {isExpanded ? (
                                              <>
                                                <div className="mt-4 grid grid-cols-[220px_220px_140px_180px_180px_1fr] gap-4">
                                                  <div>
                                                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">In time</p>
                                                    <p className="mt-2 text-sm font-semibold text-gray-900">
                                                      {formatValue(contributor.inTime)}
                                                    </p>
                                                  </div>
                                                  <div className="col-start-2">
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
                                                  <div>
                                                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Total sales</p>
                                                    <p className="mt-2 text-sm font-semibold text-gray-900">
                                                      {formatCurrency(contributor.totalSales)}
                                                    </p>
                                                  </div>
                                                  <div>
                                                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Net sales</p>
                                                    <p className="mt-2 text-sm font-semibold text-gray-900">
                                                      {formatCurrency(contributor.netSales)}
                                                    </p>
                                                  </div>
                                                  <div />
                                                </div>

                                                <div className="mt-5">
                                                  <h4 className="text-sm font-semibold text-gray-900">Payout details</h4>
                                                  <div className="mt-3 grid items-start gap-2 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(160px,auto)_minmax(160px,auto)]">
                                                    <div>
                                                      <p className="text-xs font-semibold uppercase text-gray-500">Overall</p>
                                                      <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-700">
                                                        <span className="font-semibold text-gray-600">Tips:</span>
                                                        <span>{formatCurrency(contributor.overallTips)}</span>
                                                        <span className="text-gray-400">|</span>
                                                        <span className="font-semibold text-gray-600">Gratuity:</span>
                                                        <span>{formatCurrency(contributor.overallGratuity)}</span>
                                                      </p>
                                                    </div>
                                                    <div>
                                                      <p className="text-xs font-semibold uppercase text-gray-500">Payout</p>
                                                      <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-700">
                                                        <span className="font-semibold text-gray-600">Tips:</span>
                                                        <span>{formatCurrency(payoutTipsDisplay)}</span>
                                                        <span className="text-gray-400">|</span>
                                                        <span className="font-semibold text-gray-600">Gratuity:</span>
                                                        <span>{formatCurrency(payoutGratuityDisplay)}</span>
                                                      </p>
                                                    </div>
                                                    <label className="-ml-[36px] text-xs font-semibold uppercase tracking-wide text-gray-500">
                                                      Payout percentage
                                                      <input
                                                        key={`${scheduleKey}-${contributor.employeeGuid}-${contributor.jobTitle ?? "role"}-${resetToken}`}
                                                        value={
                                                          payoutEdits[
                                                            `${scheduleKey}-${contributor.employeeGuid}-${contributor.jobTitle ?? "role"}`
                                                          ] ?? `${contributor.payoutPercentage.toFixed(2)}%`
                                                        }
                                                        readOnly={editingScheduleKey !== scheduleKey}
                                                        onChange={(event) => {
                                                          const key = `${scheduleKey}-${contributor.employeeGuid}-${contributor.jobTitle ?? "role"}`;
                                                          setPayoutEdits((current) => ({
                                                            ...current,
                                                            [key]: event.target.value,
                                                          }));
                                                        }}
                                                        className="mt-2 w-[140px] rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700"
                                                      />
                                                    </label>
                                                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                                      Net payout
                                                      <div className="mt-2 text-sm font-semibold text-gray-900">
                                                        {formatCurrency(netPayoutDisplay)}
                                                      </div>
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
                                          {(() => {
                                            const roleKey = `${scheduleKey}-role-${role.receiverId ?? "role"}`;
                                            const roleTitle = role.receiverId ?? "";
                                            const employeesForRole = activeEmployeesByJob.reduce(
                                              (acc, employee) => {
                                                if (employee.jobTitle !== roleTitle) {
                                                  return acc;
                                                }
                                                if (!employee.employeeGuid) {
                                                  return acc;
                                                }
                                                const employeeName = [employee.firstName, employee.lastName]
                                                  .filter(Boolean)
                                                  .join(" ")
                                                  .trim();
                                                const displayName = employeeName || employee.employeeGuid;
                                                const key = `${employee.employeeGuid}-${displayName}`;
                                                if (!acc.seen.has(key)) {
                                                  acc.seen.add(key);
                                                  acc.items.push({
                                                    id: employee.employeeGuid,
                                                    name: displayName,
                                                  });
                                                }
                                                return acc;
                                              },
                                              { items: [] as { id: string; name: string }[], seen: new Set<string>() },
                                            );
                                            const roleSlots = addMemberSlots[roleKey] ?? [];
                                            const hasSelection = Boolean(
                                              addMemberSelections[roleKey] &&
                                                Object.values(addMemberSelections[roleKey]).some(Boolean),
                                            );
                                            return (
                                              <>
                                                <div className="grid items-center gap-2 grid-cols-[minmax(0,1fr)_minmax(220px,1fr)_minmax(160px,auto)_minmax(160px,auto)]">
                                                  <div className="font-semibold text-gray-900">
                                                    {role.receiverId}
                                                  </div>
                                                  <div />
                                                  <div />
                                                  <div />
                                                </div>
                                                {editingScheduleKey === scheduleKey
                                                  ? (roleSlots.length ? roleSlots : ["slot-0"]).map((slotId, slotIndex) => (
                                                      <div
                                                        key={`${roleKey}-${slotId}`}
                                                        className="mt-3 grid items-center gap-2 grid-cols-[minmax(0,1fr)_minmax(220px,1fr)_minmax(160px,auto)_minmax(160px,auto)]"
                                                      >
                                                        <div />
                                                        <label className="-ml-[72px] text-xs font-semibold uppercase tracking-wide text-gray-500">
                                                          Add Team Member
                                                          <div className="relative mt-2" data-add-member-dropdown="true">
                                                            <button
                                                              type="button"
                                                              onClick={() =>
                                                                setAddMemberDropdowns((current) => ({
                                                                  ...current,
                                                                  [roleKey]: {
                                                                    ...current[roleKey],
                                                                    [slotId]: !current[roleKey]?.[slotId],
                                                                  },
                                                                }))
                                                              }
                                                              className="flex w-[220px] items-center justify-between gap-3 rounded-lg border border-gray-300 bg-white px-4 py-3 text-left text-sm font-normal text-gray-700 outline-none focus:ring-2 focus:ring-gray-900"
                                                            >
                                                              <span
                                                                className={
                                                                  addMemberSelections[roleKey]?.[slotId]?.name
                                                                    ? "text-gray-900"
                                                                    : "text-gray-400"
                                                                }
                                                              >
                                                                {addMemberSelections[roleKey]?.[slotId]?.name ??
                                                                  "Select Team Member"}
                                                              </span>
                                                              <span className="ml-2 text-gray-500">▾</span>
                                                            </button>
                                                            {addMemberDropdowns[roleKey]?.[slotId] ? (
                                                              <div className="absolute z-10 mt-2 w-[220px] max-h-60 overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                                                                {employeesForRole.items.map((employee) => (
                                                                  <button
                                                                    key={employee.id}
                                                                    type="button"
                                                                    onClick={() => {
                                                                      setAddMemberSelections((current) => ({
                                                                        ...current,
                                                                        [roleKey]: {
                                                                          ...current[roleKey],
                                                                          [slotId]: employee,
                                                                        },
                                                                      }));
                                                                      setAddMemberDropdowns({});
                                                                    }}
                                                                    className="w-full px-4 py-2 text-left text-sm text-gray-900 hover:bg-gray-50"
                                                                  >
                                                                    {employee.name}
                                                                  </button>
                                                                ))}
                                                              </div>
                                                            ) : null}
                                                          </div>
                                                        </label>
                                                        <label className="-ml-[36px] text-xs font-semibold uppercase tracking-wide text-gray-500">
                                                          Payout percentage
                                                          <input
                                                            key={`${roleKey}-${slotId}-${resetToken}`}
                                                            value={
                                                              payoutEdits[`${roleKey}-${slotId}`] ??
                                                              `${role.payoutPercentage.toFixed(2)}%`
                                                            }
                                                            readOnly={editingScheduleKey !== scheduleKey}
                                                            onChange={(event) => {
                                                              setPayoutEdits((current) => ({
                                                                ...current,
                                                                [`${roleKey}-${slotId}`]: event.target.value,
                                                              }));
                                                            }}
                                                            className="mt-2 w-[140px] rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700"
                                                          />
                                                        </label>
                                                        <div />
                                                      </div>
                                                    ))
                                                  : null}
                                                {editingScheduleKey === scheduleKey && hasSelection ? (
                                                  <div className="mt-3">
                                                    {(() => {
                                                      const existing = addMemberSlots[roleKey] ?? ["slot-0"];
                                                      const isAtLimit = existing.length >= 5;
                                                      return (
                                                    <button
                                                      type="button"
                                                      onClick={() => {
                                                        setAddMemberSlots((current) => {
                                                          const existing = current[roleKey] ?? ["slot-0"];
                                                          if (existing.length >= 5) {
                                                            return current;
                                                          }
                                                          return {
                                                            ...current,
                                                            [roleKey]: [...existing, `slot-${Date.now()}`],
                                                          };
                                                        });
                                                      }}
                                                      disabled={isAtLimit}
                                                      className={`rounded-lg border px-4 py-2 text-xs font-semibold uppercase tracking-wide shadow-sm transition ${
                                                        isAtLimit
                                                          ? "cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400"
                                                          : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                                                      }`}
                                                    >
                                                      Add More
                                                    </button>
                                                      );
                                                    })()}
                                                  </div>
                                                ) : null}
                                              </>
                                            );
                                          })()}
                                          <p className="mt-2 text-xs text-gray-500">No employee assigned for this job title.</p>
                                        </div>
                                      ))}
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                            {editingScheduleKey === scheduleKey ? (
                              <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
                                <button
                                  type="button"
                                  onClick={async (event) => {
                                    event.stopPropagation();
                                    if (restaurantId === null) {
                                      return;
                                    }
                                    setSchedules((current) =>
                                      current.map((scheduleItem) => {
                                        const itemKey = `${scheduleItem.payoutScheduleId}-${scheduleItem.businessDate}`;
                                        if (itemKey !== scheduleKey) {
                                          return scheduleItem;
                                        }
                                        const { overallTips, overallGratuity } = getOverallBase(scheduleItem);
                                        const updatedContributors = scheduleItem.contributors.map((contributor) => {
                                          if (contributor.isContributor !== "No") {
                                            return contributor;
                                          }
                                          const payoutKey = `${scheduleKey}-${contributor.employeeGuid}-${contributor.jobTitle ?? "role"}`;
                                          const editedValue = payoutEdits[payoutKey];
                                          const parsed = editedValue ? parsePercentage(editedValue) : null;
                                          if (parsed === null) {
                                            return contributor;
                                          }
                                          const payoutTips = roundCurrency((parsed / 100) * overallTips);
                                          const payoutGratuity = roundCurrency((parsed / 100) * overallGratuity);
                                          return {
                                            ...contributor,
                                            payoutPercentage: parsed,
                                            payoutTips,
                                            payoutGratuity,
                                            overallTips,
                                            overallGratuity,
                                          };
                                        });
                                        const existingKeys = new Set(
                                          updatedContributors.map(
                                            (contributor) =>
                                              `${contributor.employeeGuid}-${contributor.jobTitle ?? ""}-${contributor.isContributor}`,
                                          ),
                                        );
                                        const newEntries = scheduleItem.receiverRoles.reduce(
                                          (acc, role) => {
                                            const roleKey = `${scheduleKey}-role-${role.receiverId ?? "role"}`;
                                            const selections = addMemberSelections[roleKey];
                                            if (!selections) {
                                              return acc;
                                            }
                                            Object.entries(selections).forEach(([slotId, selection]) => {
                                              if (!selection) {
                                                return;
                                              }
                                              const entryKey = `${selection.id}-${role.receiverId ?? ""}-No`;
                                              if (existingKeys.has(entryKey)) {
                                                return;
                                              }
                                              const editedValue = payoutEdits[`${roleKey}-${slotId}`];
                                              const parsed = editedValue ? parsePercentage(editedValue) : null;
                                              const payoutPercentage =
                                                parsed ?? role.payoutPercentage ?? 0;
                                              const payoutTips = roundCurrency(
                                                (payoutPercentage / 100) * overallTips,
                                              );
                                              const payoutGratuity = roundCurrency(
                                                (payoutPercentage / 100) * overallGratuity,
                                              );
                                              acc.push({
                                                employeeGuid: selection.id,
                                                employeeName: selection.name,
                                                jobTitle: role.receiverId ?? null,
                                                businessDate: scheduleItem.businessDate,
                                                inTime: null,
                                                outTime: null,
                                                hoursWorked: 0,
                                                isContributor: "No",
                                                payoutReceiverId: role.receiverId ?? null,
                                                payoutPercentage,
                                                totalSales: 0,
                                                netSales: 0,
                                                totalTips: 0,
                                                totalGratuity: 0,
                                                overallTips,
                                                overallGratuity,
                                                payoutTips,
                                                payoutGratuity,
                                              });
                                            });
                                            return acc;
                                          },
                                          [] as ApprovalScheduleWithContributors["contributors"],
                                        );
                                        const updatedRoles = scheduleItem.receiverRoles.map((role) => {
                                          const roleKey = `${scheduleKey}-role-${role.receiverId ?? "role"}`;
                                          const editedValue = payoutEdits[roleKey];
                                          const parsed = editedValue ? parsePercentage(editedValue) : null;
                                          if (parsed === null) {
                                            return role;
                                          }
                                          return {
                                            ...role,
                                            payoutPercentage: parsed,
                                          };
                                        });
                                        const updatedSchedule = {
                                          ...scheduleItem,
                                          contributors: [...updatedContributors, ...newEntries],
                                          receiverRoles: updatedRoles,
                                        };
                                        const payloadItems = buildApprovalItems(updatedSchedule);
                                        if (updatedSchedule.businessDate) {
                                          saveApprovalOverrides({
                                            restaurantId,
                                            payoutScheduleId: updatedSchedule.payoutScheduleId,
                                            businessDate: updatedSchedule.businessDate,
                                            items: payloadItems,
                                          });
                                        }
                                        return updatedSchedule;
                                      }),
                                    );
                                    setEditingScheduleKey(null);
                                    setResetToken((current) => current + 1);
                                    setPayoutEdits({});
                                    setAddMemberSelections({});
                                    setAddMemberDropdowns({});
                                    setAddMemberSlots({});
                                  }}
                                  className="rounded-lg bg-[#cab99a] px-4 py-2 text-sm font-semibold text-black shadow-md transition hover:bg-[#bfa986] hover:shadow-lg"
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setEditingScheduleKey(null);
                                    setActiveScheduleKey(null);
                                    setExpandedEmployees({});
                                    setResetToken((current) => current + 1);
                                    setPayoutEdits({});
                                    setAddMemberSelections({});
                                    setAddMemberDropdowns({});
                                    setAddMemberSlots({});
                                  }}
                                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : null}
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
