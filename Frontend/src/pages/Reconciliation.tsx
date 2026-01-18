import { useEffect, useMemo, useRef, useState } from "react";
import {
  approvePayoutSchedule,
  fetchApprovals,
  saveApprovalOverrides,
  saveApprovalSnapshot,
  type ApprovalContributor,
  type ApprovalsResponse,
  type ApprovalScheduleWithContributors,
  type ApprovalSnapshotItem,
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

const formatAmountWithSign = (amount: number): { text: string; className: string } => {
  if (amount < 0) {
    // Negative: Red color, enclosed in parentheses
    return {
      text: `(${formatCurrency(Math.abs(amount))})`,
      className: "text-red-600",
    };
  }
  // Positive or zero: Green color, no sign
  return {
    text: formatCurrency(amount),
    className: amount > 0 ? "text-green-600" : "text-gray-500",
  };
};

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
  const [netEdits, setNetEdits] = useState<Record<string, string>>({});
  const [removedEmployees, setRemovedEmployees] = useState<Set<string>>(new Set());
  const [removeConfirmation, setRemoveConfirmation] = useState<{
    employeeKey: string;
    employeeName: string;
    scheduleKey: string;
  } | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
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

  const parseCurrency = (value: string) => {
    const cleaned = value.replace(/[^0-9.-]/g, "");
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  };

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

  const buildApprovalItems = (schedule: ApprovalScheduleWithContributors, originalPrepayoutTotal?: number) => {
    const receivers = schedule.contributors.filter(
      (contributor) => (contributor.isContributor || "").toLowerCase() === "no",
    );
    const receiverRolePercentages = schedule.receiverRoles.reduce((acc, role) => {
      const roleKey = normalizeRoleKey(role.receiverId);
      acc[roleKey] = Number(role.payoutPercentage || 0);
      return acc;
    }, {} as Record<string, number>);
    // Count non-manual receivers per role
    const receiverRoleCounts = receivers.reduce((acc, receiver) => {
      // A receiver is "manual" if they have payoutPercentage > 0 but no tips/gratuity and no in/out time
      const isManual =
        Number(receiver.payoutPercentage || 0) > 0 &&
        Number(receiver.totalTips || 0) === 0 &&
        Number(receiver.totalGratuity || 0) === 0 &&
        receiver.inTime === null &&
        receiver.outTime === null;
      if (isManual) {
        return acc;
      }
      const roleKey = normalizeRoleKey(receiver.jobTitle ?? receiver.payoutReceiverId);
      acc[roleKey] = (acc[roleKey] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const { overallTips, overallGratuity } = getOverallBase(schedule);

    // Calculate each receiver's effective percentage
    const receiverPercentages: { receiver: ApprovalContributor; percentage: number }[] = [];
    for (const receiver of receivers) {
      const isManual =
        Number(receiver.payoutPercentage || 0) > 0 &&
        Number(receiver.totalTips || 0) === 0 &&
        Number(receiver.totalGratuity || 0) === 0 &&
        receiver.inTime === null &&
        receiver.outTime === null;
      const hasHours = isManual || (receiver.hoursWorked ?? 0) > 0;
      if (!hasHours) {
        continue;
      }
      const roleKey = normalizeRoleKey(receiver.jobTitle ?? receiver.payoutReceiverId);
      const roleTotal = receiverRolePercentages[roleKey] ?? 0;
      const roleCount = receiverRoleCounts[roleKey] ?? 0;
      const sharePercentage = roleCount > 0 ? roleTotal / roleCount : 0;
      // Use receiver's individual payoutPercentage if set (allows per-employee overrides during edit)
      const individualPct = Number(receiver.payoutPercentage || 0);
      const receiverPct = individualPct > 0 ? individualPct : sharePercentage;
      const payoutAmount = (receiverPct / 100) * (overallTips + overallGratuity);
      if (payoutAmount > 0) {
        receiverPercentages.push({ receiver, percentage: receiverPct });
      }
    }

    // Sum up total receiver percentage (this is what contributors give)
    const totalReceiverPercentage = receiverPercentages.reduce((sum, r) => sum + r.percentage, 0);

    // Get the original total prepayout from the schedule
    // If originalPrepayoutTotal is provided (when employees are removed), use that
    // Otherwise sum from existing employees
    const existingPrepayoutTotal = originalPrepayoutTotal !== undefined
      ? originalPrepayoutTotal
      : schedule.contributors.reduce(
          (sum, c) => sum + (c.prepayoutDeduction || 0),
          0
        );
    // If no existing prepayout data, check if there's a contributionPool we can derive from
    const originalFeePerPerson = schedule.contributors.find((c) => (c.payoutFee || 0) > 0)?.payoutFee || 0;

    // First pass: calculate payout amounts and determine which employees have earnings
    const employeePayouts = schedule.contributors.map((item) => {
      const isContributor = (item.isContributor || "").toLowerCase() === "yes";
      const isManual =
        !isContributor &&
        Number(item.payoutPercentage || 0) > 0 &&
        Number(item.totalTips || 0) === 0 &&
        Number(item.totalGratuity || 0) === 0 &&
        item.inTime === null &&
        item.outTime === null;
      const hasHours = isManual || (item.hoursWorked ?? 0) > 0;

      const receiverRoleKey = normalizeRoleKey(item.jobTitle ?? item.payoutReceiverId);
      const receiverRoleCount = receiverRoleCounts[receiverRoleKey] ?? 0;
      const rolePercentageTotal = receiverRolePercentages[receiverRoleKey] ?? 0;
      const receiverSharePercentage =
        !isContributor && receiverRoleCount > 0 ? rolePercentageTotal / receiverRoleCount : 0;
      // Use individual payoutPercentage if set (allows per-employee overrides during edit)
      const individualReceiverPct = Number(item.payoutPercentage || 0);
      const receiverPayoutPercentage = !isContributor && individualReceiverPct > 0
        ? individualReceiverPct
        : receiverSharePercentage;

      const tipTotal = Number(item.totalTips || 0) + Number(item.totalGratuity || 0);
      const payoutTips = isContributor
        ? tipTotal > 0
          ? roundCurrency(-(totalReceiverPercentage / 100) * Number(item.totalTips || 0))
          : 0
        : hasHours
          ? roundCurrency((receiverPayoutPercentage / 100) * overallTips)
          : 0;
      const payoutGratuity = isContributor
        ? tipTotal > 0
          ? roundCurrency(-(totalReceiverPercentage / 100) * Number(item.totalGratuity || 0))
          : 0
        : hasHours
          ? roundCurrency((receiverPayoutPercentage / 100) * overallGratuity)
          : 0;
      const payoutAmount = payoutTips + payoutGratuity;

      // Determine if this employee has earnings
      const hasEarnings = isContributor ? tipTotal > 0 : payoutAmount > 0;

      return {
        item,
        isContributor,
        isManual,
        hasHours,
        receiverPayoutPercentage,
        payoutTips,
        payoutGratuity,
        payoutAmount,
        hasEarnings,
      };
    });

    // Count employees with earnings for prepayout calculation
    const employeesWithEarnings = employeePayouts.filter((e) => e.hasEarnings).length;

    // Recalculate prepayout per person based on employees with earnings
    const prepayoutPerPerson =
      employeesWithEarnings > 0 && existingPrepayoutTotal > 0
        ? roundCurrency(existingPrepayoutTotal / employeesWithEarnings)
        : 0;

    // Second pass: build final items with deductions
    return employeePayouts.map(
      ({
        item,
        isContributor,
        receiverPayoutPercentage,
        payoutTips,
        payoutGratuity,
        payoutAmount,
        hasEarnings,
      }) => {
        // Apply deductions only to employees with earnings
        const prepayoutDeduction = hasEarnings ? prepayoutPerPerson : 0;
        const payoutFee = hasEarnings ? originalFeePerPerson : 0;

        // Calculate net payout with deductions
        // If item already has an edited netPayout, use that instead of recalculating
        // EXCEPT when employees are removed (originalPrepayoutTotal provided) - then recalculate for contributors
        const grossPayout =
          Number(item.totalTips || 0) + Number(item.totalGratuity || 0) + payoutAmount;
        const calculatedNetPayout = Math.max(0, grossPayout - prepayoutDeduction - payoutFee);
        // Force recalculation for contributors when employees are removed (receiver % changed)
        const shouldRecalculate = isContributor && originalPrepayoutTotal !== undefined;
        const netPayout = (!shouldRecalculate && item.netPayout !== undefined) ? item.netPayout : calculatedNetPayout;

        return {
          employeeGuid: item.employeeGuid,
          employeeName: item.employeeName,
          jobTitle: item.jobTitle,
          isContributor: item.isContributor,
          payoutReceiverId: item.payoutReceiverId,
          payoutPercentage: isContributor ? totalReceiverPercentage : receiverPayoutPercentage,
          totalSales: item.totalSales,
          netSales: item.netSales,
          totalTips: item.totalTips,
          totalGratuity: item.totalGratuity,
          overallTips: item.overallTips,
          overallGratuity: item.overallGratuity,
          payoutTips,
          payoutGratuity,
          netPayout,
          prepayoutDeduction,
          payoutFee,
        };
      },
    );
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
      // Use individual payoutPercentage if set (allows per-employee overrides during edit)
      const individualPct = Number(receiver.payoutPercentage || 0);
      const receiverPercentage = individualPct > 0 ? individualPct : share;
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
      {/* Validation Error Dialog */}
      {validationError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 max-w-md rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
                <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900">Validation Error</h3>
            </div>
            <p className="mb-6 text-sm text-gray-600">{validationError}</p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setValidationError(null)}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-red-700"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Remove Employee Confirmation Popup */}
      {removeConfirmation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 max-w-md rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
                <svg className="h-6 w-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900">Remove Employee</h3>
            </div>
            <p className="mb-6 text-sm text-gray-600">
              Are you sure you want to remove <span className="font-semibold">{removeConfirmation.employeeName}</span> from this shift payout? This action will take effect when you click Save.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setRemoveConfirmation(null)}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setRemovedEmployees((current) => {
                    const next = new Set(current);
                    next.add(removeConfirmation.employeeKey);
                    return next;
                  });
                  setRemoveConfirmation(null);
                }}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-red-700"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
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
                      Contributors: {schedule.contributors.filter(c => c.isContributor === "Yes").length}
                    </span>
                    <span className="rounded-full border border-gray-200 bg-white px-3 py-1 text-black">
                      Receivers: {schedule.contributors.filter(c => c.isContributor === "No" && (c.hoursWorked ?? 0) > 0).length}
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
                            userId,
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
                        onClick={async (event) => {
                          event.stopPropagation();

                          // Save snapshot of current state for audit trail
                          if (restaurantId && userId && schedule.businessDate) {
                            const snapshotItems: ApprovalSnapshotItem[] = schedule.contributors.map((contributor) => ({
                              employeeGuid: contributor.employeeGuid,
                              employeeName: contributor.employeeName,
                              jobTitle: contributor.jobTitle,
                              fieldName: "PAYOUT_PERCENTAGE",
                              currentValue: String(contributor.payoutPercentage ?? 0),
                            }));
                            // Add net payout values to snapshot
                            schedule.contributors.forEach((contributor) => {
                              snapshotItems.push({
                                employeeGuid: contributor.employeeGuid,
                                employeeName: contributor.employeeName,
                                jobTitle: contributor.jobTitle,
                                fieldName: "NET_PAYOUT",
                                currentValue: String(contributor.netPayout ?? 0),
                              });
                            });
                            await saveApprovalSnapshot({
                              restaurantId,
                              payoutScheduleId: schedule.payoutScheduleId,
                              businessDate: schedule.businessDate,
                              userId,
                              items: snapshotItems,
                            });
                          }

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

                {/* Summary Section */}
                <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
                    Payout Summary
                  </h3>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {/* Tips & Gratuity */}
                    <div className="rounded-md bg-gray-50 p-3">
                      <p className="text-xs font-medium text-gray-500">Tips</p>
                      <p className="mt-1 text-lg font-semibold text-gray-900">
                        {formatCurrency(schedule.totalTips)}
                      </p>
                    </div>
                    <div className="rounded-md bg-gray-50 p-3">
                      <p className="text-xs font-medium text-gray-500">Gratuity</p>
                      <p className="mt-1 text-lg font-semibold text-gray-900">
                        {formatCurrency(schedule.totalGratuity)}
                      </p>
                    </div>
                    <div className="rounded-md bg-green-50 p-3">
                      <p className="text-xs font-medium text-green-700">Total (Tips + Gratuity)</p>
                      <p className="mt-1 text-lg font-semibold text-green-800">
                        {formatCurrency(schedule.totalTips + schedule.totalGratuity)}
                      </p>
                    </div>
                    <div className="rounded-md bg-gray-50 p-3">
                      <p className="text-xs font-medium text-gray-500">Total Orders</p>
                      <p className="mt-1 text-lg font-semibold text-gray-900">
                        {(schedule.orderCount ?? 0).toLocaleString()}
                      </p>
                    </div>
                    {/* Sales */}
                    <div className="rounded-md bg-gray-50 p-3">
                      <p className="text-xs font-medium text-gray-500">Total Sales</p>
                      <p className="mt-1 text-lg font-semibold text-gray-900">
                        {formatCurrency(schedule.totalSales)}
                      </p>
                    </div>
                    <div className="rounded-md bg-gray-50 p-3">
                      <p className="text-xs font-medium text-gray-500">Net Sales</p>
                      <p className="mt-1 text-lg font-semibold text-gray-900">
                        {formatCurrency(schedule.netSales)}
                      </p>
                    </div>
                    {/* Prepayout & Fee */}
                    {(() => {
                      // Sum actual prepayout deductions from all contributors (only those with deductions)
                      const totalPrepayout = schedule.contributors.reduce(
                        (sum, c) => sum + (c.prepayoutDeduction || 0),
                        0
                      );
                      const employeesWithPrepayout = schedule.contributors.filter(
                        (c) => (c.prepayoutDeduction || 0) > 0
                      ).length;
                      const prepayoutPerPerson = employeesWithPrepayout > 0
                        ? totalPrepayout / employeesWithPrepayout
                        : 0;
                      // Sum actual payout fees from all contributors (only those with fees)
                      const totalPayoutFee = schedule.contributors.reduce(
                        (sum, c) => sum + (c.payoutFee || 0),
                        0
                      );
                      const employeesWithFee = schedule.contributors.filter(
                        (c) => (c.payoutFee || 0) > 0
                      ).length;
                      const feePerPerson = employeesWithFee > 0
                        ? totalPayoutFee / employeesWithFee
                        : 0;
                      return (
                        <>
                          <div className="rounded-md bg-amber-50 p-3">
                            <p className="text-xs font-medium text-amber-700">Prepayout Amount</p>
                            <p className="mt-1 text-lg font-semibold text-amber-800">
                              {formatCurrency(totalPrepayout)}
                              {employeesWithPrepayout > 0 ? (
                                <span className="ml-1 text-xs font-normal text-amber-600">
                                  ({formatCurrency(prepayoutPerPerson)}/person × {employeesWithPrepayout})
                                </span>
                              ) : null}
                            </p>
                          </div>
                          <div className="rounded-md bg-amber-50 p-3">
                            <p className="text-xs font-medium text-amber-700">Payout Transfer Fee</p>
                            <p className="mt-1 text-lg font-semibold text-amber-800">
                              {formatCurrency(totalPayoutFee)}
                              {employeesWithFee > 0 ? (
                                <span className="ml-1 text-xs font-normal text-amber-600">
                                  ({formatCurrency(feePerPerson)}/person × {employeesWithFee})
                                </span>
                              ) : null}
                            </p>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>

                {isActive ? (
                  <div className="mt-6 space-y-6 border-t border-gray-100 pt-6">
                    {schedule.contributors.length === 0 ? (
                      <div className="text-sm text-gray-500">No contributors assigned.</div>
                    ) : (
                      (() => {
                        // Filter out removed employees when in edit mode
                        const isRemovedEmployee = (contributor: ApprovalContributor) => {
                          const empKey = `${scheduleKey}-${contributor.employeeGuid}-${contributor.jobTitle ?? "role"}`;
                          return editingScheduleKey === scheduleKey && removedEmployees.has(empKey);
                        };
                        const contributors = schedule.contributors
                          .filter((contributor) => contributor.isContributor === "Yes" && !isRemovedEmployee(contributor))
                          .slice()
                          .sort((a, b) => {
                            const firstA = (a.employeeName || "").trim().split(/\s+/)[0] || "";
                            const firstB = (b.employeeName || "").trim().split(/\s+/)[0] || "";
                            return firstA.localeCompare(firstB, undefined, { sensitivity: "base" });
                          });
                        const receivers = schedule.contributors
                          .filter((contributor) => contributor.isContributor === "No" && !isRemovedEmployee(contributor))
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
                        // Create filtered schedule for percentage calculation (excludes removed employees)
                        const filteredScheduleForCalc = {
                          ...schedule,
                          contributors: schedule.contributors.filter((c) => !isRemovedEmployee(c)),
                        };
                        const totalReceiverPercentage = getReceiverPercentSum(filteredScheduleForCalc);
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
                              className="rounded-lg border border-gray-200 bg-white overflow-hidden"
                            >
                              {/* Collapsed Row - Single Line */}
                              <div
                                className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
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
                                {/* Expand/Collapse Icon */}
                                <div className="flex items-center gap-3 min-w-0 flex-1">
                                  <svg
                                    className={`h-4 w-4 text-gray-400 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                  >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                  </svg>
                                  <div className="min-w-0">
                                    <span className="font-medium text-gray-900 truncate">
                                      {contributor.employeeName}
                                    </span>
                                    {contributor.jobTitle && (
                                      <span className="ml-2 text-sm text-gray-500">({contributor.jobTitle})</span>
                                    )}
                                  </div>
                                </div>
                                {/* Summary Stats in Collapsed View - Contributors */}
                                {(() => {
                                  const tips = Number(contributor.totalTips || 0);
                                  const gratuity = Number(contributor.totalGratuity || 0);
                                  const total = tips + gratuity;
                                  const rate = payoutPercentageDisplay;
                                  const payout = -payoutDisplay;
                                  const prepayout = contributor.prepayoutDeduction || 0;
                                  const transferFee = contributor.payoutFee || 0;
                                  const netValue = contributor.netPayout ?? netPayoutDisplay;
                                  const payoutFormatted = formatAmountWithSign(payout);
                                  const netFormatted = formatAmountWithSign(netValue);

                                  return (
                                    <div className="grid grid-cols-8 gap-2 text-sm" style={{ minWidth: "700px" }}>
                                      <div className="text-right">
                                        <span className="text-gray-500">Tips: </span>
                                        <span className="font-medium">{formatCurrency(tips)}</span>
                                      </div>
                                      <div className="text-right">
                                        <span className="text-gray-500">Gratuity: </span>
                                        <span className="font-medium">{formatCurrency(gratuity)}</span>
                                      </div>
                                      <div className="text-right">
                                        <span className="text-gray-500">Total: </span>
                                        <span className="font-medium">{formatCurrency(total)}</span>
                                      </div>
                                      <div className="text-right">
                                        <span className="text-gray-500">Rate: </span>
                                        <span className="font-medium">{rate.toFixed(2)}%</span>
                                      </div>
                                      <div className="text-right">
                                        <span className="text-gray-500">Payout: </span>
                                        <span className={`font-medium ${payoutFormatted.className}`}>{payoutFormatted.text}</span>
                                      </div>
                                      <div className="text-right">
                                        <span className="text-gray-500">Prepayout: </span>
                                        <span className={`font-medium ${prepayout > 0 ? "text-red-600" : ""}`}>
                                          {prepayout > 0 ? `(${formatCurrency(prepayout)})` : formatCurrency(0)}
                                        </span>
                                      </div>
                                      <div className="text-right">
                                        <span className="text-gray-500">Fee: </span>
                                        <span className={`font-medium ${transferFee > 0 ? "text-red-600" : ""}`}>
                                          {transferFee > 0 ? `(${formatCurrency(transferFee)})` : formatCurrency(0)}
                                        </span>
                                      </div>
                                      <div className="text-right">
                                        <span className="text-gray-500">Net: </span>
                                        <span className={`font-medium ${netFormatted.className}`}>{netFormatted.text}</span>
                                      </div>
                                    </div>
                                  );
                                })()}
                              </div>

                              {/* Expanded Details */}
                              {isExpanded && (
                                <div className="border-t border-gray-100 bg-gray-50 px-4 py-4">
                                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                                    {/* Time & Hours */}
                                    <div>
                                      <p className="text-xs font-medium uppercase text-gray-500">Shift Time</p>
                                      <p className="mt-1 text-sm text-gray-900">
                                        {formatValue(contributor.inTime)} - {formatValue(contributor.outTime)}
                                      </p>
                                      <p className="text-xs text-gray-500">
                                        {contributor.hoursWorked?.toFixed(2) ?? "0.00"} hours
                                      </p>
                                    </div>
                                    {/* Sales */}
                                    <div>
                                      <p className="text-xs font-medium uppercase text-gray-500">Sales</p>
                                      <p className="mt-1 text-sm text-gray-900">
                                        Total: {formatCurrency(contributor.totalSales)}
                                      </p>
                                      <p className="text-xs text-gray-500">
                                        Net: {formatCurrency(contributor.netSales)}
                                      </p>
                                    </div>
                                    {/* Orders */}
                                    <div>
                                      <p className="text-xs font-medium uppercase text-gray-500">Orders</p>
                                      <p className="mt-1 text-sm text-gray-900">
                                        {(contributor.orderCount ?? 0).toLocaleString()}
                                      </p>
                                    </div>
                                    {/* Payout Breakdown */}
                                    <div>
                                      <p className="text-xs font-medium uppercase text-gray-500">Payout Breakdown</p>
                                      <p className="mt-1 text-sm text-gray-900">
                                        Rate: <span className="font-medium text-red-600">{payoutPercentageDisplay.toFixed(2)}%</span>
                                      </p>
                                      <p className="text-xs text-gray-500">
                                        Tips: {formatCurrency(payoutTipsDisplay)} | Gratuity: {formatCurrency(payoutGratuityDisplay)}
                                      </p>
                                    </div>
                                    {/* Deductions */}
                                    {(contributor.prepayoutDeduction || contributor.payoutFee) && (
                                      <div className="sm:col-span-2">
                                        <p className="text-xs font-medium uppercase text-gray-500">Deductions</p>
                                        <div className="mt-1 flex gap-4 text-sm">
                                          {contributor.prepayoutDeduction ? (
                                            <span>
                                              Prepayout: <span className="text-red-600">({formatCurrency(contributor.prepayoutDeduction)})</span>
                                            </span>
                                          ) : null}
                                          {contributor.payoutFee ? (
                                            <span>
                                              Transfer Fee: <span className="text-red-600">({formatCurrency(contributor.payoutFee)})</span>
                                            </span>
                                          ) : null}
                                        </div>
                                      </div>
                                    )}
                                    {/* Net Amount Edit (in Edit mode) */}
                                    {editingScheduleKey === scheduleKey && (
                                      <div className="sm:col-span-2">
                                        <label className="text-xs font-medium uppercase text-gray-500">
                                          Edit Net Amount
                                          <input
                                            key={`${scheduleKey}-net-${contributor.employeeGuid}-${contributor.jobTitle ?? "role"}-${resetToken}`}
                                            value={
                                              netEdits[
                                                `${scheduleKey}-net-${contributor.employeeGuid}-${contributor.jobTitle ?? "role"}`
                                              ] ?? `$${(contributor.netPayout ?? netPayoutDisplay).toFixed(2)}`
                                            }
                                            onChange={(event) => {
                                              const key = `${scheduleKey}-net-${contributor.employeeGuid}-${contributor.jobTitle ?? "role"}`;
                                              setNetEdits((current) => ({
                                                ...current,
                                                [key]: event.target.value,
                                              }));
                                            }}
                                            className="mt-1 block w-full max-w-[140px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                                          />
                                        </label>
                                      </div>
                                    )}
                                  </div>
                                  <p className="mt-3 text-xs text-gray-400">ID: {contributor.employeeGuid}</p>
                                </div>
                              )}
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
                                        // Use individual payoutPercentage if set (allows per-employee overrides)
                                        const individualPct = Number(contributor.payoutPercentage || 0);
                                        const receiverPayoutPercentage = individualPct > 0
                                          ? individualPct
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
                                            className="rounded-lg border border-gray-200 bg-white overflow-hidden"
                                          >
                                            {/* Collapsed Row - Single Line */}
                                            <div
                                              className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
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
                                              {/* Expand/Collapse Icon */}
                                              <div className="flex items-center gap-3 min-w-0 flex-1">
                                                <svg
                                                  className={`h-4 w-4 text-gray-400 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                                                  fill="none"
                                                  viewBox="0 0 24 24"
                                                  stroke="currentColor"
                                                >
                                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                                </svg>
                                                <div className="min-w-0">
                                                  <span className="font-medium text-gray-900 truncate">
                                                    {contributor.employeeName}
                                                  </span>
                                                  {contributor.jobTitle && (
                                                    <span className="ml-2 text-sm text-gray-500">({contributor.jobTitle})</span>
                                                  )}
                                                </div>
                                              </div>
                                              {/* Summary Stats in Collapsed View - Receivers */}
                                              {(() => {
                                                const rate = payoutPercentageDisplay;
                                                const payout = payoutDisplay;
                                                const prepayout = contributor.prepayoutDeduction || 0;
                                                const transferFee = contributor.payoutFee || 0;
                                                const netValue = contributor.netPayout ?? netPayoutDisplay;
                                                const payoutFormatted = formatAmountWithSign(payout);
                                                const netFormatted = formatAmountWithSign(netValue);

                                                return (
                                                  <div className="grid grid-cols-8 gap-2 text-sm" style={{ minWidth: "700px" }}>
                                                    {/* Empty columns 1-3 to align with contributors */}
                                                    <div></div>
                                                    <div></div>
                                                    <div></div>
                                                    <div className="text-right">
                                                      <span className="text-gray-500">Rate: </span>
                                                      <span className="font-medium">{rate.toFixed(2)}%</span>
                                                    </div>
                                                    <div className="text-right">
                                                      <span className="text-gray-500">Payout: </span>
                                                      <span className={`font-medium ${payoutFormatted.className}`}>{payoutFormatted.text}</span>
                                                    </div>
                                                    <div className="text-right">
                                                      <span className="text-gray-500">Prepayout: </span>
                                                      <span className={`font-medium ${prepayout > 0 ? "text-red-600" : ""}`}>
                                                        {prepayout > 0 ? `(${formatCurrency(prepayout)})` : formatCurrency(0)}
                                                      </span>
                                                    </div>
                                                    <div className="text-right">
                                                      <span className="text-gray-500">Fee: </span>
                                                      <span className={`font-medium ${transferFee > 0 ? "text-red-600" : ""}`}>
                                                        {transferFee > 0 ? `(${formatCurrency(transferFee)})` : formatCurrency(0)}
                                                      </span>
                                                    </div>
                                                    <div className="text-right">
                                                      <span className="text-gray-500">Net: </span>
                                                      <span className={`font-medium ${netFormatted.className}`}>{netFormatted.text}</span>
                                                    </div>
                                                  </div>
                                                );
                                              })()}
                                            </div>

                                            {/* Expanded Details */}
                                            {isExpanded && (
                                              <div className="border-t border-gray-100 bg-gray-50 px-4 py-4">
                                                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                                                  {/* Time & Hours */}
                                                  <div>
                                                    <p className="text-xs font-medium uppercase text-gray-500">Shift Time</p>
                                                    <p className="mt-1 text-sm text-gray-900">
                                                      {formatValue(contributor.inTime)} - {formatValue(contributor.outTime)}
                                                    </p>
                                                    <p className="text-xs text-gray-500">
                                                      {contributor.hoursWorked?.toFixed(2) ?? "0.00"} hours
                                                    </p>
                                                  </div>
                                                  {/* Sales */}
                                                  <div>
                                                    <p className="text-xs font-medium uppercase text-gray-500">Sales</p>
                                                    <p className="mt-1 text-sm text-gray-900">
                                                      Total: {formatCurrency(contributor.totalSales)}
                                                    </p>
                                                    <p className="text-xs text-gray-500">
                                                      Net: {formatCurrency(contributor.netSales)}
                                                    </p>
                                                  </div>
                                                  {/* Orders */}
                                                  <div>
                                                    <p className="text-xs font-medium uppercase text-gray-500">Orders</p>
                                                    <p className="mt-1 text-sm text-gray-900">
                                                      {(contributor.orderCount ?? 0).toLocaleString()}
                                                    </p>
                                                  </div>
                                                  {/* Payout Breakdown */}
                                                  <div>
                                                    <p className="text-xs font-medium uppercase text-gray-500">Payout Breakdown</p>
                                                    <p className="mt-1 text-sm text-gray-900">
                                                      Tips: <span className="font-medium text-emerald-600">{formatCurrency(payoutTipsDisplay)}</span>
                                                    </p>
                                                    <p className="text-xs text-gray-500">
                                                      Gratuity: {formatCurrency(payoutGratuityDisplay)}
                                                    </p>
                                                  </div>
                                                  {/* Payout Percentage Edit (in Edit mode) */}
                                                  {editingScheduleKey === scheduleKey && (
                                                    <div className="sm:col-span-2">
                                                      <label className="text-xs font-medium uppercase text-gray-500">
                                                        Edit Payout Percentage
                                                        <input
                                                          key={`${scheduleKey}-${contributor.employeeGuid}-${contributor.jobTitle ?? "role"}-${resetToken}`}
                                                          value={
                                                            payoutEdits[
                                                              `${scheduleKey}-${contributor.employeeGuid}-${contributor.jobTitle ?? "role"}`
                                                            ] ?? `${payoutPercentageDisplay.toFixed(2)}%`
                                                          }
                                                          onChange={(event) => {
                                                            const key = `${scheduleKey}-${contributor.employeeGuid}-${contributor.jobTitle ?? "role"}`;
                                                            setPayoutEdits((current) => ({
                                                              ...current,
                                                              [key]: event.target.value,
                                                            }));
                                                          }}
                                                          className="mt-1 block w-full max-w-[140px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                                                        />
                                                      </label>
                                                    </div>
                                                  )}
                                                  {/* Net Amount Edit (in Edit mode) */}
                                                  {editingScheduleKey === scheduleKey && (
                                                    <div className="sm:col-span-2">
                                                      <label className="text-xs font-medium uppercase text-gray-500">
                                                        Edit Net Amount
                                                        <input
                                                          key={`${scheduleKey}-net-${contributor.employeeGuid}-${contributor.jobTitle ?? "role"}-${resetToken}`}
                                                          value={
                                                            netEdits[
                                                              `${scheduleKey}-net-${contributor.employeeGuid}-${contributor.jobTitle ?? "role"}`
                                                            ] ?? `$${(contributor.netPayout ?? netPayoutDisplay).toFixed(2)}`
                                                          }
                                                          onChange={(event) => {
                                                            const key = `${scheduleKey}-net-${contributor.employeeGuid}-${contributor.jobTitle ?? "role"}`;
                                                            setNetEdits((current) => ({
                                                              ...current,
                                                              [key]: event.target.value,
                                                            }));
                                                          }}
                                                          className="mt-1 block w-full max-w-[140px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                                                        />
                                                      </label>
                                                    </div>
                                                  )}
                                                  {/* Deductions */}
                                                  {(contributor.prepayoutDeduction || contributor.payoutFee) && (
                                                    <div className="sm:col-span-2">
                                                      <p className="text-xs font-medium uppercase text-gray-500">Deductions</p>
                                                      <div className="mt-1 flex gap-4 text-sm">
                                                        {contributor.prepayoutDeduction ? (
                                                          <span>
                                                            Prepayout: <span className="text-red-600">({formatCurrency(contributor.prepayoutDeduction)})</span>
                                                          </span>
                                                        ) : null}
                                                        {contributor.payoutFee ? (
                                                          <span>
                                                            Transfer Fee: <span className="text-red-600">({formatCurrency(contributor.payoutFee)})</span>
                                                          </span>
                                                        ) : null}
                                                      </div>
                                                    </div>
                                                  )}
                                                  {/* Remove Employee Button (in Edit mode) */}
                                                  {editingScheduleKey === scheduleKey && (
                                                    <div className="sm:col-span-2 lg:col-span-4 flex justify-end">
                                                      <button
                                                        type="button"
                                                        onClick={(event) => {
                                                          event.stopPropagation();
                                                          setRemoveConfirmation({
                                                            employeeKey,
                                                            employeeName: contributor.employeeName ?? "Unknown",
                                                            scheduleKey,
                                                          });
                                                        }}
                                                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-600 shadow-sm transition hover:bg-red-50 hover:border-red-400"
                                                      >
                                                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                        </svg>
                                                        Remove
                                                      </button>
                                                    </div>
                                                  )}
                                                </div>
                                                <p className="mt-3 text-xs text-gray-400">ID: {contributor.employeeGuid}</p>
                                              </div>
                                            )}
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

                                    // Check if any net edits were made for this schedule
                                    const scheduleNetEdits = Object.entries(netEdits).filter(([key]) =>
                                      key.startsWith(`${scheduleKey}-net-`)
                                    );

                                    // If net edits exist, validate totals first
                                    if (scheduleNetEdits.length > 0) {
                                      const scheduleToValidate = schedules.find(
                                        (s) => `${s.payoutScheduleId}-${s.businessDate}` === scheduleKey
                                      );
                                      if (scheduleToValidate) {
                                        const { overallTips, overallGratuity } = getOverallBase(scheduleToValidate);
                                        const totalTipsGratuity = overallTips + overallGratuity;

                                        // Calculate total Net (using edited values where available)
                                        let totalNet = 0;
                                        let totalPrepayout = 0;
                                        let totalFee = 0;

                                        for (const contributor of scheduleToValidate.contributors) {
                                          const netKey = `${scheduleKey}-net-${contributor.employeeGuid}-${contributor.jobTitle ?? "role"}`;
                                          const editedNet = netEdits[netKey];
                                          const netValue = editedNet !== undefined
                                            ? (parseCurrency(editedNet) ?? 0)
                                            : (contributor.netPayout ?? 0);
                                          totalNet += netValue;
                                          totalPrepayout += contributor.prepayoutDeduction || 0;
                                          totalFee += contributor.payoutFee || 0;
                                        }

                                        const expectedTotal = roundCurrency(totalNet + totalPrepayout + totalFee);
                                        const actualTotal = roundCurrency(totalTipsGratuity);

                                        // Allow small rounding differences (within $0.05)
                                        if (Math.abs(expectedTotal - actualTotal) > 0.05) {
                                          setValidationError(
                                            `Total mismatch: Sum of Net amounts ($${totalNet.toFixed(2)}) + Prepayout ($${totalPrepayout.toFixed(2)}) + Transfer Fee ($${totalFee.toFixed(2)}) = $${expectedTotal.toFixed(2)}, but Total Tips + Gratuity = $${actualTotal.toFixed(2)}. Please adjust the values to match.`
                                          );
                                          return;
                                        }
                                      }
                                    }

                                    // Find the current schedule and build payload BEFORE setSchedules (which is async)
                                    const currentSchedule = schedules.find(
                                      (s) => `${s.payoutScheduleId}-${s.businessDate}` === scheduleKey
                                    );
                                    if (!currentSchedule) {
                                      console.error("Schedule not found:", scheduleKey);
                                      return;
                                    }

                                    // Calculate original prepayout total from ALL employees BEFORE filtering
                                    const originalPrepayoutTotal = currentSchedule.contributors.reduce(
                                      (sum, c) => sum + (c.prepayoutDeduction || 0),
                                      0
                                    );

                                    // Collect removed employees for this schedule
                                    const removedForThisSchedule = currentSchedule.contributors.filter((c) => {
                                      const empKey = `${scheduleKey}-${c.employeeGuid}-${c.jobTitle ?? "role"}`;
                                      return removedEmployees.has(empKey);
                                    });

                                    // Filter out removed employees from the schedule
                                    const remainingContributors = currentSchedule.contributors.filter((c) => {
                                      const empKey = `${scheduleKey}-${c.employeeGuid}-${c.jobTitle ?? "role"}`;
                                      return !removedEmployees.has(empKey);
                                    });

                                    // Build the normalized schedule with all edits applied (same logic as inside setSchedules)
                                    const scheduleWithRemovals = { ...currentSchedule, contributors: remainingContributors };
                                    const { overallTips: baseOverallTips, overallGratuity: baseOverallGratuity } = getOverallBase(scheduleWithRemovals);
                                    const preUpdatedContributors = remainingContributors.map((contributor) => {
                                      const isContributor = contributor.isContributor !== "No";
                                      const netKey = `${scheduleKey}-net-${contributor.employeeGuid}-${contributor.jobTitle ?? "role"}`;
                                      const payoutKey = `${scheduleKey}-${contributor.employeeGuid}-${contributor.jobTitle ?? "role"}`;
                                      const editedNet = netEdits[netKey];
                                      const editedPct = payoutEdits[payoutKey];

                                      if (editedNet !== undefined) {
                                        const netValue = parseCurrency(editedNet) ?? 0;
                                        const prepayout = contributor.prepayoutDeduction || 0;
                                        const fee = contributor.payoutFee || 0;
                                        const totalPool = baseOverallTips + baseOverallGratuity;

                                        if (isContributor) {
                                          const contributorTips = Number(contributor.totalTips || 0);
                                          const contributorGratuity = Number(contributor.totalGratuity || 0);
                                          const contributorTotal = contributorTips + contributorGratuity;
                                          if (contributorTotal > 0) {
                                            const payoutAmount = contributorTotal - netValue - prepayout - fee;
                                            const newPercentage = roundCurrency((payoutAmount / contributorTotal) * 100);
                                            return { ...contributor, payoutPercentage: newPercentage, netPayout: netValue };
                                          }
                                        } else {
                                          if (totalPool > 0) {
                                            const grossPayout = netValue + prepayout + fee;
                                            const newPercentage = roundCurrency((grossPayout / totalPool) * 100);
                                            return { ...contributor, payoutPercentage: newPercentage, netPayout: netValue };
                                          }
                                        }
                                      }

                                      if (!isContributor && editedPct !== undefined) {
                                        const parsed = parsePercentage(editedPct);
                                        if (parsed !== null) {
                                          return { ...contributor, payoutPercentage: parsed };
                                        }
                                      }

                                      return contributor;
                                    });

                                    // Add new employees from addMemberSelections and customReceivers
                                    const existingKeys = new Set(
                                      preUpdatedContributors.map(
                                        (c) => `${c.employeeGuid}-${c.jobTitle ?? ""}-${c.isContributor}`,
                                      ),
                                    );
                                    const newMemberEntries: ApprovalContributor[] = [];
                                    // Add from addMemberSelections (role-based additions)
                                    currentSchedule.receiverRoles.forEach((role) => {
                                      const roleKey = `${scheduleKey}-role-${role.receiverId ?? "role"}`;
                                      const selections = addMemberSelections[roleKey];
                                      if (!selections) return;
                                      Object.entries(selections).forEach(([slotId, selection]) => {
                                        if (!selection) return;
                                        const entryKey = `${selection.id}-${role.receiverId ?? ""}-No`;
                                        if (existingKeys.has(entryKey)) return;
                                        existingKeys.add(entryKey);
                                        const editedValue = payoutEdits[`${roleKey}-${slotId}`];
                                        const parsed = editedValue ? parsePercentage(editedValue) : null;
                                        const payoutPercentage = parsed ?? role.payoutPercentage ?? 0;
                                        const payoutTips = roundCurrency((payoutPercentage / 100) * baseOverallTips);
                                        const payoutGratuity = roundCurrency((payoutPercentage / 100) * baseOverallGratuity);
                                        newMemberEntries.push({
                                          employeeGuid: selection.id,
                                          employeeName: selection.name,
                                          jobTitle: role.receiverId ?? null,
                                          businessDate: currentSchedule.businessDate,
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
                                          overallTips: baseOverallTips,
                                          overallGratuity: baseOverallGratuity,
                                          payoutTips,
                                          payoutGratuity,
                                        });
                                      });
                                    });
                                    // Add from customReceivers (manually entered receivers)
                                    (customReceivers[scheduleKey] ?? []).forEach((entry) => {
                                      const name = entry.employeeName.trim();
                                      const jobTitle = entry.jobTitle.trim();
                                      if (!name || !jobTitle) return;
                                      const parsed = entry.payoutPercentage ? parsePercentage(entry.payoutPercentage) : null;
                                      if (parsed === null) return;
                                      const fallbackGuid = entry.employeeGuid ?? `custom-${entry.id}`;
                                      const entryKey = `${fallbackGuid}-${jobTitle}-No`;
                                      if (existingKeys.has(entryKey)) return;
                                      existingKeys.add(entryKey);
                                      const payoutTips = roundCurrency((parsed / 100) * baseOverallTips);
                                      const payoutGratuity = roundCurrency((parsed / 100) * baseOverallGratuity);
                                      newMemberEntries.push({
                                        employeeGuid: fallbackGuid,
                                        employeeName: name,
                                        jobTitle,
                                        businessDate: currentSchedule.businessDate,
                                        inTime: null,
                                        outTime: null,
                                        hoursWorked: 0,
                                        isContributor: "No",
                                        payoutReceiverId: jobTitle,
                                        payoutPercentage: parsed,
                                        totalSales: 0,
                                        netSales: 0,
                                        totalTips: 0,
                                        totalGratuity: 0,
                                        overallTips: baseOverallTips,
                                        overallGratuity: baseOverallGratuity,
                                        payoutTips,
                                        payoutGratuity,
                                      });
                                    });

                                    const preNormalizedSchedule = {
                                      ...scheduleWithRemovals,
                                      contributors: [...preUpdatedContributors, ...newMemberEntries],
                                    };

                                    // Build payload items SYNCHRONOUSLY before setSchedules
                                    // Pass originalPrepayoutTotal when employees are added or removed so values are recalculated
                                    const hasEmployeeChanges = removedForThisSchedule.length > 0 || newMemberEntries.length > 0;
                                    const savePayloadItems = buildApprovalItems(
                                      preNormalizedSchedule,
                                      hasEmployeeChanges ? originalPrepayoutTotal : undefined
                                    );
                                    const saveScheduleId = currentSchedule.payoutScheduleId;
                                    const saveBusinessDate = currentSchedule.businessDate;

                                    setSchedules((current) =>
                                      current.map((scheduleItem) => {
                                        const itemKey = `${scheduleItem.payoutScheduleId}-${scheduleItem.businessDate}`;
                                        if (itemKey !== scheduleKey) {
                                          return scheduleItem;
                                        }
                                        // Filter out removed employees from this schedule
                                        const filteredContributors = scheduleItem.contributors.filter((c) => {
                                          const empKey = `${scheduleKey}-${c.employeeGuid}-${c.jobTitle ?? "role"}`;
                                          return !removedEmployees.has(empKey);
                                        });
                                        const filteredSchedule = { ...scheduleItem, contributors: filteredContributors };
                                        const { overallTips, overallGratuity } = getOverallBase(filteredSchedule);
                                        const updatedContributors = filteredContributors.map((contributor) => {
                                          const isContributor = contributor.isContributor !== "No";
                                          const netKey = `${scheduleKey}-net-${contributor.employeeGuid}-${contributor.jobTitle ?? "role"}`;
                                          const payoutKey = `${scheduleKey}-${contributor.employeeGuid}-${contributor.jobTitle ?? "role"}`;
                                          const editedNet = netEdits[netKey];
                                          const editedPct = payoutEdits[payoutKey];

                                          // Check if net was edited - back-calculate percentage
                                          if (editedNet !== undefined) {
                                            const netValue = parseCurrency(editedNet) ?? 0;
                                            const prepayout = contributor.prepayoutDeduction || 0;
                                            const fee = contributor.payoutFee || 0;
                                            const totalPool = overallTips + overallGratuity;

                                            if (isContributor) {
                                              // For contributors: percentage = 100 * (Tips + Gratuity - Net - Prepayout - Fee) / (Tips + Gratuity)
                                              const contributorTips = Number(contributor.totalTips || 0);
                                              const contributorGratuity = Number(contributor.totalGratuity || 0);
                                              const contributorTotal = contributorTips + contributorGratuity;
                                              if (contributorTotal > 0) {
                                                const payoutAmount = contributorTotal - netValue - prepayout - fee;
                                                const newPercentage = roundCurrency((payoutAmount / contributorTotal) * 100);
                                                const payoutTips = roundCurrency(-(newPercentage / 100) * contributorTips);
                                                const payoutGratuity = roundCurrency(-(newPercentage / 100) * contributorGratuity);
                                                return {
                                                  ...contributor,
                                                  payoutPercentage: newPercentage,
                                                  payoutTips,
                                                  payoutGratuity,
                                                  netPayout: netValue,
                                                  overallTips,
                                                  overallGratuity,
                                                };
                                              }
                                            } else {
                                              // For receivers: percentage = 100 * (Net + Prepayout + Fee) / (overallTips + overallGratuity)
                                              if (totalPool > 0) {
                                                const grossPayout = netValue + prepayout + fee;
                                                const newPercentage = roundCurrency((grossPayout / totalPool) * 100);
                                                const payoutTips = roundCurrency((newPercentage / 100) * overallTips);
                                                const payoutGratuity = roundCurrency((newPercentage / 100) * overallGratuity);
                                                return {
                                                  ...contributor,
                                                  payoutPercentage: newPercentage,
                                                  payoutTips,
                                                  payoutGratuity,
                                                  netPayout: netValue,
                                                  overallTips,
                                                  overallGratuity,
                                                };
                                              }
                                            }
                                          }

                                          // Handle percentage edit for receivers (existing logic)
                                          if (!isContributor && editedPct !== undefined) {
                                            const parsed = parsePercentage(editedPct);
                                            if (parsed !== null) {
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
                                            }
                                          }

                                          return contributor;
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
                                        // Calculate the final values with proper deductions
                                        // Pass originalPrepayoutTotal when employees are added or removed so values are recalculated
                                        const hasEmployeeChangesInCallback = removedForThisSchedule.length > 0 || newEntries.length > 0 || customReceiverEntries.length > 0;
                                        const payloadItems = buildApprovalItems(
                                          normalizedSchedule,
                                          hasEmployeeChangesInCallback ? originalPrepayoutTotal : undefined
                                        );
                                        // Update contributors with recalculated values from buildApprovalItems
                                        const recalculatedContributors = payloadItems.map((item) => {
                                          // Find matching original contributor to preserve extra fields
                                          const original = normalizedSchedule.contributors.find(
                                            (c) =>
                                              c.employeeGuid === item.employeeGuid &&
                                              c.jobTitle === item.jobTitle &&
                                              c.isContributor === item.isContributor,
                                          );
                                          // Check if net was edited for this employee - preserve the edited value
                                          const netKey = `${scheduleKey}-net-${item.employeeGuid}-${item.jobTitle ?? "role"}`;
                                          const editedNet = netEdits[netKey];
                                          const finalNetPayout = editedNet !== undefined
                                            ? (parseCurrency(editedNet) ?? item.netPayout)
                                            : item.netPayout;
                                          return {
                                            ...original,
                                            ...item,
                                            netPayout: finalNetPayout,
                                          } as ApprovalContributor;
                                        });
                                        return {
                                          ...normalizedSchedule,
                                          contributors: recalculatedContributors,
                                        };
                                      }),
                                    );

                                    // Perform the save using synchronously built payload
                                    if (savePayloadItems && saveScheduleId && saveBusinessDate && userId !== null) {
                                      // Build removed employees payload
                                      const removedEmployeesPayload = removedForThisSchedule.map((c) => ({
                                        employeeGuid: c.employeeGuid,
                                        employeeName: c.employeeName,
                                        jobTitle: c.jobTitle,
                                      }));

                                      const saveResult = await saveApprovalOverrides({
                                        restaurantId,
                                        payoutScheduleId: saveScheduleId,
                                        businessDate: saveBusinessDate,
                                        userId,
                                        items: savePayloadItems,
                                        removedEmployees: removedEmployeesPayload.length > 0 ? removedEmployeesPayload : undefined,
                                      });
                                      if (!saveResult.success) {
                                        console.error("Failed to save:", saveResult.error);
                                        setValidationError(`Failed to save changes: ${saveResult.error}`);
                                        return;
                                      }
                                    }

                                    setEditingScheduleKey(null);
                                    setResetToken((current) => current + 1);
                                    setPayoutEdits({});
                                    setNetEdits({});
                                    setAddMemberSelections({});
                                    setAddMemberDropdowns({});
                                    setAddMemberSlots({});
                                    setCustomReceivers((current) => ({
                                      ...current,
                                      [scheduleKey]: [],
                                    }));
                                    setCustomReceiverDropdowns({});
                                    setRemovedEmployees(new Set());
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
                                    setNetEdits({});
                                    setAddMemberSelections({});
                                    setAddMemberDropdowns({});
                                    setAddMemberSlots({});
                                    setCustomReceivers((current) => ({
                                      ...current,
                                      [scheduleKey]: [],
                                    }));
                                    setCustomReceiverDropdowns({});
                                    setRemovedEmployees(new Set());
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
