import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import AppShell from "../components/AppShell";
import { useAuth } from "../providers/useAuth";
import { useSessionScope } from "../hooks/useSessionScope";
import {
  approvePayoutSchedule,
  fetchApprovals,
  saveApprovalOverrides,
  type ApprovalContributor,
  type ApprovalScheduleWithContributors,
  type ApprovalsResponse,
} from "../../core/api/approvals";
import { canAccessSection } from "../../core/auth/navigation";
import { defaultEmployeePermissions } from "../../core/auth/permissions";

const formatCurrency = (value: number) => {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
};

const formatValue = (value: string | null | undefined) => (value ? value : "N/A");

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

const roundCurrency = (value: number) => Math.round(value * 100) / 100;

const normalizeRoleKey = (value: string | null | undefined) =>
  (value || "").trim().toLowerCase();

const isManualReceiver = (receiver: ApprovalContributor) =>
  (receiver.isContributor || "").toLowerCase() === "no" &&
  Number(receiver.payoutPercentage || 0) > 0 &&
  Number(receiver.totalTips || 0) === 0 &&
  Number(receiver.totalGratuity || 0) === 0 &&
  receiver.inTime === null &&
  receiver.outTime === null;

const getOverallBase = (schedule: ApprovalScheduleWithContributors) => {
  const match = schedule.contributors.find(
    (contributor) => contributor.overallTips || contributor.overallGratuity,
  );
  return {
    overallTips: match?.overallTips ?? schedule.totalTips,
    overallGratuity: match?.overallGratuity ?? schedule.totalGratuity,
  };
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
      !isContributor && receiverRoleCount > 0 ? rolePercentageTotal / receiverRoleCount : 0;
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

const ApprovalsScreen = () => {
  const { session } = useAuth();
  const permissions = session?.permissions ?? defaultEmployeePermissions;
  const canView = canAccessSection(permissions, "approvals");
  const scope = useSessionScope();
  const userId = scope?.userId ?? null;
  const restaurantId = scope?.restaurantId ?? null;
  const [schedules, setSchedules] = useState<ApprovalScheduleWithContributors[]>([]);
  const [expandedScheduleKeys, setExpandedScheduleKeys] = useState<Set<string>>(new Set());
  const [expandedEmployees, setExpandedEmployees] = useState<Record<string, boolean>>({});
  const [approvedScheduleKeys, setApprovedScheduleKeys] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [approvingKey, setApprovingKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const applyApprovals = (data: ApprovalsResponse) => {
    const sortedSchedules = sortSchedulesByDate(data.schedules);
    setSchedules(sortedSchedules);
    setExpandedScheduleKeys(new Set());
    setApprovedScheduleKeys(
      new Set(
        sortedSchedules
          .filter((item) => item.isApproved)
          .map((item) => `${item.payoutScheduleId}-${item.businessDate}`),
      ),
    );
  };

  const refreshApprovals = async (currentRestaurantId: number, currentUserId: number) => {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const data = await fetchApprovals(currentRestaurantId, currentUserId);
      applyApprovals(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load approvals.";
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let isMounted = true;
    if (!restaurantId || !userId) {
      setIsLoading(false);
      return () => {
        isMounted = false;
      };
    }
    fetchApprovals(restaurantId, userId)
      .then((data) => {
        if (isMounted) {
          applyApprovals(data);
        }
      })
      .catch((error) => {
        if (isMounted) {
          setErrorMessage(error instanceof Error ? error.message : "Failed to load approvals.");
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

  const toggleExpandAll = () => {
    setExpandedScheduleKeys((current) => {
      const allExpanded = schedules.length > 0 && current.size === schedules.length;
      if (allExpanded) {
        return new Set();
      }
      return new Set(
        schedules.map((schedule) => `${schedule.payoutScheduleId}-${schedule.businessDate}`),
      );
    });
  };

  const handleApprove = async (schedule: ApprovalScheduleWithContributors) => {
    if (!restaurantId || !userId || !schedule.businessDate) {
      return;
    }
    const scheduleKey = `${schedule.payoutScheduleId}-${schedule.businessDate}`;
    setApprovingKey(scheduleKey);
    setErrorMessage("");
    try {
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
        setApprovedScheduleKeys((current) => {
          const next = new Set(current);
          next.add(scheduleKey);
          return next;
        });
        await refreshApprovals(restaurantId, userId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to approve schedule.";
      setErrorMessage(message);
    } finally {
      setApprovingKey(null);
    }
  };

  if (!canView) {
    return (
      <AppShell>
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionTitle}>Approvals</Text>
          <Text style={styles.permissionText}>You do not have access to approvals.</Text>
        </View>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text style={styles.pageTitle}>Approvals</Text>
            <Text style={styles.pageSubtitle}>
              Read-only payout summaries by contributor. {contributorCountLabel}
            </Text>
            <View style={styles.infoBanner}>
              <Text style={styles.infoBannerText}>
                Approved payouts are queued and processed during the nightly debit and payout jobs.
              </Text>
            </View>
          </View>
          <Pressable style={styles.expandButton} onPress={toggleExpandAll}>
            <Text style={styles.expandButtonText}>
              {expandedScheduleKeys.size === schedules.length && schedules.length > 0
                ? "Collapse All"
                : "Expand All"}
            </Text>
          </Pressable>
        </View>

        {errorMessage ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        {isLoading ? (
          <View style={styles.card}>
            <ActivityIndicator size={20} />
            <Text style={styles.loadingText}>Loading approval details...</Text>
          </View>
        ) : schedules.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.loadingText}>No approvals to show yet.</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {schedules.map((schedule) => {
              const scheduleKey = `${schedule.payoutScheduleId}-${schedule.businessDate}`;
              const isExpanded = expandedScheduleKeys.has(scheduleKey);
              const isApproved = approvedScheduleKeys.has(scheduleKey);
              const dayLabel = getBusinessDayLabel(schedule.businessDate);
              const totalReceiverPercentage = getReceiverPercentSum(schedule);
              const { overallTips, overallGratuity } = getOverallBase(schedule);
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
                  (a.jobTitle || "").localeCompare(b.jobTitle || "", undefined, { sensitivity: "base" }),
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
              const missingRoles = getMissingRoles(schedule);
              return (
                <View key={scheduleKey} style={styles.scheduleCard}>
                  <Pressable
                    onPress={() => {
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
                  >
                    <Text style={styles.scheduleTitle}>
                      {schedule.name ?? "Payout Schedule"}
                      {schedule.businessDate ? ` (${schedule.businessDate})` : ""}
                    </Text>
                    {dayLabel ? <Text style={styles.scheduleSubtitle}>{dayLabel}</Text> : null}
                    <View style={styles.chipRow}>
                      <View style={styles.chip}>
                        <Text style={styles.chipText}>{schedule.payoutRuleLabel}</Text>
                      </View>
                      <View style={styles.chip}>
                        <Text style={styles.chipText}>Contributors: {schedule.contributorCount}</Text>
                      </View>
                      <View style={styles.chip}>
                        <Text style={styles.chipText}>Receivers: {schedule.receiverCount}</Text>
                      </View>
                    </View>
                  </Pressable>

                  <View style={styles.actionRow}>
                    <Pressable
                      style={[styles.primaryButton, isApproved && styles.buttonDisabled]}
                      disabled={isApproved || approvingKey === scheduleKey}
                      onPress={() => void handleApprove(schedule)}
                    >
                      <Text style={styles.primaryButtonText}>
                        {approvingKey === scheduleKey ? "Approving..." : "Approve"}
                      </Text>
                    </Pressable>
                  </View>

                  <View style={styles.summaryRow}>
                    <View style={styles.summaryBlock}>
                      <Text style={styles.summaryLabel}>Sales</Text>
                      <Text style={styles.summaryValue}>
                        Total: {formatCurrency(schedule.totalSales)} | Net: {formatCurrency(schedule.netSales)}
                      </Text>
                    </View>
                    <View style={styles.summaryBlock}>
                      <Text style={styles.summaryLabel}>Tips &amp; Gratuity</Text>
                      <Text style={styles.summaryValue}>
                        Tips: {formatCurrency(schedule.totalTips)} | Gratuity:{" "}
                        {formatCurrency(schedule.totalGratuity)} | Total:{" "}
                        {formatCurrency(schedule.totalTips + schedule.totalGratuity)}
                      </Text>
                    </View>
                    <View style={styles.summaryBlock}>
                      <Text style={styles.summaryLabel}>Orders</Text>
                      <Text style={styles.summaryValue}>
                        {(schedule.orderCount ?? 0).toLocaleString()}
                      </Text>
                    </View>
                  </View>

                  {isExpanded ? (
                    <View style={styles.detailsSection}>
                      <View style={styles.sectionBlock}>
                        <Text style={styles.sectionTitle}>Contributors</Text>
                        {contributors.length === 0 ? (
                          <Text style={styles.emptyText}>No contributors assigned.</Text>
                        ) : (
                          contributors.map((contributor, index) => {
                            const employeeKey = `${scheduleKey}-${contributor.employeeGuid ?? "employee"}-${index}`;
                            const isExpandedEmployee = Boolean(expandedEmployees[employeeKey]);
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
                                payoutTipsDisplay + payoutGratuityDisplay,
                              ),
                            );
                            return (
                              <View key={employeeKey} style={styles.personCard}>
                                <Pressable
                                  onPress={() =>
                                    setExpandedEmployees((current) => ({
                                      ...current,
                                      [employeeKey]: !current[employeeKey],
                                    }))
                                  }
                                >
                                  <Text style={styles.personName}>
                                    {contributor.employeeName}
                                    {contributor.jobTitle ? ` (${contributor.jobTitle})` : ""}
                                  </Text>
                                  <View style={styles.metricRow}>
                                    <View style={styles.metricChip}>
                                      <Text style={styles.metricText}>
                                        Tips: {formatCurrency(contributor.totalTips)}
                                      </Text>
                                    </View>
                                    <View style={styles.metricChip}>
                                      <Text style={styles.metricText}>
                                        Gratuity: {formatCurrency(contributor.totalGratuity)}
                                      </Text>
                                    </View>
                                    <View style={styles.metricChip}>
                                      <Text style={styles.metricText}>
                                        Total:{" "}
                                        {formatCurrency(contributor.totalTips + contributor.totalGratuity)}
                                      </Text>
                                    </View>
                                    <View style={styles.metricChip}>
                                      <Text style={styles.metricText}>
                                        Payout: {payoutPercentageDisplay.toFixed(2)}% (
                                        {formatCurrency(payoutDisplay)})
                                      </Text>
                                    </View>
                                    <View style={styles.metricChip}>
                                      <Text style={styles.metricText}>
                                        Net Payout: {formatCurrency(netPayoutDisplay)}
                                      </Text>
                                    </View>
                                  </View>
                                  {contributor.employeeGuid ? (
                                    <Text style={styles.guidText}>{contributor.employeeGuid}</Text>
                                  ) : null}
                                </Pressable>

                                {isExpandedEmployee ? (
                                  <View style={styles.personDetails}>
                                    <View style={styles.detailRow}>
                                      <Text style={styles.detailLabel}>In/Out time</Text>
                                      <Text style={styles.detailValue}>
                                        In: {formatValue(contributor.inTime)} | Out:{" "}
                                        {formatValue(contributor.outTime)}
                                      </Text>
                                    </View>
                                    <View style={styles.detailRow}>
                                      <Text style={styles.detailLabel}>Hours worked</Text>
                                      <Text style={styles.detailValue}>
                                        {contributor.hoursWorked ? contributor.hoursWorked.toFixed(2) : "0.00"}
                                      </Text>
                                    </View>
                                    <View style={styles.detailRow}>
                                      <Text style={styles.detailLabel}>Sales</Text>
                                      <Text style={styles.detailValue}>
                                        Total: {formatCurrency(contributor.totalSales)} | Net:{" "}
                                        {formatCurrency(contributor.netSales)}
                                      </Text>
                                    </View>
                                    <View style={styles.detailRow}>
                                      <Text style={styles.detailLabel}>Orders</Text>
                                      <Text style={styles.detailValue}>
                                        {(contributor.orderCount ?? 0).toLocaleString()}
                                      </Text>
                                    </View>
                                    <View style={styles.detailRow}>
                                      <Text style={styles.detailLabel}>Payout details</Text>
                                      <Text style={styles.detailValue}>
                                        Tips: {formatCurrency(contributor.totalTips)} | Gratuity:{" "}
                                        {formatCurrency(contributor.totalGratuity)} | Total:{" "}
                                        {formatCurrency(contributor.totalTips + contributor.totalGratuity)}
                                      </Text>
                                      <Text style={styles.detailValue}>
                                        Payout Tips: {formatCurrency(Math.abs(payoutTipsDisplay))} | Payout
                                        Gratuity: {formatCurrency(Math.abs(payoutGratuityDisplay))} | Payout
                                        Total:{" "}
                                        {formatCurrency(Math.abs(payoutTipsDisplay + payoutGratuityDisplay))}
                                      </Text>
                                      <Text style={styles.detailValue}>
                                        Net Payout: {formatCurrency(netPayoutDisplay)}
                                      </Text>
                                    </View>
                                  </View>
                                ) : null}
                              </View>
                            );
                          })
                        )}
                      </View>

                      <View style={styles.sectionBlock}>
                        <Text style={styles.sectionTitle}>Receivers</Text>
                        {receivers.length === 0 && missingRoles.length === 0 ? (
                          <Text style={styles.emptyText}>No receivers assigned.</Text>
                        ) : (
                          <>
                            {receivers.map((receiver, index) => {
                              const employeeKey = `${scheduleKey}-${receiver.employeeGuid ?? "receiver"}-${index}`;
                              const isExpandedEmployee = Boolean(expandedEmployees[employeeKey]);
                              const receiverRoleKey = normalizeRoleKey(
                                receiver.jobTitle ?? receiver.payoutReceiverId,
                              );
                              const receiverRoleCount = receiverRoleCounts[receiverRoleKey] ?? 0;
                              const rolePercentageTotal = receiverRolePercentages[receiverRoleKey] ?? 0;
                              const receiverSharePercentage =
                                receiverRoleCount > 0 ? rolePercentageTotal / receiverRoleCount : 0;
                              const receiverPayoutPercentage = isManualReceiver(receiver)
                                ? Number(receiver.payoutPercentage || 0)
                                : receiverSharePercentage;
                              const hasHoursWorked =
                                isManualReceiver(receiver) || (receiver.hoursWorked ?? 0) > 0;
                              const payoutTipsDisplay = hasHoursWorked
                                ? roundCurrency((receiverPayoutPercentage / 100) * overallTips)
                                : 0;
                              const payoutGratuityDisplay = hasHoursWorked
                                ? roundCurrency((receiverPayoutPercentage / 100) * overallGratuity)
                                : 0;
                              const payoutAmount = payoutTipsDisplay + payoutGratuityDisplay;
                              const payoutDisplay = Math.max(0, payoutAmount);
                              const netPayoutDisplay = Math.max(
                                0,
                                getNetPayout(
                                  receiver.isContributor,
                                  receiver.totalTips,
                                  receiver.totalGratuity,
                                  payoutAmount,
                                ),
                              );
                              const payoutPercentageDisplay = hasHoursWorked ? receiverPayoutPercentage : 0;
                              return (
                                <View key={employeeKey} style={styles.personCard}>
                                  <Pressable
                                    onPress={() =>
                                      setExpandedEmployees((current) => ({
                                        ...current,
                                        [employeeKey]: !current[employeeKey],
                                      }))
                                    }
                                  >
                                    <Text style={styles.personName}>
                                      {receiver.employeeName}
                                      {receiver.jobTitle ? ` (${receiver.jobTitle})` : ""}
                                    </Text>
                                    <View style={styles.metricRow}>
                                      <View style={styles.metricChip}>
                                        <Text style={styles.metricText}>
                                          Payout: {payoutPercentageDisplay.toFixed(2)}% (
                                          {formatCurrency(payoutDisplay)})
                                        </Text>
                                      </View>
                                      <View style={styles.metricChip}>
                                        <Text style={styles.metricText}>
                                          Net Payout: {formatCurrency(netPayoutDisplay)}
                                        </Text>
                                      </View>
                                    </View>
                                  </Pressable>

                                  {isExpandedEmployee ? (
                                    <View style={styles.personDetails}>
                                      <View style={styles.detailRow}>
                                        <Text style={styles.detailLabel}>Payout details</Text>
                                        <Text style={styles.detailValue}>
                                          Tips: {formatCurrency(payoutTipsDisplay)} | Gratuity:{" "}
                                          {formatCurrency(payoutGratuityDisplay)} | Total:{" "}
                                          {formatCurrency(payoutAmount)}
                                        </Text>
                                      </View>
                                      <View style={styles.detailRow}>
                                        <Text style={styles.detailLabel}>Net payout</Text>
                                        <Text style={styles.detailValue}>
                                          {formatCurrency(netPayoutDisplay)}
                                        </Text>
                                      </View>
                                    </View>
                                  ) : null}
                                </View>
                              );
                            })}
                            {missingRoles.map((role) => (
                              <View key={`${scheduleKey}-missing-${role.receiverId}`} style={styles.missingRole}>
                                <Text style={styles.missingRoleText}>
                                  No employee assigned for {role.receiverId}.
                                </Text>
                              </View>
                            ))}
                          </>
                        )}
                      </View>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </AppShell>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: "#f4f2ee",
  },
  permissionContainer: {
    flex: 1,
    padding: 20,
    justifyContent: "center",
  },
  permissionTitle: {
    fontSize: 22,
    fontWeight: "600",
    color: "#111827",
  },
  permissionText: {
    marginTop: 8,
    color: "#6b7280",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 16,
    gap: 12,
  },
  headerText: {
    flex: 1,
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: "400",
    color: "#111827",
  },
  pageSubtitle: {
    marginTop: 6,
    fontSize: 12,
    color: "#6b7280",
  },
  infoBanner: {
    marginTop: 12,
    backgroundColor: "#fef3c7",
    borderColor: "#fcd34d",
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  infoBannerText: {
    fontSize: 12,
    color: "#92400e",
    fontWeight: "600",
  },
  expandButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d1d5db",
    backgroundColor: "#ffffff",
  },
  expandButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#111827",
  },
  errorBanner: {
    backgroundColor: "#fef2f2",
    borderColor: "#fecaca",
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  errorText: {
    color: "#b91c1c",
    fontSize: 12,
    fontWeight: "600",
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    padding: 16,
    alignItems: "center",
    gap: 8,
  },
  loadingText: {
    color: "#6b7280",
    fontSize: 12,
  },
  list: {
    gap: 16,
  },
  scheduleCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
  },
  scheduleTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
  },
  scheduleSubtitle: {
    marginTop: 4,
    fontSize: 12,
    color: "#6b7280",
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  chipText: {
    fontSize: 11,
    color: "#111827",
  },
  actionRow: {
    marginTop: 12,
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  primaryButton: {
    backgroundColor: "#cab99a",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  primaryButtonText: {
    color: "#111827",
    fontWeight: "600",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  summaryRow: {
    marginTop: 12,
    gap: 10,
  },
  summaryBlock: {
    gap: 4,
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#6b7280",
    textTransform: "uppercase",
  },
  summaryValue: {
    fontSize: 12,
    color: "#374151",
  },
  detailsSection: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#f3f4f6",
    paddingTop: 16,
    gap: 16,
  },
  sectionBlock: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
  },
  emptyText: {
    fontSize: 12,
    color: "#6b7280",
  },
  personCard: {
    backgroundColor: "#f4f2ee",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    padding: 12,
  },
  personName: {
    fontSize: 13,
    fontWeight: "600",
    color: "#111827",
  },
  metricRow: {
    marginTop: 8,
    gap: 6,
  },
  metricChip: {
    backgroundColor: "#ffffff",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  metricText: {
    fontSize: 11,
    color: "#111827",
  },
  guidText: {
    marginTop: 6,
    fontSize: 10,
    color: "#6b7280",
  },
  personDetails: {
    marginTop: 10,
    gap: 8,
  },
  detailRow: {
    gap: 4,
  },
  detailLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#6b7280",
    textTransform: "uppercase",
  },
  detailValue: {
    fontSize: 11,
    color: "#374151",
  },
  missingRole: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderStyle: "dashed",
    borderRadius: 10,
    padding: 12,
    backgroundColor: "#ffffff",
  },
  missingRoleText: {
    fontSize: 12,
    color: "#6b7280",
  },
});

export default ApprovalsScreen;
