import { api } from "./client";

export type PayoutScheduleRow = {
  payout_schedule_id: number;
  name: string;
  start_day: string | null;
  end_day: string | null;
  start_time: string | null;
  end_time: string | null;
  payout_rule_id: string | null;
};

export type PayoutScheduleDetail = PayoutScheduleRow & {
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
};

export type PrePayoutPayload = {
  option: string;
  value: number | null;
  account: string;
};

export type CreatePayoutSchedulePayload = {
  user_id: number;
  restaurant_id?: number;
  name: string;
  start_day?: string | null;
  end_day?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  payout_triggers?: { gratuity?: number | null; tips?: number | null };
  payout_rule: string;
  payout_contributors?: string[];
  payout_receivers?: string[];
  payout_percentages?: Record<string, number | null>;
  custom_individual_payout?: number | null;
  custom_group_contribution?: number | null;
  pre_payouts?: PrePayoutPayload[];
};

export async function fetchJobTitles(
  userId: number,
  restaurantId: number,
): Promise<string[]> {
  try {
    const params = new URLSearchParams({
      user_id: String(userId),
      restaurant_id: String(restaurantId),
    });
    return await api.get<string[]>(`/job-titles?${params.toString()}`);
  } catch (error) {
    console.warn("Failed to load job titles:", error);
    return [];
  }
}

export async function fetchPayoutSchedules(
  userId: number,
  restaurantId: number,
): Promise<PayoutScheduleRow[]> {
  const params = new URLSearchParams({
    user_id: String(userId),
    restaurant_id: String(restaurantId),
  });
  return api.get<PayoutScheduleRow[]>(`/payout-schedules?${params.toString()}`);
}

export async function fetchPayoutScheduleDetail(
  scheduleId: number,
  userId: number,
  restaurantId: number,
): Promise<PayoutScheduleDetail> {
  const params = new URLSearchParams({
    user_id: String(userId),
    restaurant_id: String(restaurantId),
  });
  return api.get<PayoutScheduleDetail>(`/payout-schedules/${scheduleId}?${params.toString()}`);
}

export async function createPayoutSchedule(
  payload: CreatePayoutSchedulePayload,
): Promise<{ success: boolean; payout_schedule_id?: number }> {
  return api.post("/payout-schedules", payload);
}

export async function updatePayoutSchedule(
  scheduleId: number,
  payload: CreatePayoutSchedulePayload,
): Promise<{ success: boolean }> {
  return api.put(`/payout-schedules/${scheduleId}`, payload);
}

export async function deletePayoutSchedule(
  scheduleId: number,
  userId: number,
  restaurantId: number,
): Promise<void> {
  const params = new URLSearchParams({
    user_id: String(userId),
    restaurant_id: String(restaurantId),
  });
  await api.delete(`/payout-schedules/${scheduleId}?${params.toString()}`);
}
