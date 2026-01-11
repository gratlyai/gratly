import { api } from "./client";

export type WeeklyTipsGratuitiesDay = {
  date: string;
  tips: number;
  gratuity: number;
};

export type WeeklyTipsGratuitiesResponse = {
  days: WeeklyTipsGratuitiesDay[];
};

export type PendingPayoutsResponse = {
  pendingPayouts: number;
};

export async function fetchWeeklyTipsGratuities(
  userId: number,
  restaurantId: number,
): Promise<WeeklyTipsGratuitiesResponse> {
  try {
    const params = new URLSearchParams({
      user_id: String(userId),
      restaurant_id: String(restaurantId),
    });
    return await api.get<WeeklyTipsGratuitiesResponse>(
      `/reports/weekly-tips-gratuities?${params.toString()}`,
    );
  } catch (error) {
    console.warn("Failed to load weekly tips/gratuities:", error);
    return { days: [] };
  }
}

export async function fetchPendingPayouts(
  userId: number,
  restaurantId: number,
): Promise<PendingPayoutsResponse> {
  try {
    const params = new URLSearchParams({
      user_id: String(userId),
      restaurant_id: String(restaurantId),
    });
    return await api.get<PendingPayoutsResponse>(`/reports/pending-payouts?${params.toString()}`);
  } catch (error) {
    console.warn("Failed to load pending payouts:", error);
    return { pendingPayouts: 0 };
  }
}
