import { api } from "./client";
import type { ApprovalsResponse } from "./approvals";

export async function fetchYesterdayReport(restaurantId: number): Promise<ApprovalsResponse> {
  try {
    return await api.get<ApprovalsResponse>(`/reports/yesterday?restaurant_id=${restaurantId}`);
  } catch (error) {
    console.warn("Failed to load yesterday report:", error);
    return { schedules: [] };
  }
}
