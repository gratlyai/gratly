import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import AppShell from "../components/AppShell";
import { useAuth } from "../providers/useAuth";
import { useSessionScope } from "../hooks/useSessionScope";
import {
  activatePayoutSchedule,
  createPayoutSchedule,
  deletePayoutSchedule,
  fetchJobTitles,
  fetchPayoutScheduleDetail,
  fetchPayoutSchedules,
  updatePayoutSchedule,
  type PayoutScheduleDetail,
  type PayoutScheduleRow,
} from "../../core/api/payoutSchedules";
import { canAccessSection } from "../../core/auth/navigation";
import { defaultEmployeePermissions } from "../../core/auth/permissions";

type ViewMode = "existing" | "create";

type PrePayoutEntry = {
  type: "Fixed Amount" | "Percentage" | "";
  value: string;
  account: string;
};

type Fund = {
  name: string;
  selected: boolean;
  percentage: number;
};

const payoutRuleOptions = [
  "Job Weighted Payout",
  "Equal Payout",
  "Hour Based Payout",
  "Custom Payout",
];
const dayOptions = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const timeOptions = Array.from({ length: 96 }, (_, index) => {
  const hour = Math.floor(index / 4);
  const minute = (index % 4) * 15;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
});

const formatTimeLabel = (value: string): string => {
  if (!value) {
    return "";
  }
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return value;
  }
  const period = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHours}:${String(minutes).padStart(2, "0")} ${period}`;
};

const payoutRuleLabel = (ruleId: string | null) => {
  switch (ruleId) {
    case "1":
      return "Custom Payout";
    case "2":
      return "Equal Payout";
    case "3":
      return "Hour Based Payout";
    case "4":
      return "Job Weighted Payout";
    default:
      return "—";
  }
};

const payoutRuleFromLabel = (ruleId: string | null) => {
  switch (ruleId) {
    case "1":
      return "Custom Payout";
    case "2":
      return "Equal Payout";
    case "3":
      return "Hour Based Payout";
    case "4":
      return "Job Weighted Payout";
    default:
      return "Job Weighted Payout";
  }
};

const ShiftPayoutScreen = () => {
  const { session } = useAuth();
  const scope = useSessionScope();
  const permissions = session?.permissions ?? defaultEmployeePermissions;
  const canView = canAccessSection(permissions, "shift-payout");
  const [activeView, setActiveView] = useState<ViewMode>("existing");
  const [schedules, setSchedules] = useState<PayoutScheduleRow[]>([]);
  const [isLoadingSchedules, setIsLoadingSchedules] = useState(false);
  const [schedulesError, setSchedulesError] = useState("");
  const [selectedScheduleId, setSelectedScheduleId] = useState<number | null>(null);
  const [expandedScheduleId, setExpandedScheduleId] = useState<number | null>(null);
  const [expandedScheduleDetails, setExpandedScheduleDetails] = useState<
    Record<number, PayoutScheduleDetail>
  >({});
  const [loadingExpandedDetails, setLoadingExpandedDetails] = useState<Record<number, boolean>>({});
  const [isDeleting, setIsDeleting] = useState(false);
  const [isActivating, setIsActivating] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState("");
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState("");
  const [jobTitles, setJobTitles] = useState<string[]>([]);
  const [showInactiveSchedules, setShowInactiveSchedules] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);

  const [formName, setFormName] = useState("");
  const [startDay, setStartDay] = useState("");
  const [endDay, setEndDay] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [fundsFrom, setFundsFrom] = useState<Fund[]>([
    { name: "Gratuity", selected: true, percentage: 100 },
    { name: "Tips", selected: true, percentage: 100 },
  ]);
  const [payoutRule, setPayoutRule] = useState("Job Weighted Payout");
  const [payoutContributors, setPayoutContributors] = useState<string[]>([]);
  const [payoutReceivers, setPayoutReceivers] = useState<string[]>([]);
  const [receiverPercentages, setReceiverPercentages] = useState<Record<string, string>>({});
  const [customIndividualContribution, setCustomIndividualContribution] = useState("");
  const [customGroupContribution, setCustomGroupContribution] = useState("");
  const [prePayouts, setPrePayouts] = useState<PrePayoutEntry[]>([]);
  const [editingScheduleId, setEditingScheduleId] = useState<number | null>(null);
  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [showStartDayOptions, setShowStartDayOptions] = useState(false);
  const [showEndDayOptions, setShowEndDayOptions] = useState(false);
  const [showStartTimeOptions, setShowStartTimeOptions] = useState(false);
  const [showEndTimeOptions, setShowEndTimeOptions] = useState(false);
  const [showContributorDropdown, setShowContributorDropdown] = useState(false);
  const [showReceiverDropdown, setShowReceiverDropdown] = useState(false);
  const [contributorSearch, setContributorSearch] = useState("");
  const [receiverSearch, setReceiverSearch] = useState("");

  const userId = scope?.userId ?? null;
  const restaurantId = scope?.restaurantId ?? null;

  const payoutPercentTargets = useMemo(
    () => Array.from(new Set([...payoutContributors, ...payoutReceivers])),
    [payoutContributors, payoutReceivers],
  );

  const contributorPercentage = useMemo(() => {
    if (payoutContributors.length === 0) return 0;
    return Number(receiverPercentages[payoutContributors[0]] ?? 0);
  }, [payoutContributors, receiverPercentages]);

  const receiverPercentageTotal = useMemo(() => {
    return payoutReceivers
      .filter((receiver) => !payoutContributors.includes(receiver))
      .reduce((sum, receiver) => {
        const value = Number(receiverPercentages[receiver] ?? 0);
        return sum + (Number.isFinite(value) ? value : 0);
      }, 0);
  }, [payoutReceivers, payoutContributors, receiverPercentages]);

  const totalPercentage = useMemo(() => {
    return (payoutContributors.length > 0 ? contributorPercentage : 0) + receiverPercentageTotal;
  }, [payoutContributors, contributorPercentage, receiverPercentageTotal]);

  const resetForm = () => {
    setFormName("");
    setStartDay("");
    setEndDay("");
    setStartTime("");
    setEndTime("");
    setFundsFrom([
      { name: "Gratuity", selected: true, percentage: 100 },
      { name: "Tips", selected: true, percentage: 100 },
    ]);
    setPayoutRule("Job Weighted Payout");
    setPayoutContributors([]);
    setPayoutReceivers([]);
    setReceiverPercentages({});
    setCustomIndividualContribution("");
    setCustomGroupContribution("");
    setPrePayouts([]);
    setEditingScheduleId(null);
    setSubmitError("");
    setSubmitSuccess("");
    setContributorSearch("");
    setReceiverSearch("");
  };

  const loadSchedules = useCallback(async () => {
    if (userId === null || restaurantId === null) {
      return;
    }
    setIsLoadingSchedules(true);
    setSchedulesError("");
    try {
      const data = await fetchPayoutSchedules(userId, restaurantId, showInactiveSchedules);
      setSchedules(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load schedules.";
      setSchedulesError(message);
    } finally {
      setIsLoadingSchedules(false);
    }
  }, [restaurantId, userId, showInactiveSchedules]);

  useEffect(() => {
    if (activeView === "existing") {
      void loadSchedules();
    }
  }, [activeView, loadSchedules]);

  useEffect(() => {
    if (userId === null || restaurantId === null) {
      return;
    }
    fetchJobTitles(userId, restaurantId)
      .then((titles) => setJobTitles(titles))
      .catch((error) => {
        console.warn("Failed to load job titles:", error);
      });
  }, [restaurantId, userId]);

  const toggleScheduleExpanded = async (scheduleId: number) => {
    const isCurrentlyExpanded = expandedScheduleId === scheduleId;
    setExpandedScheduleId((prev) => (prev === scheduleId ? null : scheduleId));

    if (!isCurrentlyExpanded && !expandedScheduleDetails[scheduleId] && userId && restaurantId) {
      setLoadingExpandedDetails((prev) => ({ ...prev, [scheduleId]: true }));
      try {
        const detail = await fetchPayoutScheduleDetail(scheduleId, userId, restaurantId);
        setExpandedScheduleDetails((prev) => ({ ...prev, [scheduleId]: detail }));
      } catch (error) {
        console.error("Failed to load schedule details:", error);
      } finally {
        setLoadingExpandedDetails((prev) => ({ ...prev, [scheduleId]: false }));
      }
    }
  };

  const handleDeleteSchedule = async () => {
    if (!selectedScheduleId || userId === null || restaurantId === null) {
      return;
    }
    setIsDeleting(true);
    setDeleteMessage("");
    try {
      await deletePayoutSchedule(selectedScheduleId, userId, restaurantId);
      setDeleteMessage("Schedule archived.");
      setSelectedScheduleId(null);
      setExpandedScheduleId(null);
      await loadSchedules();
      setTimeout(() => setDeleteMessage(""), 3000);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to archive schedule.";
      setDeleteMessage(message);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleActivateSchedule = async (scheduleId: number) => {
    if (userId === null) {
      return;
    }
    setIsActivating(true);
    setDeleteMessage("");
    try {
      await activatePayoutSchedule(scheduleId, userId);
      setDeleteMessage("Schedule activated.");
      setExpandedScheduleId(null);
      await loadSchedules();
      setTimeout(() => setDeleteMessage(""), 3000);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to activate schedule.";
      setDeleteMessage(message);
    } finally {
      setIsActivating(false);
    }
  };

  const loadScheduleDetails = async (scheduleId: number) => {
    if (userId === null || restaurantId === null) {
      return;
    }
    setIsLoadingDetails(true);
    setDetailsError("");
    try {
      const detail: PayoutScheduleDetail = await fetchPayoutScheduleDetail(
        scheduleId,
        userId,
        restaurantId,
      );
      setFormName(detail.name ?? "");
      setStartDay(detail.start_day ?? "");
      setEndDay(detail.end_day ?? "");
      setStartTime(detail.start_time ?? "");
      setEndTime(detail.end_time ?? "");
      setPayoutRule(payoutRuleFromLabel(detail.payout_rule_id ?? null));

      setFundsFrom((prev) =>
        prev.map((fund) => {
          const key = fund.name.toLowerCase();
          const triggerValue =
            key === "gratuity"
              ? detail.payout_triggers?.gratuity
              : key === "tips"
                ? detail.payout_triggers?.tips
                : undefined;
          return {
            ...fund,
            percentage:
              typeof triggerValue === "number" && Number.isFinite(triggerValue)
                ? triggerValue
                : fund.percentage,
          };
        }),
      );

      const contributors: string[] = [];
      const receivers: string[] = [];
      const percentages: Record<string, string> = {};
      (detail.payout_receivers || []).forEach((receiver) => {
        if (!receiver.payout_receiver_id) {
          return;
        }
        const isReceiver =
          receiver.contributor_receiver === 1 ||
          receiver.contributor_receiver === true ||
          receiver.contributor_receiver === null ||
          receiver.contributor_receiver === undefined;
        if (isReceiver) {
          if (!receivers.includes(receiver.payout_receiver_id)) {
            receivers.push(receiver.payout_receiver_id);
          }
        } else if (!contributors.includes(receiver.payout_receiver_id)) {
          contributors.push(receiver.payout_receiver_id);
        }
        percentages[receiver.payout_receiver_id] =
          receiver.payout_percentage !== null && receiver.payout_percentage !== undefined
            ? String(receiver.payout_percentage)
            : "";
      });
      setPayoutContributors(contributors);
      setPayoutReceivers(receivers);
      setReceiverPercentages(percentages);
      setCustomIndividualContribution(
        detail.custom_individual_payout !== null && detail.custom_individual_payout !== undefined
          ? String(detail.custom_individual_payout)
          : "",
      );
      setCustomGroupContribution(
        detail.custom_group_contribution !== null && detail.custom_group_contribution !== undefined
          ? String(detail.custom_group_contribution)
          : "",
      );
      setPrePayouts(
        (detail.pre_payouts || []).map((entry) => ({
          type: Number(entry.pre_payout_option) === 1 ? "Fixed Amount" : "Percentage",
          value:
            entry.pre_payout_value !== null && entry.pre_payout_value !== undefined
              ? String(entry.pre_payout_value)
              : "",
          account: entry.user_account ?? "",
        })),
      );
      setEditingScheduleId(scheduleId);
      setActiveView("create");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load schedule.";
      setDetailsError(message);
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const updateFundPercentage = (index: number, value: string) => {
    const numericValue = Number(value);
    setFundsFrom((prev) =>
      prev.map((fund, idx) =>
        idx === index
          ? { ...fund, percentage: Number.isFinite(numericValue) ? numericValue : 0 }
          : fund,
      ),
    );
  };

  const toggleContributor = (title: string) => {
    setPayoutContributors((prev) =>
      prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title],
    );
  };

  const toggleReceiver = (title: string) => {
    setPayoutReceivers((prev) =>
      prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title],
    );
  };

  const handleReceiverPercentageChange = (name: string, value: string) => {
    if (payoutContributors.includes(name)) {
      // For contributors, update all contributors with the same value
      setReceiverPercentages((prev) => {
        const updated = { ...prev };
        payoutContributors.forEach((contributor) => {
          updated[contributor] = value;
        });
        return updated;
      });
    } else {
      setReceiverPercentages((prev) => ({ ...prev, [name]: value }));
    }
  };

  const addPrePayout = () => {
    setPrePayouts((prev) => [...prev, { type: "", value: "", account: "" }]);
  };

  const updatePrePayout = (index: number, next: Partial<PrePayoutEntry>) => {
    setPrePayouts((prev) =>
      prev.map((entry, idx) => (idx === index ? { ...entry, ...next } : entry)),
    );
  };

  const removePrePayout = (index: number) => {
    setPrePayouts((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSubmit = async () => {
    if (userId === null || restaurantId === null) {
      return;
    }
    if (!formName.trim()) {
      setSubmitError("Schedule name is required.");
      return;
    }

    // Validate percentages for Custom or Job Weighted Payout
    if (
      (payoutRule === "Custom Payout" || payoutRule === "Job Weighted Payout") &&
      payoutPercentTargets.length > 0
    ) {
      if (Math.abs(totalPercentage - 100) > 0.01) {
        setSubmitError("Contributor percentage + sum of receiver percentages must total 100%.");
        return;
      }
    }

    setIsSubmitting(true);
    setSubmitError("");
    setSubmitSuccess("");

    const gratuityTrigger = fundsFrom.find((f) => f.name.toLowerCase() === "gratuity")?.percentage;
    const tipsTrigger = fundsFrom.find((f) => f.name.toLowerCase() === "tips")?.percentage;

    const payoutPercentages: Record<string, number | null> = {};
    Object.entries(receiverPercentages).forEach(([key, value]) => {
      const parsed = Number(value);
      payoutPercentages[key] = Number.isFinite(parsed) ? parsed : null;
    });

    const payload = {
      user_id: userId,
      restaurant_id: restaurantId,
      name: formName.trim(),
      start_day: startDay || null,
      end_day: endDay || null,
      start_time: startTime || null,
      end_time: endTime || null,
      payout_triggers: {
        gratuity: gratuityTrigger ?? null,
        tips: tipsTrigger ?? null,
      },
      payout_rule: payoutRule,
      payout_contributors: payoutContributors,
      payout_receivers: payoutReceivers,
      payout_percentages: payoutPercentages,
      custom_individual_payout: customIndividualContribution
        ? Number(customIndividualContribution)
        : null,
      custom_group_contribution: customGroupContribution ? Number(customGroupContribution) : null,
      pre_payouts: prePayouts
        .filter((entry) => entry.type && entry.value && entry.account)
        .map((entry) => ({
          option: entry.type,
          value: entry.value ? Number(entry.value) : null,
          account: entry.account,
        })),
    };

    try {
      if (editingScheduleId) {
        await updatePayoutSchedule(editingScheduleId, payload);
        setSubmitSuccess("Schedule updated.");
      } else {
        await createPayoutSchedule(payload);
        setSubmitSuccess("Schedule created.");
      }
      await loadSchedules();
      setActiveView("existing");
      resetForm();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save schedule.";
      setSubmitError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatDayRange = (start: string | null, end: string | null) => {
    if (!start && !end) return "—";
    if (start && end) return `${start} - ${end}`;
    return start || end || "—";
  };

  const formatTimeRange = (start: string | null, end: string | null) => {
    if (!start && !end) return "—";
    if (start && end) return `${start} - ${end}`;
    return start || end || "—";
  };

  const groupedJobTitles = useMemo(() => {
    const list = jobTitles.length ? jobTitles : ["Server", "Host", "Bartender", "Runner"];
    return list.sort((a, b) => a.localeCompare(b));
  }, [jobTitles]);

  const filteredContributors = useMemo(() => {
    const search = contributorSearch.trim().toLowerCase();
    if (!search) return groupedJobTitles;
    return groupedJobTitles.filter((t) => t.toLowerCase().includes(search));
  }, [groupedJobTitles, contributorSearch]);

  const filteredReceivers = useMemo(() => {
    const search = receiverSearch.trim().toLowerCase();
    if (!search) return groupedJobTitles;
    return groupedJobTitles.filter((t) => t.toLowerCase().includes(search));
  }, [groupedJobTitles, receiverSearch]);

  if (!canView) {
    return (
      <AppShell>
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionTitle}>Shift Payout</Text>
          <Text style={styles.permissionText}>
            You do not have access to Shift Payout schedules.
          </Text>
        </View>
      </AppShell>
    );
  }

  return (
    <AppShell>
      {/* Delete Confirmation Modal */}
      <Modal visible={isDeleteConfirmOpen} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Archive schedule?</Text>
            <Text style={styles.modalText}>
              This action cannot be undone. Are you sure you want to archive this payout schedule?
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => setIsDeleteConfirmOpen(false)}
              >
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.primaryButton}
                onPress={() => {
                  setIsDeleteConfirmOpen(false);
                  void handleDeleteSchedule();
                }}
              >
                <Text style={styles.primaryButtonText}>Yes, archive</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <ScrollView contentContainerStyle={styles.container}>
        {activeView === "existing" ? (
          <>
            <View style={styles.headerSection}>
              <Text style={styles.pageTitle}>Shift Payout Schedules</Text>
              <Text style={styles.pageSubtitle}>
                Create and manage shift payout schedules for your team.
              </Text>
            </View>

            <View style={styles.controlsRow}>
              <View style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>Show Archived</Text>
                <Switch
                  value={showInactiveSchedules}
                  onValueChange={setShowInactiveSchedules}
                  trackColor={{ false: "#e5e7eb", true: "#cab99a" }}
                  thumbColor="#ffffff"
                />
              </View>
              <View style={styles.actionRow}>
                <Pressable
                  style={styles.primaryButtonSmall}
                  onPress={() => {
                    resetForm();
                    setActiveView("create");
                  }}
                >
                  <Text style={styles.primaryButtonText}>Create Schedule</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.secondaryButtonSmall,
                    (!selectedScheduleId || isDeleting) && styles.buttonDisabled,
                  ]}
                  onPress={() => setIsDeleteConfirmOpen(true)}
                  disabled={!selectedScheduleId || isDeleting}
                >
                  <Text style={styles.secondaryButtonText}>
                    {isDeleting ? "Archiving..." : "Archive"}
                  </Text>
                </Pressable>
              </View>
            </View>
          </>
        ) : null}

        {activeView === "existing" ? (
          <View>
            {deleteMessage ? (
              <Text
                style={[
                  styles.statusText,
                  deleteMessage.includes("Failed") && styles.errorText,
                ]}
              >
                {deleteMessage}
              </Text>
            ) : null}
            {schedulesError ? <Text style={styles.errorText}>{schedulesError}</Text> : null}

            <View style={styles.list}>
              {isLoadingSchedules ? (
                <View style={styles.loadingBox}>
                  <ActivityIndicator size={20} />
                  <Text style={styles.loadingText}>Loading schedules...</Text>
                </View>
              ) : schedules.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Text style={styles.emptyText}>
                    No schedules yet. Create your first payout schedule.
                  </Text>
                </View>
              ) : (
                schedules.map((schedule) => {
                  const isSelected = selectedScheduleId === schedule.payout_schedule_id;
                  const isExpanded = expandedScheduleId === schedule.payout_schedule_id;
                  const details = expandedScheduleDetails[schedule.payout_schedule_id];
                  const isLoadingExpanded = loadingExpandedDetails[schedule.payout_schedule_id];

                  return (
                    <View
                      key={schedule.payout_schedule_id}
                      style={[styles.scheduleCard, isSelected && styles.scheduleCardSelected]}
                    >
                      <Pressable
                        onPress={() => toggleScheduleExpanded(schedule.payout_schedule_id)}
                        style={styles.scheduleHeader}
                      >
                        <Pressable
                          onPress={(event) => {
                            event.stopPropagation();
                            setSelectedScheduleId(
                              isSelected ? null : schedule.payout_schedule_id,
                            );
                          }}
                          style={styles.checkbox}
                        >
                          {isSelected ? <View style={styles.checkboxChecked} /> : null}
                        </Pressable>
                        <View style={styles.scheduleGrid}>
                          <View style={styles.scheduleCell}>
                            <Text style={styles.cellLabel}>Name</Text>
                            <Text style={styles.cellValue}>{schedule.name}</Text>
                          </View>
                          <View style={styles.scheduleRowInline}>
                            <View style={styles.scheduleCellInline}>
                              <Text style={styles.cellLabel}>Payout Rule</Text>
                              <Text style={styles.cellValue}>
                                {payoutRuleLabel(schedule.payout_rule_id)}
                              </Text>
                            </View>
                            <View style={styles.scheduleCellRight}>
                              <Text style={styles.cellLabel}>Status</Text>
                              <View
                                style={[
                                  styles.statusBadge,
                                  schedule.is_active
                                    ? styles.statusBadgeActive
                                    : styles.statusBadgeInactive,
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.statusBadgeText,
                                    schedule.is_active
                                      ? styles.statusBadgeTextActive
                                      : styles.statusBadgeTextInactive,
                                  ]}
                                >
                                  {schedule.is_active ? "Active" : "Inactive"}
                                </Text>
                              </View>
                            </View>
                          </View>
                          <View style={styles.scheduleRowInline}>
                            <View style={styles.scheduleCellInline}>
                              <Text style={styles.cellLabel}>Day</Text>
                              <Text style={styles.cellValue}>
                                {formatDayRange(schedule.start_day, schedule.end_day)}
                              </Text>
                            </View>
                            <View style={styles.scheduleCellRight}>
                              <Text style={styles.cellLabel}>Time</Text>
                              <Text style={styles.cellValue}>
                                {formatTimeRange(schedule.start_time, schedule.end_time)}
                              </Text>
                            </View>
                          </View>
                        </View>
                        <Text style={styles.expandIcon}>{isExpanded ? "−" : "+"}</Text>
                      </Pressable>

                      {isExpanded ? (
                        <View style={styles.expandedSection}>
                          {isLoadingExpanded ? (
                            <View style={styles.loadingBox}>
                              <ActivityIndicator size={16} />
                              <Text style={styles.loadingText}>Loading details...</Text>
                            </View>
                          ) : details ? (
                            <>
                              {/* Payout Triggers */}
                              {details.payout_triggers ? (
                                <View style={styles.detailSection}>
                                  <Text style={styles.detailSectionTitle}>Payout Triggers</Text>
                                  <View style={styles.detailRow}>
                                    <Text style={styles.detailLabel}>Gratuity:</Text>
                                    <Text style={styles.detailValue}>
                                      {details.payout_triggers.gratuity ?? "N/A"}%
                                    </Text>
                                  </View>
                                  <View style={styles.detailRow}>
                                    <Text style={styles.detailLabel}>Tips:</Text>
                                    <Text style={styles.detailValue}>
                                      {details.payout_triggers.tips ?? "N/A"}%
                                    </Text>
                                  </View>
                                </View>
                              ) : null}

                              {/* Contributors & Receivers */}
                              {details.payout_receivers && details.payout_receivers.length > 0 ? (
                                <>
                                  {(() => {
                                    const contributors = details.payout_receivers.filter(
                                      (r) => r.contributor_receiver === 0,
                                    );
                                    const contributorNames = new Set(
                                      contributors.map((c) => c.payout_receiver_id),
                                    );
                                    const receivers = details.payout_receivers.filter(
                                      (r) =>
                                        r.contributor_receiver === 1 &&
                                        !contributorNames.has(r.payout_receiver_id),
                                    );
                                    const receiverTotal = receivers.reduce(
                                      (sum, r) => sum + (r.payout_percentage ?? 0),
                                      0,
                                    );
                                    const contribPercent = 100 - receiverTotal;

                                    return (
                                      <>
                                        {contributors.length > 0 ? (
                                          <View style={styles.detailSection}>
                                            <View style={styles.detailHeaderRow}>
                                              <Text style={styles.detailSectionTitle}>
                                                Contributors
                                              </Text>
                                              <Text style={styles.detailPercentBadge}>
                                                {contribPercent}%
                                              </Text>
                                            </View>
                                            <View style={styles.chipGrid}>
                                              {contributors.map((c, idx) => (
                                                <View key={idx} style={styles.detailChip}>
                                                  <Text style={styles.detailChipText}>
                                                    {c.payout_receiver_id}
                                                  </Text>
                                                </View>
                                              ))}
                                            </View>
                                          </View>
                                        ) : null}

                                        {receivers.length > 0 ? (
                                          <View style={styles.detailSection}>
                                            <View style={styles.detailHeaderRow}>
                                              <Text style={styles.detailSectionTitle}>
                                                Receivers
                                              </Text>
                                              <Text style={styles.detailPercentBadge}>
                                                {receiverTotal}%
                                              </Text>
                                            </View>
                                            {receivers.map((r, idx) => (
                                              <View key={idx} style={styles.detailRow}>
                                                <Text style={styles.detailLabel}>
                                                  {r.payout_receiver_id}
                                                </Text>
                                                <Text style={styles.detailValue}>
                                                  {r.payout_percentage ?? "N/A"}%
                                                </Text>
                                              </View>
                                            ))}
                                          </View>
                                        ) : null}
                                      </>
                                    );
                                  })()}
                                </>
                              ) : null}

                              {/* Pre-Payouts */}
                              {details.pre_payouts && details.pre_payouts.length > 0 ? (
                                <View style={styles.detailSection}>
                                  <Text style={styles.detailSectionTitle}>Pre-Payout Entries</Text>
                                  {details.pre_payouts.map((pp, idx) => (
                                    <View key={idx} style={styles.detailRow}>
                                      <Text style={styles.detailLabel}>
                                        {pp.user_account || "Unknown"}
                                      </Text>
                                      <Text style={styles.detailValue}>
                                        {pp.pre_payout_option === 1
                                          ? `$${pp.pre_payout_value}`
                                          : `${pp.pre_payout_value}%`}
                                      </Text>
                                    </View>
                                  ))}
                                </View>
                              ) : null}

                              {/* Action Button */}
                              <View style={styles.expandedActions}>
                                {schedule.is_active ? (
                                  <Pressable
                                    style={styles.primaryButtonSmall}
                                    onPress={() =>
                                      void loadScheduleDetails(schedule.payout_schedule_id)
                                    }
                                  >
                                    <Text style={styles.primaryButtonText}>Edit Schedule</Text>
                                  </Pressable>
                                ) : (
                                  <Pressable
                                    style={[
                                      styles.primaryButtonSmall,
                                      isActivating && styles.buttonDisabled,
                                    ]}
                                    onPress={() =>
                                      void handleActivateSchedule(schedule.payout_schedule_id)
                                    }
                                    disabled={isActivating}
                                  >
                                    <Text style={styles.primaryButtonText}>
                                      {isActivating ? "Activating..." : "Activate this Payout"}
                                    </Text>
                                  </Pressable>
                                )}
                              </View>
                            </>
                          ) : (
                            <Text style={styles.errorText}>Failed to load details</Text>
                          )}
                        </View>
                      ) : null}
                    </View>
                  );
                })
              )}
            </View>
          </View>
        ) : (
          <View style={styles.formContainer}>
            <Text style={styles.title}>
              {editingScheduleId ? "Edit Payout Schedule" : "Create Payout Schedule"}
            </Text>
            {detailsError ? <Text style={styles.errorText}>{detailsError}</Text> : null}
            {isLoadingDetails ? (
              <Text style={styles.loadingText}>Loading schedule...</Text>
            ) : null}
            {submitError ? <Text style={styles.errorText}>{submitError}</Text> : null}
            {submitSuccess ? <Text style={styles.statusText}>{submitSuccess}</Text> : null}

            {/* Schedule Section */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Schedule</Text>
              <Text style={styles.inputLabel}>Payout Schedule Name</Text>
              <TextInput
                value={formName}
                onChangeText={setFormName}
                style={styles.input}
                placeholder="Schedule Name"
              />
              <View style={styles.row}>
                <View style={styles.flex}>
                  <Text style={styles.inputLabel}>Start Day</Text>
                  <Pressable
                    style={styles.select}
                    onPress={() => setShowStartDayOptions((prev) => !prev)}
                  >
                    <Text style={styles.selectText}>{startDay || "Select day"}</Text>
                    <Text style={styles.selectCaret}>▾</Text>
                  </Pressable>
                  {showStartDayOptions ? (
                    <View style={styles.optionsBox}>
                      {dayOptions.map((day) => (
                        <Pressable
                          key={`start-${day}`}
                          style={styles.optionRow}
                          onPress={() => {
                            setStartDay(day);
                            setShowStartDayOptions(false);
                          }}
                        >
                          <Text style={styles.optionText}>{day}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </View>
                <View style={styles.flex}>
                  <Text style={styles.inputLabel}>End Day</Text>
                  <Pressable
                    style={styles.select}
                    onPress={() => setShowEndDayOptions((prev) => !prev)}
                  >
                    <Text style={styles.selectText}>{endDay || "Select day"}</Text>
                    <Text style={styles.selectCaret}>▾</Text>
                  </Pressable>
                  {showEndDayOptions ? (
                    <View style={styles.optionsBox}>
                      {dayOptions.map((day) => (
                        <Pressable
                          key={`end-${day}`}
                          style={styles.optionRow}
                          onPress={() => {
                            setEndDay(day);
                            setShowEndDayOptions(false);
                          }}
                        >
                          <Text style={styles.optionText}>{day}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </View>
              </View>
              <View style={styles.row}>
                <View style={styles.flex}>
                  <Text style={styles.inputLabel}>Start Time</Text>
                  <Pressable
                    style={styles.select}
                    onPress={() => setShowStartTimeOptions((prev) => !prev)}
                  >
                    <Text style={styles.selectText}>
                      {startTime ? formatTimeLabel(startTime) : "Select time"}
                    </Text>
                    <Text style={styles.selectCaret}>▾</Text>
                  </Pressable>
                  {showStartTimeOptions ? (
                    <View style={styles.optionsBox}>
                      <ScrollView style={styles.optionsScroll} nestedScrollEnabled>
                        {timeOptions.map((time) => (
                          <Pressable
                            key={`start-${time}`}
                            style={styles.optionRow}
                            onPress={() => {
                              setStartTime(time);
                              setShowStartTimeOptions(false);
                            }}
                          >
                            <Text style={styles.optionText}>{formatTimeLabel(time)}</Text>
                          </Pressable>
                        ))}
                      </ScrollView>
                    </View>
                  ) : null}
                </View>
                <View style={styles.flex}>
                  <Text style={styles.inputLabel}>End Time</Text>
                  <Pressable
                    style={styles.select}
                    onPress={() => setShowEndTimeOptions((prev) => !prev)}
                  >
                    <Text style={styles.selectText}>
                      {endTime ? formatTimeLabel(endTime) : "Select time"}
                    </Text>
                    <Text style={styles.selectCaret}>▾</Text>
                  </Pressable>
                  {showEndTimeOptions ? (
                    <View style={styles.optionsBox}>
                      <ScrollView style={styles.optionsScroll} nestedScrollEnabled>
                        {timeOptions.map((time) => (
                          <Pressable
                            key={`end-${time}`}
                            style={styles.optionRow}
                            onPress={() => {
                              setEndTime(time);
                              setShowEndTimeOptions(false);
                            }}
                          >
                            <Text style={styles.optionText}>{formatTimeLabel(time)}</Text>
                          </Pressable>
                        ))}
                      </ScrollView>
                    </View>
                  ) : null}
                </View>
              </View>
            </View>

            {/* Payout Section */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Payout</Text>

              {/* Payout Triggers */}
              <Text style={styles.inputLabel}>Payout Triggers</Text>
              {fundsFrom.map((fund, index) => (
                <View key={fund.name} style={styles.fundRow}>
                  <Text style={styles.fundName}>{fund.name}</Text>
                  <View style={styles.fundInputContainer}>
                    <TextInput
                      value={String(fund.percentage)}
                      onChangeText={(value) => updateFundPercentage(index, value)}
                      style={styles.fundInput}
                      keyboardType="numeric"
                    />
                    <Text style={styles.fundPercent}>%</Text>
                  </View>
                </View>
              ))}

              {/* Payout Contributors */}
              <Text style={[styles.inputLabel, { marginTop: 16 }]}>Select Payout Contributors</Text>
              <Pressable
                style={styles.select}
                onPress={() => setShowContributorDropdown((prev) => !prev)}
              >
                <View style={styles.selectedChipsContainer}>
                  {payoutContributors.length > 0 ? (
                    payoutContributors.map((c) => (
                      <View key={c} style={styles.selectedChip}>
                        <Text style={styles.selectedChipText}>{c}</Text>
                        <Pressable
                          onPress={(e) => {
                            e.stopPropagation();
                            toggleContributor(c);
                          }}
                        >
                          <Text style={styles.selectedChipRemove}>×</Text>
                        </Pressable>
                      </View>
                    ))
                  ) : (
                    <Text style={styles.selectPlaceholder}>Select Contributors</Text>
                  )}
                </View>
                <Text style={styles.selectCaret}>▾</Text>
              </Pressable>
              {showContributorDropdown ? (
                <View style={styles.dropdownBox}>
                  <TextInput
                    value={contributorSearch}
                    onChangeText={setContributorSearch}
                    style={styles.searchInput}
                    placeholder="Search contributors"
                  />
                  <ScrollView style={styles.dropdownScroll} nestedScrollEnabled>
                    {filteredContributors.length === 0 ? (
                      <Text style={styles.noMatchText}>No matches found</Text>
                    ) : (
                      filteredContributors.map((title) => (
                        <Pressable
                          key={title}
                          style={styles.dropdownItem}
                          onPress={() => toggleContributor(title)}
                        >
                          <View
                            style={[
                              styles.dropdownCheckbox,
                              payoutContributors.includes(title) &&
                                styles.dropdownCheckboxChecked,
                            ]}
                          >
                            {payoutContributors.includes(title) ? (
                              <Text style={styles.checkmark}>✓</Text>
                            ) : null}
                          </View>
                          <Text style={styles.dropdownItemText}>{title}</Text>
                        </Pressable>
                      ))
                    )}
                  </ScrollView>
                </View>
              ) : null}

              {/* Payout Receivers */}
              <Text style={[styles.inputLabel, { marginTop: 16 }]}>Select Payout Receivers</Text>
              <Pressable
                style={styles.select}
                onPress={() => setShowReceiverDropdown((prev) => !prev)}
              >
                <View style={styles.selectedChipsContainer}>
                  {payoutReceivers.length > 0 ? (
                    payoutReceivers.map((r) => (
                      <View key={r} style={styles.selectedChip}>
                        <Text style={styles.selectedChipText}>{r}</Text>
                        <Pressable
                          onPress={(e) => {
                            e.stopPropagation();
                            toggleReceiver(r);
                          }}
                        >
                          <Text style={styles.selectedChipRemove}>×</Text>
                        </Pressable>
                      </View>
                    ))
                  ) : (
                    <Text style={styles.selectPlaceholder}>Select Receivers</Text>
                  )}
                </View>
                <Text style={styles.selectCaret}>▾</Text>
              </Pressable>
              {showReceiverDropdown ? (
                <View style={styles.dropdownBox}>
                  <TextInput
                    value={receiverSearch}
                    onChangeText={setReceiverSearch}
                    style={styles.searchInput}
                    placeholder="Search receivers"
                  />
                  <ScrollView style={styles.dropdownScroll} nestedScrollEnabled>
                    {filteredReceivers.length === 0 ? (
                      <Text style={styles.noMatchText}>No matches found</Text>
                    ) : (
                      filteredReceivers.map((title) => (
                        <Pressable
                          key={title}
                          style={styles.dropdownItem}
                          onPress={() => toggleReceiver(title)}
                        >
                          <View
                            style={[
                              styles.dropdownCheckbox,
                              payoutReceivers.includes(title) && styles.dropdownCheckboxChecked,
                            ]}
                          >
                            {payoutReceivers.includes(title) ? (
                              <Text style={styles.checkmark}>✓</Text>
                            ) : null}
                          </View>
                          <Text style={styles.dropdownItemText}>{title}</Text>
                        </Pressable>
                      ))
                    )}
                  </ScrollView>
                </View>
              ) : null}

              {/* Payout Rule */}
              <Text style={[styles.inputLabel, { marginTop: 16 }]}>Payout Rule</Text>
              <View style={styles.radioGroup}>
                {payoutRuleOptions.map((rule) => (
                  <Pressable
                    key={rule}
                    style={styles.radioItem}
                    onPress={() => setPayoutRule(rule)}
                  >
                    <View style={styles.radioOuter}>
                      {payoutRule === rule ? <View style={styles.radioInner} /> : null}
                    </View>
                    <Text style={styles.radioLabel}>{rule}</Text>
                  </Pressable>
                ))}
              </View>

              {/* Custom Payout Fields */}
              {payoutRule === "Custom Payout" ? (
                <View style={styles.row}>
                  <View style={styles.flex}>
                    <Text style={styles.inputLabel}>Individual Payout</Text>
                    <View style={styles.percentInputRow}>
                      <TextInput
                        value={customIndividualContribution}
                        onChangeText={setCustomIndividualContribution}
                        style={styles.percentInput}
                        keyboardType="numeric"
                        placeholder="0"
                      />
                      <Text style={styles.percentSymbol}>%</Text>
                    </View>
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.inputLabel}>Group Contribution</Text>
                    <View style={styles.percentInputRow}>
                      <TextInput
                        value={customGroupContribution}
                        onChangeText={setCustomGroupContribution}
                        style={styles.percentInput}
                        keyboardType="numeric"
                        placeholder="0"
                      />
                      <Text style={styles.percentSymbol}>%</Text>
                    </View>
                  </View>
                </View>
              ) : null}

              {/* Payout Rule Info */}
              {payoutRule === "Equal Payout" ? (
                <Text style={styles.ruleInfoText}>
                  All employees will receive an equal payout
                </Text>
              ) : payoutRule === "Hour Based Payout" ? (
                <Text style={styles.ruleInfoText}>
                  All employees will receive a payout based on hours worked
                </Text>
              ) : null}

              {/* Payout Percentages */}
              {(payoutRule === "Custom Payout" || payoutRule === "Job Weighted Payout") &&
              payoutPercentTargets.length > 0 ? (
                <View style={styles.percentagesSection}>
                  <Text style={styles.inputLabel}>Payout Percentages</Text>
                  {payoutPercentTargets.map((name) => {
                    const isContributor = payoutContributors.includes(name);
                    const isReceiver = payoutReceivers.includes(name);
                    return (
                      <View key={name} style={styles.percentageRow}>
                        <View style={styles.percentageNameContainer}>
                          <Text style={styles.percentageName}>{name}</Text>
                          <View style={styles.badgeContainer}>
                            {isContributor ? (
                              <View style={styles.roleBadge}>
                                <Text style={styles.roleBadgeText}>Contributor</Text>
                              </View>
                            ) : null}
                            {isReceiver ? (
                              <View style={styles.roleBadge}>
                                <Text style={styles.roleBadgeText}>Receiver</Text>
                              </View>
                            ) : null}
                          </View>
                        </View>
                        <View style={styles.percentInputRow}>
                          <TextInput
                            value={receiverPercentages[name] ?? ""}
                            onChangeText={(value) => handleReceiverPercentageChange(name, value)}
                            style={styles.percentInput}
                            keyboardType="numeric"
                            placeholder="0"
                          />
                          <Text style={styles.percentSymbol}>%</Text>
                        </View>
                      </View>
                    );
                  })}

                  {/* Totals */}
                  <View style={styles.totalsSection}>
                    {payoutContributors.length > 0 ? (
                      <View style={styles.totalRow}>
                        <Text style={styles.totalLabel}>Contributors:</Text>
                        <Text style={styles.totalValue}>{contributorPercentage.toFixed(2)}%</Text>
                      </View>
                    ) : null}
                    {payoutReceivers.length > 0 ? (
                      <View style={styles.totalRow}>
                        <Text style={styles.totalLabel}>Receivers:</Text>
                        <Text style={styles.totalValue}>
                          {receiverPercentageTotal.toFixed(2)}%
                        </Text>
                      </View>
                    ) : null}
                    <View style={styles.totalRow}>
                      <Text style={styles.totalLabelBold}>Total:</Text>
                      <Text style={styles.totalValueBold}>{totalPercentage.toFixed(2)}%</Text>
                    </View>
                    {Math.abs(totalPercentage - 100) > 0.01 ? (
                      <Text style={styles.validationError}>
                        Total must equal 100%. (Contributors + Receivers = 100%)
                      </Text>
                    ) : null}
                  </View>
                </View>
              ) : null}
            </View>

            {/* Pre-Payout Section */}
            <View style={styles.sectionCard}>
              <View style={styles.prePayoutHeader}>
                <View style={styles.prePayoutTextContainer}>
                  <Text style={styles.sectionTitle}>Pre-Payout</Text>
                  <Text style={styles.sectionSubtitle}>
                    Any amount that must be allocated to an account before Payout?
                  </Text>
                </View>
                <Pressable style={styles.addButton} onPress={addPrePayout}>
                  <Text style={styles.deleteButtonText}>Add</Text>
                </Pressable>
              </View>
              {prePayouts.length === 0 ? (
                <Text style={styles.helperText}>No pre-payouts added.</Text>
              ) : (
                prePayouts.map((entry, index) => (
                  <View key={`prepayout-${index}`} style={styles.prePayoutCard}>
                    <View style={styles.prePayoutTypeRow}>
                      <View style={styles.radioGroup}>
                        {(["Percentage", "Fixed Amount"] as const).map((type) => (
                          <Pressable
                            key={type}
                            style={styles.radioItem}
                            onPress={() => updatePrePayout(index, { type, value: "" })}
                          >
                            <View style={styles.radioOuter}>
                              {entry.type === type ? <View style={styles.radioInner} /> : null}
                            </View>
                            <Text style={styles.radioLabel}>{type}</Text>
                          </Pressable>
                        ))}
                      </View>
                      <Pressable
                        style={styles.deleteButton}
                        onPress={() => removePrePayout(index)}
                      >
                        <Text style={styles.deleteButtonText}>Delete</Text>
                      </Pressable>
                    </View>

                    {entry.type ? (
                      <View style={styles.prePayoutValueRow}>
                        <Text style={styles.prePayoutValueLabel}>Set your {entry.type}</Text>
                        <View style={styles.percentInputRow}>
                          <TextInput
                            value={entry.value}
                            onChangeText={(value) => updatePrePayout(index, { value })}
                            style={styles.percentInput}
                            keyboardType="numeric"
                            placeholder="0"
                          />
                          <Text style={styles.percentSymbol}>
                            {entry.type === "Percentage" ? "%" : "$"}
                          </Text>
                        </View>
                      </View>
                    ) : null}

                    <Text style={styles.inputLabel}>Account</Text>
                    <TextInput
                      value={entry.account}
                      onChangeText={(value) => updatePrePayout(index, { account: value })}
                      style={styles.input}
                      placeholder="Account name"
                    />
                  </View>
                ))
              )}
            </View>

            {/* Form Actions */}
            <View style={styles.formActions}>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => {
                  resetForm();
                  setActiveView("existing");
                }}
              >
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.primaryButton, isSubmitting && styles.buttonDisabled]}
                onPress={() => void handleSubmit()}
                disabled={isSubmitting}
              >
                <Text style={styles.primaryButtonText}>
                  {isSubmitting
                    ? editingScheduleId
                      ? "Updating..."
                      : "Saving..."
                    : editingScheduleId
                      ? "Update Schedule"
                      : "Save Schedule"}
                </Text>
              </Pressable>
            </View>
          </View>
        )}
      </ScrollView>
    </AppShell>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 20,
    paddingBottom: 40,
    backgroundColor: "#f4f2ee",
  },
  permissionContainer: {
    padding: 20,
    backgroundColor: "#f4f2ee",
    flex: 1,
  },
  permissionTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#111827",
  },
  permissionText: {
    marginTop: 8,
    color: "#6b7280",
  },
  headerSection: {
    marginBottom: 16,
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#111827",
  },
  pageSubtitle: {
    fontSize: 14,
    color: "#6b7280",
    marginTop: 4,
  },
  controlsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    marginBottom: 16,
    gap: 12,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  toggleLabel: {
    fontSize: 14,
    color: "#374151",
    fontWeight: "500",
  },
  actionRow: {
    flexDirection: "row",
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#111827",
  },
  primaryButton: {
    backgroundColor: "#cab99a",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignItems: "center",
  },
  primaryButtonSmall: {
    backgroundColor: "#cab99a",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#111827",
    fontWeight: "600",
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    backgroundColor: "#ffffff",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignItems: "center",
  },
  secondaryButtonSmall: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    backgroundColor: "#ffffff",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  secondaryButtonText: {
    color: "#111827",
    fontWeight: "600",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  statusText: {
    color: "#16a34a",
    marginBottom: 12,
  },
  errorText: {
    color: "#dc2626",
    marginBottom: 12,
  },
  list: {
    gap: 12,
  },
  loadingBox: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    padding: 16,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  loadingText: {
    color: "#6b7280",
  },
  emptyBox: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    padding: 16,
    alignItems: "center",
  },
  emptyText: {
    color: "#6b7280",
  },
  scheduleCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    overflow: "hidden",
  },
  scheduleCardSelected: {
    borderColor: "#111827",
    backgroundColor: "#f9fafb",
  },
  scheduleHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 16,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#9ca3af",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  checkboxChecked: {
    width: 12,
    height: 12,
    borderRadius: 2,
    backgroundColor: "#111827",
  },
  scheduleGrid: {
    flex: 1,
    gap: 10,
  },
  scheduleCell: {
    gap: 4,
  },
  scheduleRowInline: {
    flexDirection: "row",
    gap: 16,
  },
  scheduleCellInline: {
    flex: 1,
    gap: 6,
  },
  scheduleCellRight: {
    alignItems: "flex-end",
    gap: 6,
  },
  cellLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    color: "#6b7280",
    fontWeight: "600",
  },
  cellValue: {
    fontSize: 14,
    color: "#111827",
    fontWeight: "500",
  },
  statusBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 16,
  },
  statusBadgeActive: {
    backgroundColor: "#dcfce7",
  },
  statusBadgeInactive: {
    backgroundColor: "#fee2e2",
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: "600",
  },
  statusBadgeTextActive: {
    color: "#15803d",
  },
  statusBadgeTextInactive: {
    color: "#dc2626",
  },
  expandIcon: {
    fontSize: 20,
    color: "#9ca3af",
    paddingHorizontal: 4,
    fontWeight: "600",
  },
  expandedSection: {
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    padding: 16,
    gap: 16,
  },
  detailSection: {
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
    paddingBottom: 12,
  },
  detailHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  detailSectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#374151",
  },
  detailPercentBadge: {
    fontSize: 14,
    fontWeight: "700",
    color: "#111827",
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  detailLabel: {
    fontSize: 14,
    color: "#6b7280",
  },
  detailValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
  },
  detailChip: {
    backgroundColor: "#f3f4f6",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  detailChipText: {
    fontSize: 13,
    color: "#374151",
    fontWeight: "500",
  },
  chipGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  expandedActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingTop: 8,
  },
  formContainer: {
    gap: 16,
  },
  sectionCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    padding: 16,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111827",
  },
  sectionSubtitle: {
    fontSize: 13,
    color: "#6b7280",
    marginTop: 2,
  },
  inputLabel: {
    fontSize: 13,
    color: "#6b7280",
    fontWeight: "500",
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: "#ffffff",
    fontSize: 15,
  },
  row: {
    flexDirection: "row",
    gap: 12,
  },
  flex: {
    flex: 1,
    gap: 4,
  },
  select: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#ffffff",
    minHeight: 48,
  },
  selectText: {
    color: "#111827",
    fontSize: 15,
  },
  selectPlaceholder: {
    color: "#9ca3af",
    fontSize: 15,
  },
  selectCaret: {
    color: "#6b7280",
    fontSize: 14,
  },
  optionsBox: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    backgroundColor: "#ffffff",
    maxHeight: 220,
    overflow: "hidden",
  },
  optionsScroll: {
    maxHeight: 200,
  },
  optionRow: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  optionText: {
    color: "#111827",
    fontSize: 15,
  },
  selectedChipsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    flex: 1,
  },
  selectedChip: {
    backgroundColor: "#f3f4f6",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  selectedChipText: {
    fontSize: 13,
    color: "#374151",
  },
  selectedChipRemove: {
    fontSize: 16,
    color: "#6b7280",
    fontWeight: "600",
  },
  dropdownBox: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    backgroundColor: "#ffffff",
    maxHeight: 280,
    overflow: "hidden",
  },
  searchInput: {
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  dropdownScroll: {
    maxHeight: 220,
  },
  dropdownItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 10,
  },
  dropdownCheckbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#d1d5db",
    alignItems: "center",
    justifyContent: "center",
  },
  dropdownCheckboxChecked: {
    backgroundColor: "#cab99a",
    borderColor: "#cab99a",
  },
  checkmark: {
    color: "#111827",
    fontSize: 12,
    fontWeight: "700",
  },
  dropdownItemText: {
    fontSize: 14,
    color: "#111827",
  },
  noMatchText: {
    padding: 12,
    color: "#6b7280",
    fontSize: 14,
  },
  fundRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#ffffff",
  },
  fundName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#111827",
  },
  fundInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  fundInput: {
    width: 70,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    textAlign: "right",
    fontSize: 14,
  },
  fundPercent: {
    fontSize: 14,
    color: "#6b7280",
  },
  radioGroup: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
  },
  radioItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#d1d5db",
    alignItems: "center",
    justifyContent: "center",
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#111827",
  },
  radioLabel: {
    fontSize: 14,
    color: "#111827",
  },
  ruleInfoText: {
    color: "#dc2626",
    fontWeight: "600",
    fontSize: 14,
    marginTop: 8,
  },
  percentagesSection: {
    marginTop: 16,
    gap: 12,
  },
  percentageRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#ffffff",
  },
  percentageNameContainer: {
    flex: 1,
    gap: 4,
  },
  percentageName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#111827",
  },
  badgeContainer: {
    flexDirection: "row",
    gap: 6,
  },
  roleBadge: {
    backgroundColor: "#e6d7b8",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  roleBadgeText: {
    fontSize: 11,
    color: "#374151",
    fontWeight: "500",
  },
  percentInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  percentInput: {
    width: 70,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    textAlign: "right",
    fontSize: 14,
  },
  percentSymbol: {
    fontSize: 14,
    color: "#6b7280",
  },
  totalsSection: {
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingTop: 12,
    marginTop: 8,
    gap: 6,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  totalLabel: {
    fontSize: 14,
    color: "#6b7280",
  },
  totalValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
  },
  totalLabelBold: {
    fontSize: 14,
    fontWeight: "700",
    color: "#111827",
  },
  totalValueBold: {
    fontSize: 14,
    fontWeight: "700",
    color: "#111827",
  },
  validationError: {
    color: "#dc2626",
    fontSize: 13,
    marginTop: 4,
  },
  prePayoutHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  prePayoutTextContainer: {
    flex: 1,
    maxWidth: "60%",
  },
  addButton: {
    backgroundColor: "#cab99a",
    paddingLeft: 20,
    paddingRight: 20,
    paddingVertical: 8,
    borderRadius: 8,
  },
  helperText: {
    color: "#6b7280",
    fontSize: 14,
  },
  prePayoutCard: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    padding: 12,
    gap: 12,
    backgroundColor: "#fafafa",
  },
  prePayoutTypeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  deleteButton: {
    backgroundColor: "#cab99a",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  deleteButtonText: {
    color: "#111827",
    fontWeight: "600",
    fontSize: 13,
  },
  prePayoutValueRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#ffffff",
  },
  prePayoutValueLabel: {
    fontSize: 14,
    fontWeight: "500",
    color: "#111827",
  },
  formActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
    marginTop: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalContent: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 24,
    width: "100%",
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111827",
  },
  modalText: {
    fontSize: 14,
    color: "#6b7280",
    marginTop: 8,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
    marginTop: 24,
  },
});

export default ShiftPayoutScreen;
