import { api } from "./client";
import type { ApprovalsResponse } from "./approvals";

export async function fetchYesterdayReport(
  restaurantId: number | null,
  userId?: number | null,
): Promise<ApprovalsResponse> {
  try {
    if (userId && Number.isFinite(userId)) {
      return await api.get<ApprovalsResponse>(`/reports/yesterday?user_id=${userId}`);
    }
    if (restaurantId !== null) {
      return await api.get<ApprovalsResponse>(`/reports/yesterday?restaurant_id=${restaurantId}`);
    }
    return { schedules: [] };
  } catch (error) {
    console.warn("Failed to load yesterday report:", error);
    return { schedules: [] };
  }
}

export type WeeklyTipsGratuitiesDay = {
  date: string;
  tips: number;
  gratuity: number;
};

export type WeeklyTipsGratuitiesResponse = {
  days: WeeklyTipsGratuitiesDay[];
};

export async function fetchWeeklyTipsGratuities(
  userId: number,
): Promise<WeeklyTipsGratuitiesResponse> {
  try {
    return await api.get<WeeklyTipsGratuitiesResponse>(
      `/reports/weekly-tips-gratuities?user_id=${userId}`,
    );
  } catch (error) {
    console.warn("Failed to load weekly tips/gratuities:", error);
    return { days: [] };
  }
}

export type PendingPayoutsResponse = {
  pendingPayouts: number;
};

export async function fetchPendingPayouts(userId: number): Promise<PendingPayoutsResponse> {
  try {
    return await api.get<PendingPayoutsResponse>(`/reports/pending-payouts?user_id=${userId}`);
  } catch (error) {
    console.warn("Failed to load pending payouts:", error);
    return { pendingPayouts: 0 };
  }
}

export type PayrollEmployeeTotal = {
  employeeGuid: string | null;
  employeeName: string;
  totalPayout: number;
};

export type PayrollReportResponse = {
  employees: PayrollEmployeeTotal[];
};

export async function fetchPayrollReport(
  userId: number,
  startDate: string,
  endDate: string,
): Promise<PayrollReportResponse> {
  try {
    const params = new URLSearchParams({
      user_id: String(userId),
      start_date: startDate,
      end_date: endDate,
    });
    return await api.get<PayrollReportResponse>(`/reports/payroll?${params.toString()}`);
  } catch (error) {
    console.warn("Failed to load payroll report:", error);
    return { employees: [] };
  }
}

export type PeriodReportResponse = {
  employees: PayrollEmployeeTotal[];
  startDate?: string | null;
  endDate?: string | null;
};

export async function fetchThisWeekReport(userId: number): Promise<PeriodReportResponse> {
  try {
    return await api.get<PeriodReportResponse>(`/reports/this-week?user_id=${userId}`);
  } catch (error) {
    console.warn("Failed to load weekly report:", error);
    return { employees: [] };
  }
}

export async function fetchThisMonthReport(userId: number): Promise<PeriodReportResponse> {
  try {
    return await api.get<PeriodReportResponse>(`/reports/this-month?user_id=${userId}`);
  } catch (error) {
    console.warn("Failed to load monthly report:", error);
    return { employees: [] };
  }
}
