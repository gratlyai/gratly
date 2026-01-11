import { api } from "./client";

export type RecentTransfer = {
  transferId: string;
  transferType: string;
  employeeGuid?: string | null;
  employeeName?: string | null;
  amount: number;
  createdAt?: string | null;
};

export type RecentTransfersResponse = {
  transfers: RecentTransfer[];
};

export async function fetchRecentTransfers(
  userId: number,
  limit = 5,
): Promise<RecentTransfersResponse> {
  const params = new URLSearchParams({
    user_id: String(userId),
    limit: String(limit),
  });
  return api.get<RecentTransfersResponse>(`/api/payments/recent?${params.toString()}`);
}
