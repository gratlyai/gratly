import { api } from "./client";

export type PaymentRoutingStatus = {
  restaurantId: number;
  provider: "stripe" | "astra";
  locked: boolean;
  updatedByUserId?: number | null;
  updatedAt?: string | null;
};

export type PaymentRoutingPayload = {
  userId: number;
  restaurantId: number;
  provider: "stripe" | "astra";
};

export async function fetchPaymentRouting(
  restaurantId: number,
  userId: number,
): Promise<PaymentRoutingStatus> {
  return api.get<PaymentRoutingStatus>(
    `/admin/payment-routing?restaurant_id=${restaurantId}&user_id=${userId}`,
  );
}

export async function savePaymentRouting(
  payload: PaymentRoutingPayload,
): Promise<PaymentRoutingStatus> {
  return api.post<PaymentRoutingStatus>("/admin/payment-routing", payload);
}

