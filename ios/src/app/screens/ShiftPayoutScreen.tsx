import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import AppShell from "../components/AppShell";
import { useAuth } from "../providers/useAuth";
import { useSessionScope } from "../hooks/useSessionScope";
import {
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
  type: "Fixed Amount" | "Percentage";
  value: string;
  account: string;
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
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState("");
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState("");
  const [jobTitles, setJobTitles] = useState<string[]>([]);
  const [jobTitlesError, setJobTitlesError] = useState("");

  const [formName, setFormName] = useState("");
  const [startDay, setStartDay] = useState("");
  const [endDay, setEndDay] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [payoutRule, setPayoutRule] = useState("Job Weighted Payout");
  const [gratuityPercent, setGratuityPercent] = useState("100");
  const [tipsPercent, setTipsPercent] = useState("100");
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
  const [showRuleOptions, setShowRuleOptions] = useState(false);

  const userId = scope?.userId ?? null;
  const restaurantId = scope?.restaurantId ?? null;

  const resetForm = () => {
    setFormName("");
    setStartDay("");
    setEndDay("");
    setStartTime("");
    setEndTime("");
    setPayoutRule("Job Weighted Payout");
    setGratuityPercent("100");
    setTipsPercent("100");
    setPayoutContributors([]);
    setPayoutReceivers([]);
    setReceiverPercentages({});
    setCustomIndividualContribution("");
    setCustomGroupContribution("");
    setPrePayouts([]);
    setEditingScheduleId(null);
    setSubmitError("");
    setSubmitSuccess("");
  };

  const loadSchedules = useCallback(async () => {
    if (userId === null || restaurantId === null) {
      return;
    }
    setIsLoadingSchedules(true);
    setSchedulesError("");
    try {
      const data = await fetchPayoutSchedules(userId, restaurantId);
      setSchedules(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load schedules.";
      setSchedulesError(message);
    } finally {
      setIsLoadingSchedules(false);
    }
  }, [restaurantId, userId]);

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
        const message = error instanceof Error ? error.message : "Failed to load job titles.";
        setJobTitlesError(message);
      });
  }, [restaurantId, userId]);

  const toggleScheduleExpanded = (scheduleId: number) => {
    setExpandedScheduleId((prev) => (prev === scheduleId ? null : scheduleId));
  };

  const handleDeleteSchedule = async () => {
    if (!selectedScheduleId || userId === null || restaurantId === null) {
      return;
    }
    setIsDeleting(true);
    setDeleteMessage("");
    try {
      await deletePayoutSchedule(selectedScheduleId, userId, restaurantId);
      setDeleteMessage("Schedule deleted.");
      setSelectedScheduleId(null);
      setExpandedScheduleId(null);
      await loadSchedules();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete schedule.";
      setDeleteMessage(message);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleOpenDelete = () => {
    if (!selectedScheduleId) {
      return;
    }
    Alert.alert(
      "Delete schedule?",
      "This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Yes, delete", style: "destructive", onPress: () => void handleDeleteSchedule() },
      ],
      { cancelable: true },
    );
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
      setGratuityPercent(
        detail.payout_triggers?.gratuity !== undefined && detail.payout_triggers?.gratuity !== null
          ? String(detail.payout_triggers.gratuity)
          : "100",
      );
      setTipsPercent(
        detail.payout_triggers?.tips !== undefined && detail.payout_triggers?.tips !== null
          ? String(detail.payout_triggers.tips)
          : "100",
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

  const updateSelection = (
    value: string,
    list: string[],
    setList: React.Dispatch<React.SetStateAction<string[]>>,
  ) => {
    setList((prev) =>
      prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value],
    );
  };

  const handleReceiverPercentageChange = (name: string, value: string) => {
    setReceiverPercentages((prev) => ({ ...prev, [name]: value }));
  };

  const addPrePayout = () => {
    setPrePayouts((prev) => [
      ...prev,
      { type: "Fixed Amount", value: "", account: "" },
    ]);
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
    setIsSubmitting(true);
    setSubmitError("");
    setSubmitSuccess("");
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
        gratuity: Number(gratuityPercent) || 0,
        tips: Number(tipsPercent) || 0,
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
        .filter((entry) => entry.value && entry.account)
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

  const scheduleStatus = (schedule: PayoutScheduleRow) =>
    schedule.start_day || schedule.start_time ? "Scheduled" : "Draft";

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
      <ScrollView contentContainerStyle={styles.container}>
        {activeView === "existing" ? (
          <>
            <Text style={styles.pageTitle}>Shift Payout Schedules</Text>
            <View style={styles.actionRow}>
              <Pressable
                style={styles.primaryButton}
                onPress={() => {
                  resetForm();
                  setActiveView("create");
                }}
              >
                <Text style={styles.primaryButtonText}>Create Schedule</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.secondaryButton,
                  (!selectedScheduleId || isDeleting) && styles.buttonDisabled,
                ]}
                onPress={handleOpenDelete}
                disabled={!selectedScheduleId || isDeleting}
              >
                <Text style={styles.secondaryButtonText}>
                  {isDeleting ? "Deleting..." : "Delete"}
                </Text>
              </Pressable>
            </View>
          </>
        ) : null}

        {activeView === "existing" ? (
          <View>
            {deleteMessage ? <Text style={styles.statusText}>{deleteMessage}</Text> : null}
            {schedulesError ? <Text style={styles.errorText}>{schedulesError}</Text> : null}

            <View style={styles.list}>
              {isLoadingSchedules ? (
                <View style={styles.loadingBox}>
                  <ActivityIndicator size={20} />
                  <Text style={styles.loadingText}>Loading schedules...</Text>
                </View>
              ) : schedules.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Text style={styles.emptyText}>No schedules yet. Create your first payout schedule.</Text>
                </View>
              ) : (
                schedules.map((schedule) => {
                  const isSelected = selectedScheduleId === schedule.payout_schedule_id;
                  const isExpanded = expandedScheduleId === schedule.payout_schedule_id;
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
                          <View style={styles.scheduleCell}>
                            <Text style={styles.cellLabel}>Status</Text>
                            <Text style={styles.cellValue}>{scheduleStatus(schedule)}</Text>
                          </View>
                          <View style={styles.scheduleCell}>
                            <Text style={styles.cellLabel}>Payout Rule</Text>
                            <Text style={styles.cellValue}>
                              {payoutRuleLabel(schedule.payout_rule_id)}
                            </Text>
                          </View>
                          <View style={styles.scheduleCell}>
                            <Text style={styles.cellLabel}>Day</Text>
                            <Text style={styles.cellValue}>
                              {formatDayRange(schedule.start_day, schedule.end_day)}
                            </Text>
                          </View>
                          <View style={styles.scheduleCell}>
                            <Text style={styles.cellLabel}>Time</Text>
                            <Text style={styles.cellValue}>
                              {formatTimeRange(schedule.start_time, schedule.end_time)}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.expandIcon}>{isExpanded ? "-" : "+"}</Text>
                      </Pressable>
                      {isExpanded ? (
                        <View style={styles.scheduleFooter}>
                          <Text style={styles.scheduleHint}>
                            Review this schedule or open it to edit payout settings.
                          </Text>
                          <Pressable
                            style={styles.primaryButtonSmall}
                            onPress={() => void loadScheduleDetails(schedule.payout_schedule_id)}
                          >
                            <Text style={styles.primaryButtonText}>Edit Schedule</Text>
                          </Pressable>
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
                      <ScrollView style={styles.optionsScroll}>
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
                      <ScrollView style={styles.optionsScroll}>
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

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Funds From</Text>
              <View style={styles.row}>
                <View style={styles.flex}>
                  <Text style={styles.inputLabel}>Gratuity (%)</Text>
                  <TextInput
                    value={gratuityPercent}
                    onChangeText={setGratuityPercent}
                    style={styles.input}
                    keyboardType="numeric"
                    placeholder="100"
                  />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.inputLabel}>Tips (%)</Text>
                  <TextInput
                    value={tipsPercent}
                    onChangeText={setTipsPercent}
                    style={styles.input}
                    keyboardType="numeric"
                    placeholder="100"
                  />
                </View>
              </View>
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Payout Rule</Text>
              <Pressable
                style={styles.select}
                onPress={() => setShowRuleOptions((prev) => !prev)}
              >
                <Text style={styles.selectText}>{payoutRule}</Text>
                <Text style={styles.selectCaret}>▾</Text>
              </Pressable>
              {showRuleOptions ? (
                <View style={styles.optionsBox}>
                  {payoutRuleOptions.map((rule) => (
                    <Pressable
                      key={rule}
                      style={styles.optionRow}
                      onPress={() => {
                        setPayoutRule(rule);
                        setShowRuleOptions(false);
                      }}
                    >
                      <Text style={styles.optionText}>{rule}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              <View style={styles.row}>
                <View style={styles.flex}>
                  <Text style={styles.inputLabel}>Custom Individual Contribution</Text>
                  <TextInput
                    value={customIndividualContribution}
                    onChangeText={setCustomIndividualContribution}
                    style={styles.input}
                    keyboardType="numeric"
                    placeholder="0"
                  />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.inputLabel}>Custom Group Contribution</Text>
                  <TextInput
                    value={customGroupContribution}
                    onChangeText={setCustomGroupContribution}
                    style={styles.input}
                    keyboardType="numeric"
                    placeholder="0"
                  />
                </View>
              </View>
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Payout Contributors</Text>
              {jobTitlesError ? <Text style={styles.errorText}>{jobTitlesError}</Text> : null}
              <View style={styles.chipGrid}>
                {groupedJobTitles.map((title) => (
                  <Pressable
                    key={`contrib-${title}`}
                    style={[
                      styles.chip,
                      payoutContributors.includes(title) && styles.chipSelected,
                    ]}
                    onPress={() => updateSelection(title, payoutContributors, setPayoutContributors)}
                  >
                    <Text style={styles.chipText}>{title}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Payout Receivers</Text>
              <View style={styles.chipGrid}>
                {groupedJobTitles.map((title) => (
                  <Pressable
                    key={`receiver-${title}`}
                    style={[
                      styles.chip,
                      payoutReceivers.includes(title) && styles.chipSelected,
                    ]}
                    onPress={() => updateSelection(title, payoutReceivers, setPayoutReceivers)}
                  >
                    <Text style={styles.chipText}>{title}</Text>
                  </Pressable>
                ))}
              </View>
              {payoutReceivers.length ? (
                <View style={styles.receiverList}>
                  {payoutReceivers.map((name) => (
                    <View key={`percent-${name}`} style={styles.receiverRow}>
                      <Text style={styles.receiverLabel}>{name}</Text>
                      <TextInput
                        value={receiverPercentages[name] ?? ""}
                        onChangeText={(value) => handleReceiverPercentageChange(name, value)}
                        style={styles.receiverInput}
                        keyboardType="numeric"
                        placeholder="%"
                      />
                    </View>
                  ))}
                </View>
              ) : null}
            </View>

            <View style={styles.sectionCard}>
              <View style={styles.prePayoutHeader}>
                <Text style={styles.sectionTitle}>Pre-Payouts</Text>
                <Pressable style={styles.secondaryButtonSmall} onPress={addPrePayout}>
                  <Text style={styles.secondaryButtonText}>Add</Text>
                </Pressable>
              </View>
              {prePayouts.length === 0 ? (
                <Text style={styles.helperText}>No pre-payouts added.</Text>
              ) : (
                prePayouts.map((entry, index) => (
                  <View key={`prepayout-${index}`} style={styles.prePayoutCard}>
                    <View style={styles.row}>
                      <View style={styles.flex}>
                        <Text style={styles.inputLabel}>Type</Text>
                        <Pressable
                          style={styles.select}
                          onPress={() =>
                            updatePrePayout(index, {
                              type:
                                entry.type === "Fixed Amount" ? "Percentage" : "Fixed Amount",
                            })
                          }
                        >
                          <Text style={styles.selectText}>{entry.type}</Text>
                          <Text style={styles.selectCaret}>↺</Text>
                        </Pressable>
                      </View>
                      <View style={styles.flex}>
                        <Text style={styles.inputLabel}>Value</Text>
                        <TextInput
                          value={entry.value}
                          onChangeText={(value) => updatePrePayout(index, { value })}
                          style={styles.input}
                          keyboardType="numeric"
                          placeholder="0"
                        />
                      </View>
                    </View>
                    <Text style={styles.inputLabel}>Account</Text>
                    <TextInput
                      value={entry.account}
                      onChangeText={(value) => updatePrePayout(index, { account: value })}
                      style={styles.input}
                      placeholder="Account name"
                    />
                    <Pressable
                      style={styles.removeButton}
                      onPress={() => removePrePayout(index)}
                    >
                      <Text style={styles.removeButtonText}>Remove</Text>
                    </Pressable>
                  </View>
                ))
              )}
            </View>

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
                  {isSubmitting ? "Saving..." : "Save Schedule"}
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
  actionRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 12,
    marginBottom: 16,
    justifyContent: "flex-end",
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#111827",
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: "400",
    color: "#111827",
  },
  primaryButton: {
    backgroundColor: "#cab99a",
    paddingVertical: 10,
    paddingHorizontal: 16,
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
    borderColor: "#111827",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: "center",
  },
  secondaryButtonSmall: {
    borderWidth: 1,
    borderColor: "#111827",
    paddingVertical: 6,
    paddingHorizontal: 10,
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
  },
  loadingText: {
    marginTop: 8,
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
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#9ca3af",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  checkboxChecked: {
    width: 10,
    height: 10,
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
  cellLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    color: "#6b7280",
    fontWeight: "600",
  },
  cellValue: {
    fontSize: 13,
    color: "#111827",
  },
  expandIcon: {
    fontSize: 18,
    color: "#9ca3af",
    paddingHorizontal: 4,
  },
  scheduleFooter: {
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  scheduleHint: {
    color: "#6b7280",
    flex: 1,
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
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
  },
  inputLabel: {
    fontSize: 12,
    color: "#6b7280",
  },
  input: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#ffffff",
  },
  row: {
    flexDirection: "row",
    gap: 12,
  },
  flex: {
    flex: 1,
    gap: 8,
  },
  select: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#ffffff",
  },
  selectText: {
    color: "#111827",
  },
  selectCaret: {
    color: "#6b7280",
  },
  optionsBox: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    backgroundColor: "#ffffff",
    maxHeight: 220,
  },
  optionsScroll: {
    maxHeight: 200,
  },
  optionRow: {
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  optionText: {
    color: "#111827",
  },
  chipGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#ffffff",
  },
  chipSelected: {
    backgroundColor: "#cab99a",
    borderColor: "#cab99a",
  },
  chipText: {
    color: "#111827",
    fontSize: 12,
  },
  receiverList: {
    marginTop: 8,
    gap: 8,
  },
  receiverRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  receiverLabel: {
    color: "#111827",
    flex: 1,
  },
  receiverInput: {
    width: 80,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    textAlign: "center",
  },
  prePayoutHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  helperText: {
    color: "#6b7280",
  },
  prePayoutCard: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  removeButton: {
    alignSelf: "flex-end",
    paddingVertical: 4,
  },
  removeButtonText: {
    color: "#dc2626",
    fontWeight: "600",
  },
  formActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
    marginTop: 8,
  },
});

export default ShiftPayoutScreen;
