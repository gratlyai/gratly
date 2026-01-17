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
  netPayout?: number;
  orderCount?: number;
  prepayoutDeduction?: number;
  payoutFee?: number;
  contributionPool?: number;
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
  payoutTriggerTips?: number;
  payoutTriggerGratuity?: number;
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
  prepayoutDeduction?: number;
  payoutFee?: number;
};

export type ApprovalOverridePayload = {
  restaurantId: number;
  payoutScheduleId: number;
  businessDate: string;
  userId: number;
  items: ApprovalOverrideItemPayload[];
};

export type ApprovalFinalizePayload = {
  restaurantId: number;
  payoutScheduleId: number;
  businessDate: string;
  userId: number;
};

export type ApprovalFinalizeResponse = {
  success: boolean;
  approval_id?: number;
  is_approved?: boolean;
  already_approved?: boolean;
};

export type ApprovalSnapshotItem = {
  employeeGuid: string | null;
  employeeName: string | null;
  jobTitle: string | null;
  fieldName: string;
  currentValue: string | null;
};

export type ApprovalSnapshotPayload = {
  restaurantId: number;
  payoutScheduleId: number;
  businessDate: string;
  userId: number;
  items: ApprovalSnapshotItem[];
};

export type ApprovalSnapshotResponse = {
  success: boolean;
  snapshot_count?: number;
};

export async function fetchApprovals(restaurantId: number): Promise<ApprovalsResponse> {
  try {
    return await api.get<ApprovalsResponse>(`/approvals?restaurant_id=${restaurantId}`);
  } catch (error) {
    console.warn("Failed to load approvals:", error);
    return { schedules: [] };
  }
}

export async function saveApprovalOverrides(payload: ApprovalOverridePayload): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await api.post<{ success: boolean; approval_id: number }>("/approvals/overrides", payload);
    console.log("Saved approval overrides:", result);
    return { success: true };
  } catch (error) {
    console.error("Failed to save approval overrides:", error);
    return { success: false, error: String(error) };
  }
}

export async function approvePayoutSchedule(
  payload: ApprovalFinalizePayload,
): Promise<ApprovalFinalizeResponse | null> {
  try {
    return await api.post<ApprovalFinalizeResponse>("/approvals/approve", payload);
  } catch (error) {
    console.warn("Failed to approve payout schedule:", error);
    return null;
  }
}

export async function saveApprovalSnapshot(
  payload: ApprovalSnapshotPayload,
): Promise<ApprovalSnapshotResponse | null> {
  try {
    return await api.post<ApprovalSnapshotResponse>("/approvals/snapshot", payload);
  } catch (error) {
    console.warn("Failed to save approval snapshot:", error);
    return null;
  }
}
