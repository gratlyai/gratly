import { useEffect, useMemo, useRef, useState } from "react";
import {
  approvePayoutSchedule,
  fetchApprovals,
  saveApprovalOverrides,
  type ApprovalContributor,
  type ApprovalsResponse,
  type ApprovalScheduleWithContributors,
} from "../api/approvals";
import { fetchActiveEmployeesByJobTitle, type EmployeeWithJob } from "../api/employees";
import { fetchJobTitles } from "../api/jobs";

type CustomReceiverEntry = {
  id: string;
  employeeGuid: string | null;
  employeeName: string;
  jobTitle: string;
  payoutPercentage: string;
};

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

const getBusinessDayLabel = (value: string | null) => {
  if (!value) {
    return "";
  }
  const digits = value.replace(/\D/g, "");
  const formatDay = (date: Date) =>
    Number.isNaN(date.getTime())
      ? ""
      : new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(date);
  if (digits.length === 8) {
    const year = Number(digits.slice(0, 4));
    const month = Number(digits.slice(4, 6)) - 1;
    const day = Number(digits.slice(6, 8));
    return formatDay(new Date(year, month, day));
  }
  return formatDay(new Date(value));
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
  const [userId, setUserId] = useState<number | null>(null);
  const [schedules, setSchedules] = useState<ApprovalScheduleWithContributors[]>([]);
  const [expandedScheduleKeys, setExpandedScheduleKeys] = useState<Set<string>>(new Set());
  const scheduleRefs = useRef<Record<string, HTMLElement | null>>({});
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
  const [jobTitles, setJobTitles] = useState<string[]>([]);
  const [customReceivers, setCustomReceivers] = useState<Record<string, CustomReceiverEntry[]>>({});
  const [customReceiverDropdowns, setCustomReceiverDropdowns] = useState<Record<string, boolean>>({});

  const applyApprovals = (data: ApprovalsResponse) => {
    const sortedSchedules = sortSchedulesByDate(data.schedules);
    setSchedules(sortedSchedules);
    setExpandedScheduleKeys(new Set());
    setEditingScheduleKey(null);
    setApprovedScheduleKeys(
      new Set(
        sortedSchedules
          .filter((item) => item.isApproved)
          .map((item) => `${item.payoutScheduleId}-${item.businessDate}`),
      ),
    );
  };

  const refreshApprovals = async (currentRestaurantId: number, showLoading = true) => {
    if (showLoading) {
      setIsLoading(true);
    }
    try {
      const data = await fetchApprovals(currentRestaurantId);
      applyApprovals(data);
    } finally {
      if (showLoading) {
        setIsLoading(false);
      }
    }
  };

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
    const storedUserId = localStorage.getItem("userId");
    if (storedUserId) {
      const parsedId = Number(storedUserId);
      if (Number.isFinite(parsedId)) {
        setUserId(parsedId);
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
          applyApprovals(data);
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
      if (
        target &&
        (target.closest('[data-add-member-dropdown="true"]') ||
          target.closest('[data-custom-receiver-dropdown="true"]'))
      ) {
        return;
      }
      setAddMemberDropdowns({});
      setCustomReceiverDropdowns({});
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

  const isManualReceiver = (receiver: ApprovalContributor) =>
    (receiver.isContributor || "").toLowerCase() === "no" &&
    Number(receiver.payoutPercentage || 0) > 0 &&
    Number(receiver.totalTips || 0) === 0 &&
    Number(receiver.totalGratuity || 0) === 0 &&
    receiver.inTime === null &&
    receiver.outTime === null;

  const addCustomReceiver = (scheduleKey: string) => {
    setCustomReceivers((current) => {
      const existing = current[scheduleKey] ?? [];
      return {
        ...current,
        [scheduleKey]: [
          ...existing,
          {
            id: `custom-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            employeeGuid: null,
            employeeName: "",
            jobTitle: "",
            payoutPercentage: "",
          },
        ],
      };
    });
  };

  const updateCustomReceiver = (
    scheduleKey: string,
    entryId: string,
    updates: Partial<CustomReceiverEntry>,
  ) => {
    setCustomReceivers((current) => ({
      ...current,
      [scheduleKey]: (current[scheduleKey] ?? []).map((entry) =>
        entry.id === entryId ? { ...entry, ...updates } : entry,
      ),
    }));
  };

  const removeCustomReceiver = (scheduleKey: string, entryId: string) => {
    setCustomReceivers((current) => ({
      ...current,
      [scheduleKey]: (current[scheduleKey] ?? []).filter((entry) => entry.id !== entryId),
    }));
  };

  const getOverallBase = (schedule: ApprovalScheduleWithContributors) => {
    const match = schedule.contributors.find(
      (contributor) => contributor.overallTips || contributor.overallGratuity,
    );
    return {
      overallTips: match?.overallTips ?? schedule.totalTips,
      overallGratuity: match?.overallGratuity ?? schedule.totalGratuity,
    };
  };

  const normalizeRoleKey = (value: string | null | undefined) =>
    (value || "").trim().toLowerCase();

  const buildApprovalItems = (schedule: ApprovalScheduleWithContributors) => {
    const receivers = schedule.contributors.filter(
      (contributor) => (contributor.isContributor || "").toLowerCase() === "no",
    );
    const receiverRolePercentages = schedule.receiverRoles.reduce((acc, role) => {
      const roleKey = normalizeRoleKey(role.receiverId);
      acc[roleKey] = Number(role.payoutPercentage || 0);
      return acc;
    }, {} as Record<string, number>);
    const receiverRoleCounts = receivers.reduce((acc, receiver) => {
      if (isManualReceiver(receiver)) {
        return acc;
      }
      const roleKey = normalizeRoleKey(receiver.jobTitle ?? receiver.payoutReceiverId);
      acc[roleKey] = (acc[roleKey] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const totalReceiverPercentage = getReceiverPercentSum(schedule);
    const { overallTips, overallGratuity } = getOverallBase(schedule);

    return schedule.contributors.map((item) => {
      const isContributor = (item.isContributor || "").toLowerCase() === "yes";
      const receiverRoleKey = normalizeRoleKey(item.jobTitle ?? item.payoutReceiverId);
      const receiverRoleCount = receiverRoleCounts[receiverRoleKey] ?? 0;
      const rolePercentageTotal = receiverRolePercentages[receiverRoleKey] ?? 0;
      const receiverSharePercentage =
        !isContributor && receiverRoleCount > 0
          ? rolePercentageTotal / receiverRoleCount
          : 0;
      const receiverPayoutPercentage = isManualReceiver(item)
        ? Number(item.payoutPercentage || 0)
        : receiverSharePercentage;
      const tipTotal = Number(item.totalTips || 0) + Number(item.totalGratuity || 0);
      const payoutTips =
        isContributor && tipTotal > 0
          ? roundCurrency(-(totalReceiverPercentage / 100) * Number(item.totalTips || 0))
          : roundCurrency((receiverPayoutPercentage / 100) * overallTips);
      const payoutGratuity =
        isContributor && tipTotal > 0
          ? roundCurrency(-(totalReceiverPercentage / 100) * Number(item.totalGratuity || 0))
          : roundCurrency((receiverPayoutPercentage / 100) * overallGratuity);
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
        payoutPercentage: isContributor ? item.payoutPercentage : receiverPayoutPercentage,
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

  const getReceiverPercentSum = (schedule: ApprovalScheduleWithContributors) => {
    const receivers = schedule.contributors.filter(
      (contributor) => (contributor.isContributor || "").toLowerCase() === "no",
    );
    const receiverRolePercentages = schedule.receiverRoles.reduce((acc, role) => {
      const roleKey = normalizeRoleKey(role.receiverId);
      acc[roleKey] = Number(role.payoutPercentage || 0);
      return acc;
    }, {} as Record<string, number>);
    const receiverRoleCounts = receivers.reduce((acc, receiver) => {
      if (isManualReceiver(receiver)) {
        return acc;
      }
      const roleKey = normalizeRoleKey(receiver.jobTitle ?? receiver.payoutReceiverId);
      acc[roleKey] = (acc[roleKey] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const { overallTips, overallGratuity } = getOverallBase(schedule);
    return receivers.reduce((total, receiver) => {
      const hasHoursWorked = isManualReceiver(receiver) || (receiver.hoursWorked ?? 0) > 0;
      if (!hasHoursWorked) {
        return total;
      }
      const roleKey = normalizeRoleKey(receiver.jobTitle ?? receiver.payoutReceiverId);
      const roleTotal = receiverRolePercentages[roleKey] ?? 0;
      const roleCount = receiverRoleCounts[roleKey] ?? 0;
      const share = roleCount > 0 ? roleTotal / roleCount : 0;
      const receiverPercentage = isManualReceiver(receiver)
        ? Number(receiver.payoutPercentage || 0)
        : share;
      const payoutAmount =
        (receiverPercentage / 100) * (Number(overallTips || 0) + Number(overallGratuity || 0));
      if (payoutAmount <= 0) {
        return total;
      }
      return total + receiverPercentage;
    }, 0);
  };

  const activeEmployeeOptions = useMemo(() => {
    const seen = new Set<string>();
    return activeEmployeesByJob.reduce((acc, employee) => {
      if (!employee.employeeGuid) {
        return acc;
      }
      const displayName = [employee.firstName, employee.lastName]
        .filter(Boolean)
        .join(" ")
        .trim();
      if (!displayName) {
        return acc;
      }
      const key = `${employee.employeeGuid}-${displayName}`;
      if (seen.has(key)) {
        return acc;
      }
      seen.add(key);
      acc.push({
        id: employee.employeeGuid,
        name: displayName,
        jobTitle: employee.jobTitle ?? "",
      });
      return acc;
    }, [] as { id: string; name: string; jobTitle: string }[]);
  }, [activeEmployeesByJob]);

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

  useEffect(() => {
    let isMounted = true;
    if (userId === null) {
      setJobTitles([]);
      return () => {
        isMounted = false;
      };
    }
    fetchJobTitles(userId).then((data) => {
      if (isMounted) {
        setJobTitles(data);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [userId]);

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
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Approvals</h1>
          <p className="text-sm text-gray-500">
            Read-only payout summaries by contributor. {contributorCountLabel}
          </p>
        </div>
        <label className="mt-1 inline-flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={false}
            onChange={() => {
              setExpandedScheduleKeys((current) => {
                const allExpanded = schedules.length > 0 && current.size === schedules.length;
                if (allExpanded) {
                  return new Set();
                }
                return new Set(
                  schedules.map(
                    (schedule) => `${schedule.payoutScheduleId}-${schedule.businessDate}`,
                  ),
                );
              });
            }}
            className="h-4 w-4 rounded border-gray-300 text-gray-900"
          />
          {expandedScheduleKeys.size === schedules.length && schedules.length > 0
            ? "Collapse All"
            : "Expand All"}
        </label>
      </div>

      <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
        <div className="flex items-start gap-3">
          <svg className="h-5 w-5 text-blue-600 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-blue-900">Payout Processing</h3>
            <p className="mt-1 text-sm text-blue-700">
              Approved payouts are queued for processing. Restaurant debits and employee payouts run automatically during nightly batch jobs.
            </p>
          </div>
        </div>
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
            const isActive = expandedScheduleKeys.has(scheduleKey);
            return (
              <section
                key={scheduleKey}
                ref={(element) => {
                  scheduleRefs.current[scheduleKey] = element;
                }}
                className="rounded-xl border border-gray-200 bg-white p-6 shadow-lg"
              >
                <div
                  className="grid w-full cursor-pointer items-center gap-3 text-left sm:grid-cols-[1fr_auto_1fr]"
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setExpandedScheduleKeys((current) => {
                      const next = new Set(current);
                      if (next.has(scheduleKey)) {
                        next.delete(scheduleKey);
                      } else {
                        next.add(scheduleKey);
                      }
                      return next;
                    });
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setExpandedScheduleKeys((current) => {
                        const next = new Set(current);
                        if (next.has(scheduleKey)) {
                          next.delete(scheduleKey);
                        } else {
                          next.add(scheduleKey);
                        }
                        return next;
                      });
                    }
                  }}
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">
                        {schedule.name ?? "Payout Schedule"}
                        {schedule.businessDate ? (
                          <span className="ml-2 font-semibold text-gray-900">
                            ({schedule.businessDate})
                          </span>
                        ) : null}
                      </h2>
                      {(() => {
                        const dayLabel = getBusinessDayLabel(schedule.businessDate);
                        return dayLabel ? (
                          <p className="mt-1 text-sm text-gray-500">{dayLabel}</p>
                        ) : null;
                      })()}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-2 text-sm text-gray-600">
                    <span className="rounded-full border border-gray-200 bg-white px-3 py-1 text-black">
                      {schedule.payoutRuleLabel}
                    </span>
                    <span className="rounded-full border border-gray-200 bg-white px-3 py-1 text-black">
                      Contributors: {schedule.contributorCount}
                    </span>
                    <span className="rounded-full border border-gray-200 bg-white px-3 py-1 text-black">
                      Receivers: {schedule.receiverCount}
                    </span>
                  </div>
                  <div className="flex justify-end">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={async (event) => {
                          event.stopPropagation();
                          if (!restaurantId || !schedule.businessDate || userId === null) {
                            return;
                          }
                          const payloadItems = buildApprovalItems(schedule);
                          await saveApprovalOverrides({
                            restaurantId,
                            payoutScheduleId: schedule.payoutScheduleId,
                            businessDate: schedule.businessDate,
                            items: payloadItems,
                          });
                          const approvalResponse = await approvePayoutSchedule({
                            restaurantId,
                            payoutScheduleId: schedule.payoutScheduleId,
                            businessDate: schedule.businessDate,
                            userId,
                          });
                          if (approvalResponse?.success) {
                            setSchedules((current) =>
                              current.filter(
                                (item) =>
                                  `${item.payoutScheduleId}-${item.businessDate}` !== scheduleKey,
                              ),
                            );
                            setExpandedScheduleKeys((current) => {
                              const next = new Set(current);
                              next.delete(scheduleKey);
                              return next;
                            });
                            setEditingScheduleKey((current) =>
                              current === scheduleKey ? null : current,
                            );
                            setApprovedScheduleKeys((current) => {
                              const next = new Set(current);
                              next.add(scheduleKey);
                              return next;
                            });
                            await refreshApprovals(restaurantId, false);
                          }
                        }}
                        className="rounded-lg bg-[#cab99a] px-5 py-2.5 text-base font-semibold text-black shadow-md transition hover:bg-[#bfa986] hover:shadow-lg"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setExpandedScheduleKeys((current) => {
                            const next = new Set(current);
                            next.add(scheduleKey);
                            return next;
                          });
                          setEditingScheduleKey(scheduleKey);
                          setCustomReceivers((current) => ({
                            ...current,
                            [scheduleKey]: [],
                          }));
                          setCustomReceiverDropdowns({});
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
                        className={`min-w-[112px] rounded-lg px-5 py-2.5 text-base font-semibold shadow-md transition ${
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
                    <p className="text-xs font-semibold uppercase text-gray-500">Sales</p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-700">
                      <span className="font-semibold text-gray-600">Total:</span>
                      <span>{formatCurrency(schedule.totalSales)}</span>
                      <span className="text-gray-400">|</span>
                      <span className="font-semibold text-gray-600">Net:</span>
                      <span>{formatCurrency(schedule.netSales)}</span>
                    </p>
                  </div>
                  <div className="md:col-start-2 md:col-span-2 md:justify-self-center">
                    <p className="text-xs font-semibold uppercase text-gray-500">Tips &amp; Gratuity</p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-700">
                      <span className="font-semibold text-gray-600">Tips:</span>
                      <span>{formatCurrency(schedule.totalTips)}</span>
                      <span className="text-gray-400">|</span>
                      <span className="font-semibold text-gray-600">Gratuity:</span>
                      <span>{formatCurrency(schedule.totalGratuity)}</span>
                      <span className="text-gray-400">|</span>
                      <span className="font-semibold text-gray-600">Total:</span>
                      <span>{formatCurrency(schedule.totalTips + schedule.totalGratuity)}</span>
                    </p>
                  </div>
                  <div className="md:col-start-4 justify-self-start text-left md:pl-4">
                    <p className="text-xs font-semibold uppercase text-gray-500">Orders</p>
                    <p className="mt-1 text-sm text-gray-700">
                      {(schedule.orderCount ?? 0).toLocaleString()}
                    </p>
                  </div>
                </div>

                {isActive ? (
                  <div className="mt-6 space-y-6 border-t border-gray-100 pt-6">
                    {schedule.contributors.length === 0 ? (
                      <div className="text-sm text-gray-500">No contributors assigned.</div>
                    ) : (
                      (() => {
                        const contributors = schedule.contributors
                          .filter((contributor) => contributor.isContributor === "Yes")
                          .slice()
                          .sort((a, b) => {
                            const firstA = (a.employeeName || "").trim().split(/\s+/)[0] || "";
                            const firstB = (b.employeeName || "").trim().split(/\s+/)[0] || "";
                            return firstA.localeCompare(firstB, undefined, { sensitivity: "base" });
                          });
                        const receivers = schedule.contributors
                          .filter((contributor) => contributor.isContributor === "No")
                          .slice()
                          .sort((a, b) =>
                            (a.jobTitle || "").localeCompare(b.jobTitle || "", undefined, {
                              sensitivity: "base",
                            }),
                          );
                        const receiverRoleCounts = receivers.reduce((acc, receiver) => {
                          if (isManualReceiver(receiver)) {
                            return acc;
                          }
                          const roleKey = normalizeRoleKey(receiver.jobTitle ?? receiver.payoutReceiverId);
                          acc[roleKey] = (acc[roleKey] ?? 0) + 1;
                          return acc;
                        }, {} as Record<string, number>);
                        const receiverRolePercentages = schedule.receiverRoles.reduce((acc, role) => {
                          const roleKey = normalizeRoleKey(role.receiverId);
                          acc[roleKey] = Number(role.payoutPercentage || 0);
                          return acc;
                        }, {} as Record<string, number>);
                        const totalReceiverPercentage = getReceiverPercentSum(schedule);
                        const { overallTips: scheduleOverallTips, overallGratuity: scheduleOverallGratuity } =
                          getOverallBase(schedule);
                        const missingRoles = getMissingRoles(schedule);
                        const customEntries = customReceivers[scheduleKey] ?? [];
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
                                      const payoutTipsDisplay = isEligible
                                        ? roundCurrency(
                                            -(totalReceiverPercentage / 100) *
                                              Number(contributor.totalTips || 0),
                                          )
                                        : 0;
                                      const payoutGratuityDisplay = isEligible
                                        ? roundCurrency(
                                            -(totalReceiverPercentage / 100) *
                                              Number(contributor.totalGratuity || 0),
                                          )
                                        : 0;
                                      const effectivePayoutShare = payoutTipsDisplay + payoutGratuityDisplay;
                                      const payoutPercentageDisplay = isEligible
                                        ? Math.abs(totalReceiverPercentage)
                                        : 0;
                                      const payoutDisplay = isEligible
                                        ? roundCurrency((payoutPercentageDisplay / 100) * tipTotal)
                                        : 0;
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
                              className="rounded-lg border border-gray-200 bg-[#f4f2ee] p-5"
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
                                  <div className="grid w-full items-start gap-4 md:grid-cols-[280px_1fr]">
                                    <h3 className="text-base font-semibold text-gray-900 md:pr-2">
                                      <span>
                                        {contributor.employeeName}
                                        {contributor.jobTitle ? ` (${contributor.jobTitle})` : ""}
                                      </span>
                                    </h3>
                                    <div className="grid w-full items-center gap-4 md:grid-cols-[150px_150px_260px_220px_180px]">
                                      <span className="whitespace-nowrap rounded-full bg-white px-3 py-1 text-sm text-black">
                                        Tips: {formatCurrency(contributor.totalTips)}
                                      </span>
                                      <span className="whitespace-nowrap rounded-full bg-white px-3 py-1 text-sm text-black">
                                        Gratuity: {formatCurrency(contributor.totalGratuity)}
                                      </span>
                                      <span className="whitespace-nowrap rounded-full bg-white px-3 py-1 text-sm text-black">
                                        Total (Tips &amp; Gratuity):{" "}
                                        {formatCurrency(contributor.totalTips + contributor.totalGratuity)}
                                      </span>
                                      <span className="min-w-[160px] whitespace-nowrap rounded-full bg-white px-3 py-1 text-sm text-black">
                                        Payout:{" "}
                                        <span className="font-semibold text-red-600">
                                          {payoutPercentageDisplay.toFixed(2)}%
                                        </span>{" "}
                                        (
                                        <span className="font-semibold text-red-600">
                                          {formatPayoutAmount(payoutDisplay)}
                                        </span>
                                        )
                                      </span>
                                      <span className="whitespace-nowrap rounded-full bg-white pl-3 pr-2 py-1 text-sm font-normal text-black">
                                        Net Payout: {formatCurrency(netPayoutDisplay)}
                                      </span>
                                    </div>
                                  </div>
                                  <p className="mt-2 text-xs text-gray-500">{contributor.employeeGuid}</p>
                                </div>
                                <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600" />
                              </div>

                              {isExpanded ? (
                                <>
                                  <div className="mt-4 grid grid-cols-4 gap-6">
                                    <div>
                                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                        In/Out time
                                      </p>
                                      <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-900">
                                        <span className="font-semibold text-gray-600">In:</span>
                                        <span>{formatValue(contributor.inTime)}</span>
                                        <span className="text-gray-400">|</span>
                                        <span className="font-semibold text-gray-600">Out:</span>
                                        <span>{formatValue(contributor.outTime)}</span>
                                      </p>
                                    </div>
                                    <div>
                                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Hours worked</p>
                                      <p className="mt-2 text-sm font-semibold text-gray-900">
                                        {contributor.hoursWorked ? contributor.hoursWorked.toFixed(2) : "0.00"}
                                      </p>
                                    </div>
                                    <div className="text-center">
                                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Sales</p>
                                      <p className="mt-2 flex flex-wrap items-center justify-center gap-2 text-sm text-gray-900">
                                        <span className="font-semibold text-gray-600">Total:</span>
                                        <span>{formatCurrency(contributor.totalSales)}</span>
                                        <span className="text-gray-400">|</span>
                                        <span className="font-semibold text-gray-600">Net:</span>
                                        <span>{formatCurrency(contributor.netSales)}</span>
                                      </p>
                                    </div>
                                    <div className="text-center">
                                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Orders</p>
                                      <p className="mt-2 text-sm font-semibold text-gray-900">
                                        {(contributor.orderCount ?? 0).toLocaleString()}
                                      </p>
                                    </div>
                                    <div />
                                  </div>

                                  <div className="mt-0">
                                    <h4 className="text-sm font-semibold text-gray-900">Payout details</h4>
                                    <div className="mt-3 grid items-start gap-2 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(160px,auto)_minmax(160px,auto)]">
                                      <div>
                                        <p className="text-xs font-semibold uppercase text-gray-500">
                                          Tips &amp; Gratuity
                                        </p>
                                        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-700">
                                          <span className="font-semibold text-gray-600">Tips:</span>
                                          <span>{formatCurrency(contributor.totalTips)}</span>
                                          <span className="text-gray-400">|</span>
                                          <span className="font-semibold text-gray-600">Gratuity:</span>
                                          <span>{formatCurrency(contributor.totalGratuity)}</span>
                                          <span className="text-gray-400">|</span>
                                          <span className="font-semibold text-gray-600">Total:</span>
                                          <span>{formatCurrency(contributor.totalTips + contributor.totalGratuity)}</span>
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
                                        <span className="text-gray-400">|</span>
                                        <span className="font-semibold text-gray-600">Total:</span>
                                        <span className="font-semibold text-red-600">
                                          {formatCurrency(Math.abs(payoutTipsDisplay + payoutGratuityDisplay))}
                                        </span>
                                      </p>
                                    </div>
                                      {(() => {
                                        const netContributorPercentage = isEligible
                                          ? Math.max(0, 100 - Math.abs(totalReceiverPercentage))
                                          : 0;
                                        return (
                                          <label className="-ml-[36px] text-xs font-semibold uppercase tracking-wide text-gray-500">
                                          Payout percentage
                                          <input
                                            readOnly
                                          value={`${netContributorPercentage.toFixed(2)}%`}
                                          className="mt-3 w-[140px] rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-black"
                                          />
                                        </label>
                                        );
                                      })()}
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
                                        const receiverRoleKey = normalizeRoleKey(
                                          contributor.jobTitle ?? contributor.payoutReceiverId,
                                        );
                                        const receiverRoleCount =
                                          receiverRoleCounts[receiverRoleKey] ?? 0;
                                        const rolePercentageTotal =
                                          receiverRolePercentages[receiverRoleKey] ?? 0;
                                        const receiverSharePercentage =
                                          receiverRoleCount > 0
                                            ? rolePercentageTotal / receiverRoleCount
                                            : 0;
                                        const receiverPayoutPercentage = isManualReceiver(contributor)
                                          ? Number(contributor.payoutPercentage || 0)
                                          : receiverSharePercentage;
                                        const hasHoursWorked =
                                          isManualReceiver(contributor) ||
                                          (contributor.hoursWorked ?? 0) > 0;
                                        const payoutTipsDisplay = hasHoursWorked
                                          ? roundCurrency(
                                              (receiverPayoutPercentage / 100) * scheduleOverallTips,
                                            )
                                          : 0;
                                        const payoutGratuityDisplay = hasHoursWorked
                                          ? roundCurrency(
                                              (receiverPayoutPercentage / 100) * scheduleOverallGratuity,
                                            )
                                          : 0;
                                        const payoutAmount = payoutTipsDisplay + payoutGratuityDisplay;
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
                                        const payoutPercentageDisplay = hasHoursWorked
                                          ? receiverPayoutPercentage
                                          : 0;
                                        return (
                                          <div
                                            key={employeeKey}
                                            className="rounded-lg border border-gray-200 bg-[#f4f2ee] p-5"
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
                                              <div className="grid w-full items-start gap-4 md:grid-cols-[280px_1fr]">
                                                <h3 className="text-base font-semibold text-gray-900 md:pr-2">
                                                  <span>
                                                    {contributor.employeeName}
                                                    {contributor.jobTitle ? ` (${contributor.jobTitle})` : ""}
                                                  </span>
                                                </h3>
                                                <div className="grid w-full items-center gap-4 md:grid-cols-[150px_150px_260px_220px_180px]">
                                                  <span className="whitespace-nowrap rounded-full bg-white px-3 py-1 text-sm text-black">
                                                    Tips: {formatCurrency(contributor.totalTips)}
                                                  </span>
                                                  <span className="whitespace-nowrap rounded-full bg-white px-3 py-1 text-sm text-black">
                                                    Gratuity: {formatCurrency(contributor.totalGratuity)}
                                                  </span>
                                                  <span className="whitespace-nowrap rounded-full bg-white px-3 py-1 text-sm text-black">
                                                    Total (Tips &amp; Gratuity):{" "}
                                                    {formatCurrency(contributor.totalTips + contributor.totalGratuity)}
                                                  </span>
                                                  <span className="min-w-[160px] whitespace-nowrap rounded-full bg-white px-3 py-1 text-sm text-black">
                                                    Payout: {payoutPercentageDisplay.toFixed(2)}% (
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
                                                  <span className="whitespace-nowrap rounded-full bg-white pl-3 pr-2 py-1 text-sm font-normal text-black">
                                                    Net Payout: {formatCurrency(netPayoutDisplay)}
                                                  </span>
                                                </div>
                                              </div>
                                                <p className="mt-2 text-xs text-gray-500">{contributor.employeeGuid}</p>
                                              </div>
                                              <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600" />
                                            </div>

                                            {isExpanded ? (
                                              <>
                                                <div className="mt-4 grid grid-cols-4 gap-6">
                                                  <div>
                                                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                                      In/Out time
                                                    </p>
                                                    <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-900">
                                                      <span className="font-semibold text-gray-600">In:</span>
                                                      <span>{formatValue(contributor.inTime)}</span>
                                                      <span className="text-gray-400">|</span>
                                                      <span className="font-semibold text-gray-600">Out:</span>
                                                      <span>{formatValue(contributor.outTime)}</span>
                                                    </p>
                                                  </div>
                                                  <div>
                                                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Hours worked</p>
                                                    <p className="mt-2 text-sm font-semibold text-gray-900">
                                                      {contributor.hoursWorked ? contributor.hoursWorked.toFixed(2) : "0.00"}
                                                    </p>
                                                  </div>
                                                  <div className="text-center">
                                                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Sales</p>
                                                    <p className="mt-2 flex flex-wrap items-center justify-center gap-2 text-sm text-gray-900">
                                                      <span className="font-semibold text-gray-600">Total:</span>
                                                      <span>{formatCurrency(contributor.totalSales)}</span>
                                                      <span className="text-gray-400">|</span>
                                                      <span className="font-semibold text-gray-600">Net:</span>
                                                      <span>{formatCurrency(contributor.netSales)}</span>
                                                    </p>
                                                  </div>
                                                  <div className="text-center">
                                                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Orders</p>
                                                    <p className="mt-2 text-sm font-semibold text-gray-900">
                                                      {(contributor.orderCount ?? 0).toLocaleString()}
                                                    </p>
                                                  </div>
                                                  <div />
                                                </div>

                                                <div className="mt-0">
                                                  <h4 className="text-sm font-semibold text-gray-900">Payout details</h4>
                                                  <div className="mt-3 grid items-start gap-2 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(160px,auto)_minmax(160px,auto)]">
                                                    <div>
                                                      <p className="text-xs font-semibold uppercase text-gray-500">
                                                        Tips &amp; Gratuity
                                                      </p>
                                                      <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-700">
                                                        <span className="font-semibold text-gray-600">Tips:</span>
                                                        <span>{formatCurrency(contributor.totalTips)}</span>
                                                        <span className="text-gray-400">|</span>
                                                        <span className="font-semibold text-gray-600">Gratuity:</span>
                                                        <span>{formatCurrency(contributor.totalGratuity)}</span>
                                                        <span className="text-gray-400">|</span>
                                                        <span className="font-semibold text-gray-600">Total:</span>
                                                        <span>{formatCurrency(contributor.totalTips + contributor.totalGratuity)}</span>
                                                      </p>
                                                    </div>
                                                    <div>
                                                      <p className="text-xs font-semibold uppercase text-gray-500">Payout</p>
                                                      <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-700">
                                                        <span className="font-semibold text-gray-600">Tips:</span>
                                                        <span
                                                          className={
                                                            payoutTipsDisplay > 0
                                                              ? "font-semibold text-emerald-700"
                                                              : "font-semibold text-red-600"
                                                          }
                                                        >
                                                          {formatCurrency(payoutTipsDisplay)}
                                                        </span>
                                                        <span className="text-gray-400">|</span>
                                                        <span className="font-semibold text-gray-600">Gratuity:</span>
                                                        <span
                                                          className={
                                                            payoutGratuityDisplay > 0
                                                              ? "font-semibold text-emerald-700"
                                                              : "font-semibold text-red-600"
                                                          }
                                                        >
                                                          {formatCurrency(payoutGratuityDisplay)}
                                                        </span>
                                                        <span className="text-gray-400">|</span>
                                                        <span className="font-semibold text-gray-600">Total:</span>
                                                        <span
                                                          className={
                                                            payoutTipsDisplay + payoutGratuityDisplay > 0
                                                              ? "font-semibold text-emerald-700"
                                                              : "font-semibold text-red-600"
                                                          }
                                                        >
                                                          {formatCurrency(payoutTipsDisplay + payoutGratuityDisplay)}
                                                        </span>
                                                      </p>
                                                    </div>
                                                    <label className="-ml-[36px] text-xs font-semibold uppercase tracking-wide text-gray-500">
                                                      Payout percentage
                                                      <input
                                                        key={`${scheduleKey}-${contributor.employeeGuid}-${contributor.jobTitle ?? "role"}-${resetToken}`}
                                                        value={
                                                        payoutEdits[
                                                          `${scheduleKey}-${contributor.employeeGuid}-${contributor.jobTitle ?? "role"}`
                                                        ] ?? `${payoutPercentageDisplay.toFixed(2)}%`
                                                      }
                                                        readOnly={editingScheduleKey !== scheduleKey}
                                                        onChange={(event) => {
                                                          const key = `${scheduleKey}-${contributor.employeeGuid}-${contributor.jobTitle ?? "role"}`;
                                                          setPayoutEdits((current) => ({
                                                            ...current,
                                                            [key]: event.target.value,
                                                          }));
                                                        }}
                                                        className="mt-3 w-[140px] rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700"
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
                                                  ? (roleSlots.length ? roleSlots : ["slot-0"]).map((slotId) => (
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
                                      {editingScheduleKey === scheduleKey ? (
                                        <div className="rounded-lg border border-dashed border-gray-200 bg-white p-5 text-sm text-gray-600">
                                          <div className="flex items-center justify-between">
                                            <div className="text-sm font-semibold text-gray-900">Add receiver</div>
                                            <button
                                              type="button"
                                              onClick={() => addCustomReceiver(scheduleKey)}
                                              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-700 shadow-sm transition hover:bg-gray-50"
                                            >
                                              Add Person
                                            </button>
                                          </div>
                                          {customEntries.length === 0 ? (
                                            <p className="mt-3 text-sm text-gray-500">
                                              Add a person, select a job title, and enter a payout percentage.
                                            </p>
                                          ) : (
                                            customEntries.map((entry) => {
                                              const entryKey = `${scheduleKey}-custom-${entry.id}`;
                                              const personDropdownKey = `${entryKey}-person`;
                                              const jobDropdownKey = `${entryKey}-job`;
                                              const blockedNames = new Set<string>();
                                              const blockedGuids = new Set<string>();
                                              schedule.contributors.forEach((contributor) => {
                                                const isReceiver =
                                                  (contributor.isContributor || "").toLowerCase() === "no";
                                                const payoutAmount =
                                                  Number(contributor.payoutTips || 0) +
                                                  Number(contributor.payoutGratuity || 0);
                                                const netPayout = Math.max(
                                                  0,
                                                  getNetPayout(
                                                    contributor.isContributor,
                                                    contributor.totalTips,
                                                    contributor.totalGratuity,
                                                    payoutAmount,
                                                  ),
                                                );
                                                const isContributorWithPayout =
                                                  (contributor.isContributor || "").toLowerCase() === "yes" &&
                                                  netPayout > 0;
                                                if (!isReceiver && !isContributorWithPayout) {
                                                  return;
                                                }
                                                const nameKey = (contributor.employeeName || "")
                                                  .trim()
                                                  .toLowerCase();
                                                if (nameKey) {
                                                  blockedNames.add(nameKey);
                                                }
                                                const guidKey = (contributor.employeeGuid || "").trim();
                                                if (guidKey) {
                                                  blockedGuids.add(guidKey);
                                                }
                                              });
                                              const filteredEmployees = activeEmployeeOptions.filter((employee) => {
                                                const nameKey = employee.name.trim().toLowerCase();
                                                if (blockedNames.has(nameKey)) {
                                                  return false;
                                                }
                                                if (blockedGuids.has(employee.id)) {
                                                  return false;
                                                }
                                                return employee.name
                                                  .toLowerCase()
                                                  .includes(entry.employeeName.trim().toLowerCase());
                                              });
                                              return (
                                                <div
                                                  key={entry.id}
                                                  className="mt-4 grid items-center gap-3 md:grid-cols-[minmax(0,1fr)_minmax(220px,1fr)_minmax(160px,auto)_minmax(120px,auto)]"
                                                >
                                                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                                    Team Member
                                                    <div className="relative mt-2" data-custom-receiver-dropdown="true">
                                                      <input
                                                        value={entry.employeeName}
                                                        onChange={(event) => {
                                                          updateCustomReceiver(scheduleKey, entry.id, {
                                                            employeeGuid: null,
                                                            employeeName: event.target.value,
                                                          });
                                                          setCustomReceiverDropdowns((current) => ({
                                                            ...current,
                                                            [personDropdownKey]: true,
                                                          }));
                                                        }}
                                                        onFocus={() =>
                                                          setCustomReceiverDropdowns((current) => ({
                                                            ...current,
                                                            [personDropdownKey]: true,
                                                          }))
                                                        }
                                                        placeholder="Select or add person"
                                                        className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-gray-900"
                                                      />
                                                      {customReceiverDropdowns[personDropdownKey] ? (
                                                        <div className="absolute z-10 mt-2 w-full max-h-60 overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                                                          {filteredEmployees.length === 0 ? (
                                                            <div className="px-4 py-3 text-sm text-gray-500">
                                                              No matching employees
                                                            </div>
                                                          ) : (
                                                            filteredEmployees.map((employee) => (
                                                              <button
                                                                key={employee.id}
                                                                type="button"
                                                                onClick={() => {
                                                                  updateCustomReceiver(scheduleKey, entry.id, {
                                                                    employeeGuid: employee.id,
                                                                    employeeName: employee.name,
                                                                    jobTitle:
                                                                      entry.jobTitle ||
                                                                      employee.jobTitle ||
                                                                      "",
                                                                  });
                                                                  setCustomReceiverDropdowns({});
                                                                }}
                                                                className="w-full px-4 py-2 text-left text-sm text-gray-900 hover:bg-gray-50"
                                                              >
                                                                {employee.name}
                                                              </button>
                                                            ))
                                                          )}
                                                        </div>
                                                      ) : null}
                                                    </div>
                                                  </label>
                                                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                                    Job Title
                                                    <div className="relative mt-2" data-custom-receiver-dropdown="true">
                                                      <button
                                                        type="button"
                                                        onClick={() =>
                                                          setCustomReceiverDropdowns((current) => ({
                                                            ...current,
                                                            [jobDropdownKey]: !current[jobDropdownKey],
                                                          }))
                                                        }
                                                        className="flex w-full items-center justify-between gap-3 rounded-lg border border-gray-300 bg-white px-4 py-3 text-left text-sm font-normal text-gray-700 outline-none focus:ring-2 focus:ring-gray-900"
                                                      >
                                                        <span
                                                          className={
                                                            entry.jobTitle ? "text-gray-900" : "text-gray-400"
                                                          }
                                                        >
                                                          {entry.jobTitle || "Select job title"}
                                                        </span>
                                                        <span className="ml-2 text-gray-500">▾</span>
                                                      </button>
                                                      {customReceiverDropdowns[jobDropdownKey] ? (
                                                        <div className="absolute z-10 mt-2 w-full max-h-60 overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                                                          {jobTitles.length === 0 ? (
                                                            <div className="px-4 py-3 text-sm text-gray-500">
                                                              No job titles available
                                                            </div>
                                                          ) : (
                                                            jobTitles.map((jobTitle) => (
                                                              <button
                                                                key={jobTitle}
                                                                type="button"
                                                                onClick={() => {
                                                                  updateCustomReceiver(scheduleKey, entry.id, {
                                                                    jobTitle,
                                                                  });
                                                                  setCustomReceiverDropdowns({});
                                                                }}
                                                                className="w-full px-4 py-2 text-left text-sm text-gray-900 hover:bg-gray-50"
                                                              >
                                                                {jobTitle}
                                                              </button>
                                                            ))
                                                          )}
                                                        </div>
                                                      ) : null}
                                                    </div>
                                                  </label>
                                                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                                    Payout percentage
                                                    <input
                                                      value={entry.payoutPercentage}
                                                      onChange={(event) =>
                                                        updateCustomReceiver(scheduleKey, entry.id, {
                                                          payoutPercentage: event.target.value,
                                                        })
                                                      }
                                                      placeholder="0.00%"
                                                      className="mt-2 w-[140px] rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700"
                                                    />
                                                  </label>
                                                  <div className="flex justify-end">
                                                    <button
                                                      type="button"
                                                      onClick={() => removeCustomReceiver(scheduleKey, entry.id)}
                                                      className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-700 shadow-sm transition hover:bg-gray-50"
                                                    >
                                                      Remove
                                                    </button>
                                                  </div>
                                                </div>
                                              );
                                            })
                                          )}
                                        </div>
                                      ) : null}
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
                                        const customReceiverEntries = (customReceivers[scheduleKey] ?? []).reduce(
                                          (acc, entry) => {
                                            const name = entry.employeeName.trim();
                                            const jobTitle = entry.jobTitle.trim();
                                            if (!name || !jobTitle) {
                                              return acc;
                                            }
                                            const parsed = entry.payoutPercentage
                                              ? parsePercentage(entry.payoutPercentage)
                                              : null;
                                            if (parsed === null) {
                                              return acc;
                                            }
                                            const fallbackGuid = entry.employeeGuid ?? `custom-${entry.id}`;
                                            const entryKey = `${fallbackGuid}-${jobTitle}-No`;
                                            if (existingKeys.has(entryKey)) {
                                              return acc;
                                            }
                                            existingKeys.add(entryKey);
                                            const payoutTips = roundCurrency((parsed / 100) * overallTips);
                                            const payoutGratuity = roundCurrency(
                                              (parsed / 100) * overallGratuity,
                                            );
                                            acc.push({
                                              employeeGuid: fallbackGuid,
                                              employeeName: name,
                                              jobTitle,
                                              businessDate: scheduleItem.businessDate,
                                              inTime: null,
                                              outTime: null,
                                              hoursWorked: 1,
                                              isContributor: "No",
                                              payoutReceiverId: jobTitle,
                                              payoutPercentage: parsed,
                                              totalSales: 0,
                                              netSales: 0,
                                              totalTips: 0,
                                              totalGratuity: 0,
                                              overallTips,
                                              overallGratuity,
                                              payoutTips,
                                              payoutGratuity,
                                            });
                                            return acc;
                                          },
                                          [] as ApprovalScheduleWithContributors["contributors"],
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
                                          if (parsed !== null) {
                                            return {
                                              ...role,
                                              payoutPercentage: parsed,
                                            };
                                          }
                                          return role;
                                        });
                                        const existingRoleKeys = new Set(
                                          updatedRoles.map((role) => normalizeRoleKey(role.receiverId)),
                                        );
                                        const addedRoles = (customReceivers[scheduleKey] ?? [])
                                          .reduce((acc, entry) => {
                                            const jobTitle = entry.jobTitle.trim();
                                            if (!jobTitle) {
                                              return acc;
                                            }
                                            const parsed = entry.payoutPercentage
                                              ? parsePercentage(entry.payoutPercentage)
                                              : null;
                                            if (parsed === null) {
                                              return acc;
                                            }
                                            const normalizedKey = normalizeRoleKey(jobTitle);
                                            if (existingRoleKeys.has(normalizedKey)) {
                                              return acc;
                                            }
                                            existingRoleKeys.add(normalizedKey);
                                            acc.push({
                                              receiverId: jobTitle,
                                              payoutPercentage: parsed,
                                              isContributor: false,
                                            });
                                            return acc;
                                          }, [] as ApprovalScheduleWithContributors["receiverRoles"]);
                                        const updatedSchedule = {
                                          ...scheduleItem,
                                          contributors: [
                                            ...updatedContributors,
                                            ...newEntries,
                                            ...customReceiverEntries,
                                          ],
                                          receiverRoles: [...updatedRoles, ...addedRoles],
                                        };
                                        const nextContributorCount = updatedSchedule.contributors.filter(
                                          (contributor) => contributor.isContributor !== "No",
                                        ).length;
                                        const nextReceiverCount = updatedSchedule.contributors.filter(
                                          (contributor) => contributor.isContributor === "No",
                                        ).length;
                                        const normalizedSchedule = {
                                          ...updatedSchedule,
                                          contributorCount: nextContributorCount,
                                          receiverCount: nextReceiverCount,
                                        };
                                        const payloadItems = buildApprovalItems(normalizedSchedule);
                                        if (normalizedSchedule.businessDate) {
                                          saveApprovalOverrides({
                                            restaurantId,
                                            payoutScheduleId: normalizedSchedule.payoutScheduleId,
                                            businessDate: normalizedSchedule.businessDate,
                                            items: payloadItems,
                                          });
                                        }
                                        return normalizedSchedule;
                                      }),
                                    );
                                    setEditingScheduleKey(null);
                                    setResetToken((current) => current + 1);
                                    setPayoutEdits({});
                                    setAddMemberSelections({});
                                    setAddMemberDropdowns({});
                                    setAddMemberSlots({});
                                    setCustomReceivers((current) => ({
                                      ...current,
                                      [scheduleKey]: [],
                                    }));
                                    setCustomReceiverDropdowns({});
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
                                    setExpandedScheduleKeys(new Set());
                                    setExpandedEmployees({});
                                    setResetToken((current) => current + 1);
                                    setPayoutEdits({});
                                    setAddMemberSelections({});
                                    setAddMemberDropdowns({});
                                    setAddMemberSlots({});
                                    setCustomReceivers((current) => ({
                                      ...current,
                                      [scheduleKey]: [],
                                    }));
                                    setCustomReceiverDropdowns({});
                                    requestAnimationFrame(() => {
                                      const target = scheduleRefs.current[scheduleKey];
                                      if (target) {
                                        target.scrollIntoView({ behavior: "smooth", block: "start" });
                                      }
                                    });
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
