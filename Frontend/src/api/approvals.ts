import { api } from "./client";

export type ApprovalContributor = {
  employeeGuid: string;
  employeeName: string;
  jobTitle: string | null;
  businessDate: string | null;
  inTime: string | null;
  outTime: string | null;
  hoursWorked: number;
  isContributor: string;
  payoutReceiverId: string | null;
  payoutPercentage: number;
  totalSales: number;
  netSales: number;
  totalTips: number;
  totalGratuity: number;
  overallTips: number;
  overallGratuity: number;
  payoutTips: number;
  payoutGratuity: number;
  orderCount?: number;
};

export type ApprovalScheduleWithContributors = {
  payoutScheduleId: number;
  name: string | null;
  payoutRuleId: string | null;
  payoutRuleLabel: string | null;
  businessDate: string | null;
  startDay: string | null;
  endDay: string | null;
  startTime: string | null;
  endTime: string | null;
  startDateTime: string | null;
  endDateTime: string | null;
  prepayoutFlag: boolean;
  totalSales: number;
  netSales: number;
  totalTips: number;
  totalGratuity: number;
  orderCount: number;
  contributorCount: number;
  receiverCount: number;
  isApproved?: boolean;
  receiverRoles: {
    receiverId: string | null;
    payoutPercentage: number;
    isContributor: boolean;
  }[];
  contributors: ApprovalContributor[];
};

export type ApprovalsResponse = {
  schedules: ApprovalScheduleWithContributors[];
};

export type ApprovalOverrideItemPayload = {
  employeeGuid: string | null;
  employeeName: string | null;
  jobTitle: string | null;
  isContributor: string | null;
  payoutReceiverId: string | null;
  payoutPercentage: number;
  totalSales: number;
  netSales: number;
  totalTips: number;
  totalGratuity: number;
  overallTips: number;
  overallGratuity: number;
  payoutTips: number;
  payoutGratuity: number;
  netPayout: number;
};

export type ApprovalOverridePayload = {
  restaurantId: number;
  payoutScheduleId: number;
  businessDate: string;
  items: ApprovalOverrideItemPayload[];
};

export type ApprovalFinalizePayload = {
  restaurantId: number;
  payoutScheduleId: number;
  businessDate: string;
  userId: number;
};

export async function fetchApprovals(restaurantId: number): Promise<ApprovalsResponse> {
  try {
    return await api.get<ApprovalsResponse>(`/approvals?restaurant_id=${restaurantId}`);
  } catch (error) {
    console.warn("Failed to load approvals:", error);
    return { schedules: [] };
  }
}

export async function saveApprovalOverrides(payload: ApprovalOverridePayload): Promise<void> {
  try {
    await api.post("/approvals/overrides", payload);
  } catch (error) {
    console.warn("Failed to save approval overrides:", error);
  }
}

export async function approvePayoutSchedule(payload: ApprovalFinalizePayload): Promise<void> {
  try {
    await api.post("/approvals/approve", payload);
  } catch (error) {
    console.warn("Failed to approve payout schedule:", error);
  }
}
