import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from "./api/client";

type View = 'existing' | 'create';

interface PayoutScheduleRow {
  payout_schedule_id: number;
  name: string;
  start_day: string | null;
  end_day: string | null;
  start_time: string | null;
  end_time: string | null;
  payout_rule_id: string | null;
}

interface PayoutScheduleDetail {
  payout_schedule_id: number;
  name: string;
  start_day: string | null;
  end_day: string | null;
  start_time: string | null;
  end_time: string | null;
  payout_rule_id: string | null;
  payout_triggers?: { gratuity?: number | null; tips?: number | null };
  payout_receivers?: Array<{
    payout_receiver_id: string;
    payout_percentage: number | null;
    contributor_receiver?: number | boolean | null;
  }>;
  custom_individual_payout?: number | null;
  custom_group_contribution?: number | null;
  pre_payouts?: Array<{
    pre_payout_option: number | boolean;
    pre_payout_value: number | null;
    user_account: string | null;
  }>;
}

interface Fund {
  name: string;
  selected: boolean;
  percentage: number;
}
const GratlyFormsSystem: React.FC = () => {
  const [userId, setUserId] = useState<number | null>(null);
  const [activeView, setActiveView] = useState<View>('existing');
  const [schedules, setSchedules] = useState<PayoutScheduleRow[]>([]);
  const [isLoadingSchedules, setIsLoadingSchedules] = useState<boolean>(false);
  const [schedulesError, setSchedulesError] = useState<string>('');
  const [scheduleDetailsError, setScheduleDetailsError] = useState<string>('');
  const [isLoadingScheduleDetails, setIsLoadingScheduleDetails] = useState<boolean>(false);
  const [isDeletingSchedule, setIsDeletingSchedule] = useState<boolean>(false);
  const [deleteScheduleError, setDeleteScheduleError] = useState<string>('');
  const [deleteScheduleSuccess, setDeleteScheduleSuccess] = useState<string>('');
  const [selectedScheduleId, setSelectedScheduleId] = useState<number | null>(null);
  const [expandedScheduleId, setExpandedScheduleId] = useState<number | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string>('');
  const [submitSuccess, setSubmitSuccess] = useState<string>('');
  const [jobTitles, setJobTitles] = useState<string[]>([]);
  const [jobTitlesError, setJobTitlesError] = useState<string>('');
  const [editingScheduleId, setEditingScheduleId] = useState<number | null>(null);
  const [restaurantKey, setRestaurantKey] = useState<string>('');
  const [expandedScheduleDetails, setExpandedScheduleDetails] = useState<Record<number, any>>({});
  const [loadingExpandedScheduleDetails, setLoadingExpandedScheduleDetails] = useState<Record<number, boolean>>({});
  // Form creation states
  const [formName, setFormName] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [startTime, setStartTime] = useState<string>('');
  const [endTime, setEndTime] = useState<string>('');
  const [fundsFrom, setFundsFrom] = useState<Fund[]>([
    { name: 'Gratuity', selected: true, percentage: 100 },
    { name: 'Tips', selected: true, percentage: 100 }
  ]);
  const timeOptions = Array.from({ length: 96 }, (_, index) => {
    const hour = Math.floor(index / 4);
    const minute = (index % 4) * 15;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  });
  const dayOptions = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const formatTimeLabel = (value: string): string => {
    if (!value) {
      return '';
    }
    const [hours, minutes] = value.split(':').map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
      return value;
    }
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 === 0 ? 12 : hours % 12;
    return `${displayHours}:${String(minutes).padStart(2, '0')} ${period}`;
  };
  const formatCurrencyValue = (value: string): string => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return '';
    }
    return numeric.toFixed(2);
  };
  const [payoutContributors, setPayoutContributors] = useState<string[]>([]);
  const [isPayoutDropdownOpen, setIsPayoutDropdownOpen] = useState<boolean>(false);
  const [payoutContributorSearch, setPayoutContributorSearch] = useState<string>('');
  const [payoutReceivers, setPayoutReceivers] = useState<string[]>([]);
  const [isReceiverDropdownOpen, setIsReceiverDropdownOpen] = useState<boolean>(false);
  const [payoutReceiverSearch, setPayoutReceiverSearch] = useState<string>('');
  const [isStartDayOpen, setIsStartDayOpen] = useState<boolean>(false);
  const [isEndDayOpen, setIsEndDayOpen] = useState<boolean>(false);
  const [isStartTimeOpen, setIsStartTimeOpen] = useState<boolean>(false);
  const [isEndTimeOpen, setIsEndTimeOpen] = useState<boolean>(false);
  const [prePayoutEntries, setPrePayoutEntries] = useState<
    Array<{ type: string; value: string; account: string }>
  >([]);
  const [openPrePayoutAccountIndex, setOpenPrePayoutAccountIndex] = useState<number | null>(null);
  const [prePayoutAccountSearches, setPrePayoutAccountSearches] = useState<Record<number, string>>({});
  const [prePayoutCustomAccounts, setPrePayoutCustomAccounts] = useState<string[]>([]);
  const [creatingPrePayoutIndex, setCreatingPrePayoutIndex] = useState<number | null>(null);
  const [newPrePayoutAccountName, setNewPrePayoutAccountName] = useState<string>('');
  const [payoutRule, setPayoutRule] = useState<string>('Job Weighted Payout');
  const [customIndividualContribution, setCustomIndividualContribution] = useState<string>('');
  const [customGroupContribution, setCustomGroupContribution] = useState<string>('');
  const [receiverPercentages, setReceiverPercentages] = useState<Record<string, string>>({});
  const prePayoutAccountsStorageKey = restaurantKey
    ? `prePayoutAccounts:restaurant:${restaurantKey}`
    : null;

  const mergeUniqueAccounts = (base: string[], next: string[]) => {
    const seen = new Set(base.map((value) => value.toLowerCase()));
    const merged = [...base];
    next.forEach((value) => {
      const trimmed = value.trim();
      if (!trimmed) {
        return;
      }
      const key = trimmed.toLowerCase();
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      merged.push(trimmed);
    });
    return merged;
  };

  const persistPrePayoutAccounts = (accounts: string[]) => {
    if (!prePayoutAccountsStorageKey) {
      return;
    }
    localStorage.setItem(prePayoutAccountsStorageKey, JSON.stringify(accounts));
  };

  useEffect(() => {
    const storedUserId = localStorage.getItem('userId');
    if (storedUserId) {
      const parsedId = Number(storedUserId);
      if (Number.isFinite(parsedId)) {
        setUserId(parsedId);
      }
    }
    const storedRestaurantKey = localStorage.getItem('restaurantKey');
    if (storedRestaurantKey) {
      setRestaurantKey(storedRestaurantKey);
    }
  }, []);

  useEffect(() => {
    if (!prePayoutAccountsStorageKey) {
      return;
    }
    const stored = localStorage.getItem(prePayoutAccountsStorageKey);
    if (!stored) {
      return;
    }
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        const cleaned = parsed.filter((value) => typeof value === 'string' && value.trim());
        setPrePayoutCustomAccounts((prev) => mergeUniqueAccounts(prev, cleaned));
      }
    } catch {
      // Ignore invalid stored values.
    }
  }, [prePayoutAccountsStorageKey]);

  useEffect(() => {
    if (!selectedScheduleId) {
      return;
    }
    const stillExists = schedules.some(
      (schedule) => schedule.payout_schedule_id === selectedScheduleId
    );
    if (!stillExists) {
      setSelectedScheduleId(null);
      if (expandedScheduleId === selectedScheduleId) {
        setExpandedScheduleId(null);
      }
    }
  }, [expandedScheduleId, schedules, selectedScheduleId]);

  useEffect(() => {
    const fetchJobTitles = async () => {
      if (userId === null) {
        setJobTitles([]);
        return;
      }
      setJobTitlesError('');
      try {
        const res = await fetch(`${API_BASE_URL}/job-titles?user_id=${userId}`);
        if (!res.ok) {
          throw new Error(`Failed to fetch job titles (${res.status})`);
        }
        const data = await res.json();
        setJobTitles(Array.isArray(data) ? data : []);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to fetch job titles';
        setJobTitlesError(message);
      }
    };
    fetchJobTitles();
  }, [restaurantKey, userId]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }
      if (isPayoutDropdownOpen && !target.closest('[data-payout-dropdown="true"]')) {
        setIsPayoutDropdownOpen(false);
      }
      if (isReceiverDropdownOpen && !target.closest('[data-receiver-dropdown="true"]')) {
        setIsReceiverDropdownOpen(false);
      }
      if (isStartDayOpen && !target.closest('[data-start-day-dropdown="true"]')) {
        setIsStartDayOpen(false);
      }
      if (isEndDayOpen && !target.closest('[data-end-day-dropdown="true"]')) {
        setIsEndDayOpen(false);
      }
      if (isStartTimeOpen && !target.closest('[data-start-time-dropdown="true"]')) {
        setIsStartTimeOpen(false);
      }
      if (isEndTimeOpen && !target.closest('[data-end-time-dropdown="true"]')) {
        setIsEndTimeOpen(false);
      }
      if (openPrePayoutAccountIndex !== null && !target.closest('[data-pre-payout-dropdown="true"]')) {
        setOpenPrePayoutAccountIndex(null);
        setCreatingPrePayoutIndex(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [
    isPayoutDropdownOpen,
    isReceiverDropdownOpen,
    isStartDayOpen,
    isEndDayOpen,
    isStartTimeOpen,
    isEndTimeOpen,
    openPrePayoutAccountIndex,
  ]);

  useEffect(() => {
    const payoutPercentTargets = Array.from(
      new Set([...payoutContributors, ...payoutReceivers])
    );
    setReceiverPercentages((prev) => {
      const next: Record<string, string> = {};
      payoutPercentTargets.forEach((name) => {
        next[name] = typeof prev[name] === 'string' ? prev[name] : '';
      });
      return next;
    });
  }, [payoutContributors, payoutReceivers]);

  const fetchSchedules = useCallback(async () => {
    if (userId === null) {
      return;
    }
    setIsLoadingSchedules(true);
    setSchedulesError('');
    try {
      const params = new URLSearchParams({ user_id: String(userId) });
      const numericRestaurantId = Number(restaurantKey);
      if (Number.isFinite(numericRestaurantId)) {
        params.set('restaurant_id', String(numericRestaurantId));
      }
      const res = await fetch(`${API_BASE_URL}/payout-schedules?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`Failed to fetch schedules (${res.status})`);
      }
      const data = await res.json();
      setSchedules(Array.isArray(data) ? data : []);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch schedules';
      setSchedulesError(message);
    } finally {
      setIsLoadingSchedules(false);
    }
  }, [userId]);

  useEffect(() => {
    if (activeView === 'existing') {
      fetchSchedules();
    }
  }, [activeView, fetchSchedules]);

  const formatDayRange = (start: string | null, end: string | null) => {
    if (!start && !end) return '—';
    if (start && end) return `${start} - ${end}`;
    return start || end || '—';
  };

  const formatTimeRange = (start: string | null, end: string | null) => {
    if (!start && !end) return '—';
    if (start && end) return `${start} - ${end}`;
    return start || end || '—';
  };

  const payoutRuleLabel = (ruleId: string | null) => {
    switch (ruleId) {
      case '1':
        return 'Custom Payout';
      case '2':
        return 'Equal Payout';
      case '3':
        return 'Hour Based Payout';
      case '4':
        return 'Job Weighted Payout';
      default:
        return '—';
    }
  };

  const payoutRuleFromLabel = (ruleId: string | null) => {
    switch (ruleId) {
      case '1':
        return 'Custom Payout';
      case '2':
        return 'Equal Payout';
      case '3':
        return 'Hour Based Payout';
      case '4':
        return 'Job Weighted Payout';
      default:
        return 'Job Weighted Payout';
    }
  };

  const loadScheduleDetails = async (scheduleId: number) => {
    if (userId === null) {
      setScheduleDetailsError('Please log in again to view schedules.');
      return;
    }
    setIsLoadingScheduleDetails(true);
    setScheduleDetailsError('');
    try {
      const res = await fetch(
        `${API_BASE_URL}/payout-schedules/${scheduleId}?user_id=${userId}`
      );
      if (!res.ok) {
        throw new Error(`Failed to fetch schedule (${res.status})`);
      }
      const data: PayoutScheduleDetail = await res.json();
      setFormName(data.name ?? '');
      setStartDate(data.start_day ?? '');
      setEndDate(data.end_day ?? '');
      setStartTime(data.start_time ?? '');
      setEndTime(data.end_time ?? '');
      setPayoutRule(payoutRuleFromLabel(data.payout_rule_id ?? null));

      setFundsFrom((prev) =>
        prev.map((fund) => {
          const key = fund.name.toLowerCase();
          const triggerValue =
            key === 'gratuity'
              ? data.payout_triggers?.gratuity
              : key === 'tips'
                ? data.payout_triggers?.tips
                : undefined;
          return {
            ...fund,
            percentage:
              typeof triggerValue === 'number' && Number.isFinite(triggerValue)
                ? triggerValue
                : fund.percentage,
          };
        })
      );

      const contributorNames: string[] = [];
      const receiverNames: string[] = [];
      const receiverPercentagesMap: Record<string, string> = {};
      (data.payout_receivers || []).forEach((receiver) => {
        if (receiver.payout_receiver_id) {
          const isReceiver =
            receiver.contributor_receiver === 1 ||
            receiver.contributor_receiver === true ||
            receiver.contributor_receiver === null ||
            receiver.contributor_receiver === undefined;
          if (isReceiver) {
            if (!receiverNames.includes(receiver.payout_receiver_id)) {
              receiverNames.push(receiver.payout_receiver_id);
            }
          } else if (!contributorNames.includes(receiver.payout_receiver_id)) {
            contributorNames.push(receiver.payout_receiver_id);
          }
          receiverPercentagesMap[receiver.payout_receiver_id] =
            receiver.payout_percentage !== null && receiver.payout_percentage !== undefined
              ? String(receiver.payout_percentage)
              : '';
        }
      });
      setReceiverPercentages(receiverPercentagesMap);
      setPayoutContributors(contributorNames);
      setPayoutReceivers(receiverNames);
      setEditingScheduleId(scheduleId);

      setCustomIndividualContribution(
        data.custom_individual_payout !== null && data.custom_individual_payout !== undefined
          ? String(data.custom_individual_payout)
          : ''
      );
      setCustomGroupContribution(
        data.custom_group_contribution !== null && data.custom_group_contribution !== undefined
          ? String(data.custom_group_contribution)
          : ''
      );

      const prePayouts = (data.pre_payouts || []).map((entry) => ({
        type: Number(entry.pre_payout_option) === 1 ? 'Fixed Amount' : 'Percentage',
        value:
          entry.pre_payout_value !== null && entry.pre_payout_value !== undefined
            ? String(entry.pre_payout_value)
            : '',
        account: entry.user_account || '',
      }));
      const prePayoutAccounts = prePayouts
        .map((entry) => entry.account)
        .filter((account) => account && !jobTitles.includes(account));
      if (prePayoutAccounts.length > 0) {
        setPrePayoutCustomAccounts((prev) => {
          const merged = mergeUniqueAccounts(prev, prePayoutAccounts);
          persistPrePayoutAccounts(merged);
          return merged;
        });
      }
      setPrePayoutEntries(prePayouts);
      setActiveView('create');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch schedule';
      setScheduleDetailsError(message);
    } finally {
      setIsLoadingScheduleDetails(false);
    }
  };

  const toggleScheduleExpanded = async (scheduleId: number) => {
    const isCurrentlyExpanded = expandedScheduleId === scheduleId;
    setExpandedScheduleId((prev) => (prev === scheduleId ? null : scheduleId));

    // Fetch details if expanding and not already loaded
    if (!isCurrentlyExpanded && !expandedScheduleDetails[scheduleId]) {
      setLoadingExpandedScheduleDetails({ ...loadingExpandedScheduleDetails, [scheduleId]: true });
      try {
        const response = await fetch(
          `${API_BASE_URL}/payout-schedules/${scheduleId}?user_id=${userId}`,
          { headers: { 'Content-Type': 'application/json' } }
        );
        if (!response.ok) {
          throw new Error('Failed to load schedule details');
        }
        const data = await response.json();
        setExpandedScheduleDetails({ ...expandedScheduleDetails, [scheduleId]: data });
      } catch (error) {
        console.error('Failed to load schedule details:', error);
      } finally {
        setLoadingExpandedScheduleDetails({ ...loadingExpandedScheduleDetails, [scheduleId]: false });
      }
    }
  };

  const handleDeleteSchedule = async () => {
    if (userId === null || selectedScheduleId === null) {
      return;
    }
    setIsDeletingSchedule(true);
    setDeleteScheduleError('');
    setDeleteScheduleSuccess('');
    try {
      const res = await fetch(
        `${API_BASE_URL}/payout-schedules/${selectedScheduleId}?user_id=${userId}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        let message = `Failed to delete schedule (${res.status})`;
        try {
          const data = await res.json();
          message = data.detail || message;
        } catch {
          // Ignore JSON parsing errors.
        }
        throw new Error(message);
      }
      setDeleteScheduleSuccess('Schedule deleted.');
      setSelectedScheduleId(null);
      setExpandedScheduleId(null);
      await fetchSchedules();
      window.setTimeout(() => setDeleteScheduleSuccess(''), 3000);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete schedule';
      setDeleteScheduleError(message);
    } finally {
      setIsDeletingSchedule(false);
    }
  };

  const updateFundPercentage = (index: number, value: string) => {
    const numericValue = Number(value);
    setFundsFrom((prev) =>
      prev.map((fund, idx) =>
        idx === index
          ? { ...fund, percentage: Number.isFinite(numericValue) ? numericValue : 0 }
          : fund
      )
    );
  };

  const payoutPercentTargets = Array.from(
    new Set([...payoutContributors, ...payoutReceivers])
  );
  const receiverPercentageTotal = payoutPercentTargets.reduce((sum, receiver) => {
    const value = Number(receiverPercentages[receiver] ?? 0);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
  const resetFormFields = () => {
    setFormName('');
    setStartDate('');
    setEndDate('');
    setStartTime('');
    setEndTime('');
    setFundsFrom((prev) => prev.map((fund) => ({ ...fund, selected: true, percentage: 100 })));
    setPayoutContributors([]);
    setPayoutReceivers([]);
    setReceiverPercentages({});
    setPayoutRule('Job Weighted Payout');
    setCustomIndividualContribution('');
    setCustomGroupContribution('');
    setIsPayoutDropdownOpen(false);
    setIsReceiverDropdownOpen(false);
    setPayoutContributorSearch('');
    setPayoutReceiverSearch('');
    setIsStartDayOpen(false);
    setIsEndDayOpen(false);
    setIsStartTimeOpen(false);
    setIsEndTimeOpen(false);
    setPrePayoutEntries([]);
    setOpenPrePayoutAccountIndex(null);
    setPrePayoutAccountSearches({});
    setCreatingPrePayoutIndex(null);
    setNewPrePayoutAccountName('');
    setScheduleDetailsError('');
    setIsLoadingScheduleDetails(false);
    setSubmitError('');
    setSubmitSuccess('');
    setEditingScheduleId(null);
  };

  const handleCreateForm = async () => {
    if (userId === null) {
      setSubmitError('Please log in again to save a schedule.');
      return;
    }
    if (!formName.trim()) {
      setSubmitError('Schedule name is required.');
      return;
    }
    if (
      (payoutRule === 'Custom Payout' || payoutRule === 'Job Weighted Payout') &&
      payoutPercentTargets.length > 0 &&
      Math.abs(receiverPercentageTotal - 100) > 0.01
    ) {
      setSubmitError('Payout percentages must total 100%.');
      return;
    }

    setIsSubmitting(true);
    setSubmitError('');
    setSubmitSuccess('');

    const toNumberOrNull = (value: string): number | null => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    };

    const gratuityTrigger = fundsFrom.find(
      (fund) => fund.name.toLowerCase() === 'gratuity'
    )?.percentage;
    const tipsTrigger = fundsFrom.find(
      (fund) => fund.name.toLowerCase() === 'tips'
    )?.percentage;

    const payoutPercentages: Record<string, number> = {};
    Object.entries(receiverPercentages).forEach(([key, value]) => {
      const numeric = toNumberOrNull(value);
      if (numeric !== null) {
        payoutPercentages[key] = numeric;
      }
    });

    const payload = {
      user_id: userId,
      name: formName.trim(),
      start_day: startDate || null,
      end_day: endDate || null,
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
      custom_individual_payout: toNumberOrNull(customIndividualContribution),
      custom_group_contribution: toNumberOrNull(customGroupContribution),
      pre_payouts: prePayoutEntries.map((entry) => ({
        option: entry.type,
        value: toNumberOrNull(entry.value),
        account: entry.account,
      })),
    };
    const unmatchedPrePayoutAccounts = prePayoutEntries
      .map((entry) => entry.account.trim())
      .filter((account) => account && !jobTitles.includes(account));
    if (unmatchedPrePayoutAccounts.length > 0) {
      const mergedAccounts = mergeUniqueAccounts(prePayoutCustomAccounts, unmatchedPrePayoutAccounts);
      setPrePayoutCustomAccounts(mergedAccounts);
      persistPrePayoutAccounts(mergedAccounts);
    }

    const isEditing = editingScheduleId !== null;
    const endpoint = isEditing
      ? `${API_BASE_URL}/payout-schedules/${editingScheduleId}`
      : `${API_BASE_URL}/payout-schedules`;
    const method = isEditing ? 'PUT' : 'POST';

    try {
      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let message = `Failed to save schedule (${res.status})`;
        try {
          const data = await res.json();
          message = data.detail || message;
        } catch {
          // Ignore JSON parsing errors.
        }
        throw new Error(message);
      }
      setSubmitSuccess(isEditing ? 'Schedule updated successfully.' : 'Schedule saved successfully.');
      resetFormFields();
      setActiveView('existing');
      await fetchSchedules();
      window.setTimeout(() => setSubmitSuccess(''), 3000);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save schedule';
      setSubmitError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-8">
      {isDeleteConfirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900">Delete schedule?</h2>
            <p className="mt-2 text-sm text-gray-600">
              This action cannot be undone. Are you sure you want to delete this payout schedule?
            </p>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsDeleteConfirmOpen(false)}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-900 font-semibold hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  setIsDeleteConfirmOpen(false);
                  await handleDeleteSchedule();
                }}
                className="px-4 py-2 rounded-lg bg-[#cab99a] text-black font-semibold hover:bg-[#bfa986]"
              >
                Yes, delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {activeView === 'existing' ? (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Shift Payout Schedules</h1>
              <p className="text-sm text-gray-500">Create and manage shift payout schedules for your team.</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  resetFormFields();
                  setActiveView('create');
                }}
                className="bg-[#cab99a] text-black px-6 py-3 rounded-lg font-semibold hover:bg-[#bfa986] transition-all shadow-md"
              >
                Create Schedule
              </button>
              <button
                type="button"
                onClick={() => setIsDeleteConfirmOpen(true)}
                disabled={!selectedScheduleId || isDeletingSchedule}
                className={`px-6 py-3 rounded-lg font-semibold transition-all shadow-md ${
                  selectedScheduleId && !isDeletingSchedule
                    ? 'bg-[#cab99a] text-black hover:bg-[#bfa986]'
                    : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                }`}
              >
                {isDeletingSchedule ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>

          {deleteScheduleError ? (
            <p className="text-sm text-red-600 mb-4">{deleteScheduleError}</p>
          ) : deleteScheduleSuccess ? (
            <p className="text-sm text-green-600 mb-4">{deleteScheduleSuccess}</p>
          ) : null}

          <div className="space-y-4">
            {isLoadingSchedules ? (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 px-6 py-6 text-center text-sm text-gray-600">
                Loading schedules...
              </div>
            ) : schedulesError ? (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 px-6 py-6 text-center text-sm text-red-600">
                {schedulesError}
              </div>
            ) : schedules.length === 0 ? (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 px-6 py-6 text-center text-sm text-gray-600">
                No schedules yet. Create your first payout schedule.
              </div>
            ) : (
              schedules.map((schedule) => {
                const isSelected = selectedScheduleId === schedule.payout_schedule_id;
                const isExpanded = expandedScheduleId === schedule.payout_schedule_id;
                return (
                  <div
                    key={schedule.payout_schedule_id}
                    className={`rounded-xl border shadow-sm transition-colors ${
                      isSelected ? 'border-gray-900 bg-gray-50' : 'border-gray-200 bg-white'
                    }`}
                  >
                    <div
                      className="flex items-start gap-4 p-5 cursor-pointer"
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleScheduleExpanded(schedule.payout_schedule_id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          toggleScheduleExpanded(schedule.payout_schedule_id);
                        }
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(event) =>
                          setSelectedScheduleId(event.target.checked ? schedule.payout_schedule_id : null)
                        }
                        onClick={(event) => event.stopPropagation()}
                        className="mt-1 h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
                      />
                      <div className="grid w-full gap-4 sm:grid-cols-2 lg:grid-cols-5">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Name</p>
                          <p className="text-sm font-semibold text-gray-900">{schedule.name}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Status</p>
                          <p className="text-sm text-gray-700">
                            {schedule.start_day || schedule.start_time ? 'Scheduled' : 'Draft'}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Payout Rule</p>
                          <p className="text-sm text-gray-700">{payoutRuleLabel(schedule.payout_rule_id)}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Day</p>
                          <p className="text-sm text-gray-700">
                            {formatDayRange(schedule.start_day, schedule.end_day)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Time</p>
                          <p className="text-sm text-gray-700">
                            {formatTimeRange(schedule.start_time, schedule.end_time)}
                          </p>
                        </div>
                      </div>
                      <span className="text-lg font-semibold text-gray-400">{isExpanded ? '-' : '+'}</span>
                    </div>
                    {isExpanded ? (
                      <div className="border-t border-gray-200 px-5 py-4 space-y-4">
                        {loadingExpandedScheduleDetails[schedule.payout_schedule_id] ? (
                          <div className="text-center py-8">
                            <p className="text-sm text-gray-600">Loading schedule details...</p>
                          </div>
                        ) : expandedScheduleDetails[schedule.payout_schedule_id] ? (
                          <>
                            {/* Payout Triggers Section */}
                            {expandedScheduleDetails[schedule.payout_schedule_id]?.payout_triggers && (
                              <div className="border-b border-gray-100 pb-4">
                                <h4 className="font-semibold text-gray-700 mb-3">Payout Triggers</h4>
                                <div className="grid grid-cols-2 gap-4">
                                  <div className="text-sm">
                                    <span className="font-medium text-gray-600">Gratuity Contribution:</span>{' '}
                                    <span className="text-gray-900">
                                      {expandedScheduleDetails[schedule.payout_schedule_id].payout_triggers.gratuity ?? 'N/A'}%
                                    </span>
                                  </div>
                                  <div className="text-sm">
                                    <span className="font-medium text-gray-600">Tips Contribution:</span>{' '}
                                    <span className="text-gray-900">
                                      {expandedScheduleDetails[schedule.payout_schedule_id].payout_triggers.tips ?? 'N/A'}%
                                    </span>
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Contributor(s) Section */}
                            {expandedScheduleDetails[schedule.payout_schedule_id]?.payout_receivers?.some(
                              (r: any) => r.contributor_receiver === 0
                            ) && (
                              <div className="border-b border-gray-100 pb-4">
                                <h4 className="font-semibold text-gray-700 mb-3">Contributor(s)</h4>
                                <div className="flex flex-wrap gap-2">
                                  {expandedScheduleDetails[schedule.payout_schedule_id].payout_receivers
                                    .filter((r: any) => r.contributor_receiver === 0)
                                    .map((receiver: any, idx: number) => (
                                      <span
                                        key={idx}
                                        className="px-3 py-1 bg-gray-100 rounded-full text-sm text-gray-700 font-medium"
                                      >
                                        {receiver.payout_receiver_id}
                                      </span>
                                    ))}
                                </div>
                              </div>
                            )}

                            {/* Receiver(s) Section */}
                            {expandedScheduleDetails[schedule.payout_schedule_id]?.payout_receivers?.some(
                              (r: any) => r.contributor_receiver === 1
                            ) && (
                              <div className="border-b border-gray-100 pb-4">
                                <h4 className="font-semibold text-gray-700 mb-3">Receiver(s)</h4>
                                <div className="space-y-2">
                                  {expandedScheduleDetails[schedule.payout_schedule_id].payout_receivers
                                    .filter((r: any) => r.contributor_receiver === 1)
                                    .map((receiver: any, idx: number) => (
                                      <div key={idx} className="flex justify-between text-sm">
                                        <span className="text-gray-700">{receiver.payout_receiver_id}</span>
                                        <span className="font-semibold text-gray-900">
                                          {receiver.payout_percentage !== null ? `${receiver.payout_percentage}%` : 'N/A'}
                                        </span>
                                      </div>
                                    ))}
                                </div>
                              </div>
                            )}

                            {/* Pre-Payout Entries Section */}
                            {expandedScheduleDetails[schedule.payout_schedule_id]?.pre_payouts &&
                              expandedScheduleDetails[schedule.payout_schedule_id].pre_payouts.length > 0 && (
                                <div className="border-b border-gray-100 pb-4">
                                  <h4 className="font-semibold text-gray-700 mb-3">Pre-Payout Entries</h4>
                                  <div className="space-y-2">
                                    {expandedScheduleDetails[schedule.payout_schedule_id].pre_payouts.map(
                                      (prePayout: any, idx: number) => (
                                        <div key={idx} className="flex justify-between text-sm">
                                          <span className="text-gray-700">{prePayout.user_account || 'Unknown'}</span>
                                          <span className="font-semibold text-gray-900">
                                            {prePayout.pre_payout_option === 1
                                              ? `$${prePayout.pre_payout_value}`
                                              : `${prePayout.pre_payout_value}%`}
                                          </span>
                                        </div>
                                      )
                                    )}
                                  </div>
                                </div>
                              )}

                            {/* Edit Schedule Button */}
                            <div className="flex justify-end pt-4">
                              <button
                                type="button"
                                onClick={() => loadScheduleDetails(schedule.payout_schedule_id)}
                                className="bg-[#cab99a] text-black px-6 py-2 rounded-lg text-sm font-semibold hover:bg-[#bfa986] transition-all"
                              >
                                Edit Schedule
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className="text-center py-8">
                            <p className="text-sm text-red-600">Failed to load schedule details</p>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : (
        <div className="max-w-5xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">
            {editingScheduleId ? 'Edit Payout Schedule' : 'Create Payout Schedule'}
          </h1>
          {scheduleDetailsError ? (
            <p className="text-sm text-red-600 mb-6">{scheduleDetailsError}</p>
          ) : isLoadingScheduleDetails ? (
            <p className="text-sm text-gray-600 mb-6">Loading schedule...</p>
          ) : null}
                
                <div className="space-y-8">
                  {/* Schedule */}
                  <div className="bg-white rounded-lg shadow-md p-6">
                    <h2 className="text-xl font-bold text-gray-900 mb-4">Schedule</h2>
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Payout Schedule Name</label>
                    <input
                      type="text"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
                      placeholder="Schedule Name"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Start Day</label>
                      <div className="relative" data-start-day-dropdown="true">
                        <button
                          type="button"
                          onClick={() => setIsStartDayOpen((prev) => !prev)}
                          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 outline-none bg-white text-left flex items-center justify-between gap-3"
                        >
                          <span className={startDate ? 'text-gray-900' : 'text-gray-500'}>
                            {startDate || 'Select day'}
                          </span>
                          <span className="text-gray-500">▾</span>
                        </button>
                        {isStartDayOpen ? (
                          <div className="absolute z-10 mt-2 w-full max-h-60 overflow-auto border border-gray-200 rounded-lg bg-white shadow-lg">
                            {dayOptions.map((day) => (
                              <button
                                key={`start-day-${day}`}
                                type="button"
                                onClick={() => {
                                  setStartDate(day);
                                  setIsStartDayOpen(false);
                                }}
                                className="w-full px-4 py-2 text-left text-sm text-gray-900 hover:bg-gray-50"
                              >
                                {day}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">End Day</label>
                      <div className="relative" data-end-day-dropdown="true">
                        <button
                          type="button"
                          onClick={() => setIsEndDayOpen((prev) => !prev)}
                          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 outline-none bg-white text-left flex items-center justify-between gap-3"
                        >
                          <span className={endDate ? 'text-gray-900' : 'text-gray-500'}>
                            {endDate || 'Select day'}
                          </span>
                          <span className="text-gray-500">▾</span>
                        </button>
                        {isEndDayOpen ? (
                          <div className="absolute z-10 mt-2 w-full max-h-60 overflow-auto border border-gray-200 rounded-lg bg-white shadow-lg">
                            {dayOptions.map((day) => (
                              <button
                                key={`end-day-${day}`}
                                type="button"
                                onClick={() => {
                                  setEndDate(day);
                                  setIsEndDayOpen(false);
                                }}
                                className="w-full px-4 py-2 text-left text-sm text-gray-900 hover:bg-gray-50"
                              >
                                {day}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Start Time</label>
                      <div className="relative" data-start-time-dropdown="true">
                        <button
                          type="button"
                          onClick={() => setIsStartTimeOpen((prev) => !prev)}
                          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 outline-none bg-white text-left flex items-center justify-between gap-3"
                        >
                          <span className={startTime ? 'text-gray-900' : 'text-gray-500'}>
                            {startTime ? formatTimeLabel(startTime) : 'Select time'}
                          </span>
                          <span className="text-gray-500">▾</span>
                        </button>
                        {isStartTimeOpen ? (
                          <div className="absolute z-10 mt-2 w-full max-h-60 overflow-auto border border-gray-200 rounded-lg bg-white shadow-lg">
                            {timeOptions.map((option) => (
                              <button
                                key={`start-time-${option}`}
                                type="button"
                                onClick={() => {
                                  setStartTime(option);
                                  setIsStartTimeOpen(false);
                                }}
                                className="w-full px-4 py-2 text-left text-sm text-gray-900 hover:bg-gray-50"
                              >
                                {formatTimeLabel(option)}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">End Time</label>
                      <div className="relative" data-end-time-dropdown="true">
                        <button
                          type="button"
                          onClick={() => setIsEndTimeOpen((prev) => !prev)}
                          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 outline-none bg-white text-left flex items-center justify-between gap-3"
                        >
                          <span className={endTime ? 'text-gray-900' : 'text-gray-500'}>
                            {endTime ? formatTimeLabel(endTime) : 'Select time'}
                          </span>
                          <span className="text-gray-500">▾</span>
                        </button>
                        {isEndTimeOpen ? (
                          <div className="absolute z-10 mt-2 w-full max-h-60 overflow-auto border border-gray-200 rounded-lg bg-white shadow-lg">
                            {timeOptions.map((option) => (
                              <button
                                key={`end-time-${option}`}
                                type="button"
                                onClick={() => {
                                  setEndTime(option);
                                  setIsEndTimeOpen(false);
                                }}
                                className="w-full px-4 py-2 text-left text-sm text-gray-900 hover:bg-gray-50"
                              >
                                {formatTimeLabel(option)}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  
                </div>

                {/* Recipients */}
                <div className="bg-white rounded-lg shadow-md p-6">
                  <h3 className="text-xl font-bold text-gray-900 mb-4">Payout</h3>
                  <p className="text-sm font-medium text-gray-700 mb-3">Payout Triggers</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
                    {fundsFrom.map((fund, index) => (
                      <div
                        key={`payout-trigger-${fund.name}`}
                        className="flex items-center justify-between gap-3 rounded-lg border-2 border-gray-300 bg-white px-4 py-3 font-semibold text-gray-900"
                      >
                        <span className="flex items-center gap-3">
                          {fund.name}
                        </span>
                        <span className="flex items-center gap-2">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="1"
                            value={fund.percentage}
                            onChange={(e) => updateFundPercentage(index, e.target.value)}
                            className="w-20 px-3 py-1 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 outline-none text-right"
                          />
                          <span className="text-sm text-gray-700">%</span>
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="text-sm font-medium text-gray-700 mb-4">Select Payout Contributors</p>
                  <div className="relative mb-6" data-payout-dropdown="true">
                    <button
                      type="button"
                      onClick={() => setIsPayoutDropdownOpen((prev) => !prev)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 outline-none bg-white text-left flex items-center justify-between gap-3"
                    >
                      <span className="flex flex-wrap gap-2 min-w-0 text-gray-900">
                        {payoutContributors.length > 0 ? (
                          payoutContributors.map((contributor) => (
                            <span
                              key={contributor}
                              className="bg-gray-100 px-2 py-1 rounded-full text-sm flex items-center gap-2 max-w-full"
                            >
                              <span className="truncate">{contributor}</span>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setPayoutContributors((prev) =>
                                    prev.filter((value) => value !== contributor)
                                  );
                                }}
                                className="text-gray-500 hover:text-gray-700"
                                aria-label={`Remove ${contributor}`}
                              >
                                ×
                              </button>
                            </span>
                          ))
                        ) : (
                          <span className="text-gray-500">Select Contributors</span>
                        )}
                      </span>
                      <span className="ml-2 text-gray-500">▾</span>
                    </button>
                    {isPayoutDropdownOpen ? (
                      <div className="absolute z-10 mt-2 w-full max-h-60 overflow-auto border border-gray-200 rounded-lg bg-white shadow-lg">
                        <div className="px-3 py-2 border-b border-gray-200">
                          <div className="relative">
                            <input
                              type="text"
                              value={payoutContributorSearch}
                              onChange={(e) => setPayoutContributorSearch(e.target.value)}
                              placeholder="Search contributors"
                              className="w-full px-3 py-2 pr-9 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 outline-none"
                            />
                            {payoutContributorSearch ? (
                              <button
                                type="button"
                                onClick={() => setPayoutContributorSearch('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                aria-label="Clear contributor search"
                              >
                                ×
                              </button>
                            ) : null}
                          </div>
                        </div>
                        {jobTitles.length === 0 ? (
                          <div className="px-4 py-3 text-sm text-gray-500">No job titles available</div>
                        ) : jobTitles.filter((jobTitle) =>
                          jobTitle.toLowerCase().includes(payoutContributorSearch.trim().toLowerCase())
                        ).length === 0 ? (
                          <div className="px-4 py-3 text-sm text-gray-500">No matches found</div>
                        ) : (
                          jobTitles
                            .filter((jobTitle) =>
                              jobTitle.toLowerCase().includes(payoutContributorSearch.trim().toLowerCase())
                            )
                            .map((jobTitle) => {
                              const isSelected = payoutContributors.includes(jobTitle);
                              return (
                                <label
                                  key={jobTitle}
                                  className="flex items-center gap-2 px-4 py-2 text-sm text-gray-900 hover:bg-gray-50"
                                >
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={(e) => {
                                      setPayoutContributors((prev) => {
                                        if (e.target.checked) {
                                          return prev.includes(jobTitle) ? prev : [...prev, jobTitle];
                                        }
                                        return prev.filter((value) => value !== jobTitle);
                                      });
                                    }}
                                    className="h-4 w-4"
                                  />
                                  <span>{jobTitle}</span>
                                </label>
                              );
                            })
                        )}
                      </div>
                    ) : null}
                  </div>
                  {jobTitlesError ? (
                    <p className="text-sm text-red-600 mb-6">{jobTitlesError}</p>
                  ) : null}

                  <p className="text-sm font-medium text-gray-700 mb-4">Select Payout Receivers</p>
                  <div className="relative mb-6" data-receiver-dropdown="true">
                    <button
                      type="button"
                      onClick={() => setIsReceiverDropdownOpen((prev) => !prev)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 outline-none bg-white text-left flex items-center justify-between gap-3"
                    >
                      <span className="flex flex-wrap gap-2 min-w-0 text-gray-900">
                        {payoutReceivers.length > 0 ? (
                          payoutReceivers.map((receiver) => (
                            <span
                              key={`payout-receiver-${receiver}`}
                              className="bg-gray-100 px-2 py-1 rounded-full text-sm flex items-center gap-2 max-w-full"
                            >
                              <span className="truncate">{receiver}</span>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setPayoutReceivers((prev) =>
                                    prev.filter((value) => value !== receiver)
                                  );
                                }}
                                className="text-gray-500 hover:text-gray-700"
                                aria-label={`Remove ${receiver}`}
                              >
                                ×
                              </button>
                            </span>
                          ))
                        ) : (
                          <span className="text-gray-500">Select Receivers</span>
                        )}
                      </span>
                      <span className="ml-2 text-gray-500">▾</span>
                    </button>
                    {isReceiverDropdownOpen ? (
                      <div className="absolute z-10 mt-2 w-full max-h-60 overflow-auto border border-gray-200 rounded-lg bg-white shadow-lg">
                        <div className="px-3 py-2 border-b border-gray-200">
                          <div className="relative">
                            <input
                              type="text"
                              value={payoutReceiverSearch}
                              onChange={(e) => setPayoutReceiverSearch(e.target.value)}
                              placeholder="Search receivers"
                              className="w-full px-3 py-2 pr-9 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 outline-none"
                            />
                            {payoutReceiverSearch ? (
                              <button
                                type="button"
                                onClick={() => setPayoutReceiverSearch('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                aria-label="Clear receiver search"
                              >
                                ×
                              </button>
                            ) : null}
                          </div>
                        </div>
                        {jobTitles.length === 0 ? (
                          <div className="px-4 py-3 text-sm text-gray-500">No job titles available</div>
                        ) : jobTitles.filter((jobTitle) =>
                          jobTitle.toLowerCase().includes(payoutReceiverSearch.trim().toLowerCase())
                        ).length === 0 ? (
                          <div className="px-4 py-3 text-sm text-gray-500">No matches found</div>
                        ) : (
                          jobTitles
                            .filter((jobTitle) =>
                              jobTitle.toLowerCase().includes(payoutReceiverSearch.trim().toLowerCase())
                            )
                            .map((jobTitle) => {
                              const isSelected = payoutReceivers.includes(jobTitle);
                              return (
                                <label
                                  key={`payout-receiver-option-${jobTitle}`}
                                  className="flex items-center gap-2 px-4 py-2 text-sm text-gray-900 hover:bg-gray-50"
                                >
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={(e) => {
                                      setPayoutReceivers((prev) => {
                                        if (e.target.checked) {
                                          return prev.includes(jobTitle) ? prev : [...prev, jobTitle];
                                        }
                                        return prev.filter((value) => value !== jobTitle);
                                      });
                                    }}
                                    className="h-4 w-4"
                                  />
                                  <span>{jobTitle}</span>
                                </label>
                              );
                            })
                        )}
                      </div>
                    ) : null}
                  </div>
                  {jobTitlesError ? (
                    <p className="text-sm text-red-600 mb-6">{jobTitlesError}</p>
                  ) : null}

                  <p className="text-sm font-medium text-gray-700 mb-4">Payout Rule</p>
                  <div className="flex flex-wrap gap-4 mb-6">
                    {[
                      'Custom Payout',
                      'Equal Payout',
                      'Hour Based Payout',
                      'Job Weighted Payout'
                    ].map((option) => (
                      <label key={option} className="flex items-center gap-2 text-sm text-gray-900">
                        <input
                          type="radio"
                          name="payout-rule"
                          checked={payoutRule === option}
                          onChange={() => setPayoutRule(option)}
                          className="h-4 w-4"
                        />
                        <span>{option}</span>
                      </label>
                    ))}
                  </div>
                  {payoutRule === 'Custom Payout' ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
                      <div className="flex items-center justify-between gap-3 rounded-lg border-2 border-gray-300 bg-white px-4 py-3 font-semibold text-gray-900">
                        <span>Individual Payout</span>
                        <span className="flex items-center gap-2">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            value={customIndividualContribution}
                            onChange={(e) => setCustomIndividualContribution(e.target.value)}
                            className="w-20 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 outline-none text-right"
                          />
                          <span className="text-sm text-gray-700">%</span>
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3 rounded-lg border-2 border-gray-300 bg-white px-4 py-3 font-semibold text-gray-900">
                        <span>Group Contribution</span>
                        <span className="flex items-center gap-2">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            value={customGroupContribution}
                            onChange={(e) => setCustomGroupContribution(e.target.value)}
                            className="w-20 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 outline-none text-right"
                          />
                          <span className="text-sm text-gray-700">%</span>
                        </span>
                      </div>
                    </div>
                  ) : null}

                  {payoutRule === 'Equal Payout' ? (
                    <div className="mt-6">
                      <p className="font-semibold text-red-600">
                        All employees will receive an equal payout
                      </p>
                    </div>
                  ) : payoutRule === 'Hour Based Payout' ? (
                    <div className="mt-6">
                      <p className="font-semibold text-red-600">
                        All employees will receive a payout based on hours worked
                      </p>
                    </div>
                  ) : payoutRule === 'Custom Payout' || payoutRule === 'Job Weighted Payout' ? (
                    <div className="mt-6">
                      <label className="block text-sm font-medium text-gray-700 mb-3">Payout Percentages</label>
                      {payoutPercentTargets.length === 0 ? (
                        <p className="text-sm text-gray-600">Select payout contributors or receivers to set percentages.</p>
                      ) : (
                        <div className="space-y-3">
                          {payoutPercentTargets.map((receiver) => (
                            <div
                              key={`receiver-percent-${receiver}`}
                              className="flex items-center justify-between gap-3 rounded-lg border-2 border-gray-300 bg-white px-4 py-3 font-semibold text-gray-900"
                            >
                              <span>{receiver}</span>
                              <span className="flex items-center gap-2">
                                <input
                                  type="number"
                                  min="0"
                                  max="100"
                                  step="0.01"
                                  value={receiverPercentages[receiver] ?? ''}
                                  onChange={(e) =>
                                    setReceiverPercentages((prev) => ({
                                      ...prev,
                                      [receiver]: e.target.value,
                                    }))
                                  }
                                  className="w-20 px-3 py-1 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 outline-none text-right"
                                />
                                <span className="text-sm text-gray-700">%</span>
                              </span>
                            </div>
                          ))}
                          <div className="text-sm text-gray-700">
                            Total: {receiverPercentageTotal.toFixed(2)}%
                          </div>
                          {Math.abs(receiverPercentageTotal - 100) > 0.01 && (
                            <div className="text-sm text-red-600">
                              Percentages must total 100%.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : null}

                </div>

                {/* Pre-Payout */}
                <div className="bg-white rounded-lg shadow-md p-6">
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <h2 className="text-xl font-bold text-gray-900">Pre-Payout</h2>
                    <button
                      type="button"
                      onClick={() =>
                        setPrePayoutEntries((prev) => [
                          ...prev,
                          { type: '', value: '', account: '' }
                        ])
                      }
                      className="bg-[#cab99a] text-black px-6 py-2 rounded-lg font-semibold hover:bg-[#bfa986] transition-all shadow-lg"
                    >
                      Add
                    </button>
                  </div>
                  <p className="text-sm text-gray-600 mb-4">Any amount that must be allocated to an account before Payout?</p>
                  <div className="space-y-6">
                    {prePayoutEntries.map((entry, index) => (
                      <div key={`pre-payout-entry-${index}`} className="space-y-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex flex-wrap gap-4">
                            {['Percentage', 'Fixed Amount'].map((option) => (
                              <label key={option} className="flex items-center gap-2 text-sm text-gray-900">
                                <input
                                  type="radio"
                                  name={`pre-payout-type-${index}`}
                                  checked={entry.type === option}
                                  onChange={() =>
                                    setPrePayoutEntries((prev) =>
                                      prev.map((item, itemIndex) =>
                                        itemIndex === index
                                          ? { ...item, type: option, value: '' }
                                          : item
                                      )
                                    )
                                  }
                                  className="h-4 w-4"
                                />
                                <span>{option}</span>
                              </label>
                            ))}
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setPrePayoutEntries((prev) =>
                                prev.filter((_, itemIndex) => itemIndex !== index)
                              )
                            }
                            className="bg-[#cab99a] text-black px-4 py-2 rounded-lg font-semibold hover:bg-[#bfa986] transition-all shadow-lg"
                          >
                            Delete
                          </button>
                        </div>
                        {entry.type ? (
                          <div className="flex items-center justify-between gap-3 rounded-lg border-2 border-gray-300 bg-white px-4 py-3 font-semibold text-gray-900">
                            <span>Set your {entry.type}</span>
                            <span className="flex items-center gap-2">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={entry.value}
                                onChange={(e) =>
                                  setPrePayoutEntries((prev) =>
                                    prev.map((item, itemIndex) =>
                                      itemIndex === index
                                        ? { ...item, value: e.target.value }
                                        : item
                                    )
                                  )
                                }
                                onBlur={() => {
                                  if (entry.type !== 'Fixed Amount') {
                                    return;
                                  }
                                  setPrePayoutEntries((prev) =>
                                    prev.map((item, itemIndex) =>
                                      itemIndex === index
                                        ? { ...item, value: formatCurrencyValue(item.value) }
                                        : item
                                    )
                                  );
                                }}
                                className="w-20 px-3 py-1 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 outline-none text-right"
                              />
                              <span className="text-sm text-gray-700">
                                {entry.type === 'Percentage' ? '%' : '$'}
                              </span>
                            </span>
                          </div>
                        ) : null}
                        <div>
                          <p className="text-sm font-medium text-gray-700 mb-4">Select Account for this Pre-Payout</p>
                          <div className="relative" data-pre-payout-dropdown="true">
                            <button
                              type="button"
                              onClick={() =>
                                setOpenPrePayoutAccountIndex((prev) =>
                                  prev === index ? null : index
                                )
                              }
                              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 outline-none bg-white text-left flex items-center justify-between gap-3"
                            >
                              <span className="flex flex-wrap gap-2 min-w-0 text-gray-900">
                                {entry.account ? (
                                  <span className="bg-gray-100 px-2 py-1 rounded-full text-sm flex items-center gap-2 max-w-full">
                                    <span className="truncate">{entry.account}</span>
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        setPrePayoutEntries((prev) =>
                                          prev.map((item, itemIndex) =>
                                            itemIndex === index
                                              ? { ...item, account: '' }
                                              : item
                                          )
                                        );
                                      }}
                                      className="text-gray-500 hover:text-gray-700"
                                      aria-label={`Remove ${entry.account}`}
                                    >
                                      ×
                                    </button>
                                  </span>
                                ) : (
                                  <span className="text-gray-500">Select Account</span>
                                )}
                              </span>
                              <span className="ml-2 text-gray-500">▾</span>
                            </button>
                            {openPrePayoutAccountIndex === index ? (
                              <div className="absolute z-10 mt-2 w-full max-h-60 overflow-auto border border-gray-200 rounded-lg bg-white shadow-lg">
                                <div className="px-3 py-2 border-b border-gray-200">
                                  <input
                                    type="text"
                                    value={prePayoutAccountSearches[index] ?? ''}
                                    onChange={(e) =>
                                      setPrePayoutAccountSearches((prev) => ({
                                        ...prev,
                                        [index]: e.target.value,
                                      }))
                                    }
                                    placeholder="Search accounts"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 outline-none"
                                  />
                                </div>
                                {([...jobTitles, ...prePayoutCustomAccounts]).filter(
                                  (jobTitle) =>
                                    !payoutContributors.includes(jobTitle) &&
                                    !payoutReceivers.includes(jobTitle)
                                ).length === 0 ? (
                                  <div className="px-4 py-3 text-sm text-gray-500">No accounts available</div>
                                ) : [...jobTitles, ...prePayoutCustomAccounts]
                                    .filter(
                                      (jobTitle) =>
                                        !payoutContributors.includes(jobTitle) &&
                                        !payoutReceivers.includes(jobTitle) &&
                                        !prePayoutEntries.some(
                                          (entry, entryIndex) =>
                                            entryIndex !== index && entry.account === jobTitle
                                        )
                                    )
                                    .filter((jobTitle) =>
                                      jobTitle.toLowerCase().includes(
                                        (prePayoutAccountSearches[index] ?? '')
                                          .trim()
                                          .toLowerCase()
                                      )
                                    ).length === 0 ? (
                                  <div className="px-4 py-3 text-sm text-gray-500">No matches found</div>
                                ) : (
                                  [...jobTitles, ...prePayoutCustomAccounts]
                                    .filter(
                                      (jobTitle) =>
                                        !payoutContributors.includes(jobTitle) &&
                                        !payoutReceivers.includes(jobTitle) &&
                                        !prePayoutEntries.some(
                                          (entry, entryIndex) =>
                                            entryIndex !== index && entry.account === jobTitle
                                        )
                                    )
                                    .filter((jobTitle) =>
                                      jobTitle.toLowerCase().includes(
                                        (prePayoutAccountSearches[index] ?? '')
                                          .trim()
                                          .toLowerCase()
                                      )
                                    )
                                    .map((jobTitle) => (
                                      <button
                                        key={`pre-payout-account-${index}-${jobTitle}`}
                                        type="button"
                                        onClick={() => {
                                          setPrePayoutEntries((prev) =>
                                            prev.map((item, itemIndex) =>
                                              itemIndex === index
                                                ? { ...item, account: jobTitle }
                                                : item
                                            )
                                          );
                                          setOpenPrePayoutAccountIndex(null);
                                        }}
                                        className="w-full px-4 py-2 text-left text-sm text-gray-900 hover:bg-gray-50"
                                      >
                                        {jobTitle}
                                      </button>
                                    ))
                                )}
                                {creatingPrePayoutIndex === index ? (
                                  <div className="px-4 py-3 border-t border-gray-200 space-y-2">
                                    <input
                                      type="text"
                                      value={newPrePayoutAccountName}
                                      onChange={(e) => setNewPrePayoutAccountName(e.target.value)}
                                      placeholder="Account name"
                                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 outline-none"
                                    />
                                    <div className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const trimmed = newPrePayoutAccountName.trim();
                                          if (!trimmed) {
                                            return;
                                          }
                                          setPrePayoutCustomAccounts((prev) => {
                                            const merged = mergeUniqueAccounts(prev, [trimmed]);
                                            persistPrePayoutAccounts(merged);
                                            return merged;
                                          });
                                          setPrePayoutEntries((prev) =>
                                            prev.map((item, itemIndex) =>
                                              itemIndex === index
                                                ? { ...item, account: trimmed }
                                                : item
                                            )
                                          );
                                          setOpenPrePayoutAccountIndex(null);
                                          setCreatingPrePayoutIndex(null);
                                          setNewPrePayoutAccountName('');
                                        }}
                                        className="bg-[#cab99a] text-black px-3 py-2 rounded-lg font-semibold hover:bg-[#bfa986] transition-all shadow-lg text-sm"
                                      >
                                        Save
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setCreatingPrePayoutIndex(null);
                                          setNewPrePayoutAccountName('');
                                        }}
                                        className="border border-gray-300 text-gray-900 px-3 py-2 rounded-lg font-semibold hover:bg-gray-100 transition-all text-sm"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                ) : (prePayoutAccountSearches[index] ?? '').trim() ? (
                                  ![...jobTitles, ...prePayoutCustomAccounts].some(
                                    (jobTitle) =>
                                      jobTitle.toLowerCase() ===
                                      (prePayoutAccountSearches[index] ?? '').trim().toLowerCase()
                                  ) ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setCreatingPrePayoutIndex(index);
                                        setNewPrePayoutAccountName(
                                          (prePayoutAccountSearches[index] ?? '').trim()
                                        );
                                      }}
                                      className="w-full px-4 py-2 text-left text-sm text-gray-900 hover:bg-gray-50"
                                    >
                                      Create New Account
                                    </button>
                                  ) : null
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Submit Button */}
                <div className="flex items-center justify-between">
                  {submitError ? (
                    <p className="text-sm text-red-600">{submitError}</p>
                  ) : submitSuccess ? (
                    <p className="text-sm text-green-700">{submitSuccess}</p>
                  ) : (
                    <span />
                  )}
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        resetFormFields();
                        setSubmitError('');
                        setSubmitSuccess('');
                        setActiveView('existing');
                      }}
                      className="border border-gray-300 text-gray-900 px-6 py-3 rounded-lg font-semibold hover:bg-gray-100 transition-all shadow-lg"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleCreateForm}
                      disabled={isSubmitting}
                      className="bg-[#cab99a] text-black px-8 py-3 rounded-lg font-semibold hover:bg-[#bfa986] transition-all shadow-lg disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {isSubmitting
                        ? editingScheduleId
                          ? 'Updating...'
                          : 'Saving...'
                        : editingScheduleId
                          ? 'Update Schedule'
                          : 'Save Schedule'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
      )}
    </div>
  );
};

export default GratlyFormsSystem;
