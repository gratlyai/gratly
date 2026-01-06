import { api } from "./client";

export type RestaurantSelectionOption = {
  restaurantId?: number | null;
  restaurantGuid?: string | null;
  restaurantName?: string | null;
};

export async function fetchRestaurantSelectionOptions(
  userId: number,
): Promise<RestaurantSelectionOption[]> {
  return api.get<RestaurantSelectionOption[]>(`/restaurant-selection?user_id=${userId}`);
}

export async function assignRestaurantSelection(
  userId: number,
  restaurantId?: number | null,
  restaurantGuid?: string | null,
): Promise<RestaurantSelectionOption> {
  const payload: {
    userId: number;
    restaurantId?: number;
    restaurantGuid?: string;
  } = { userId };
  if (restaurantId !== null && restaurantId !== undefined) {
    payload.restaurantId = restaurantId;
  }
  if (restaurantGuid) {
    payload.restaurantGuid = restaurantGuid;
  }
  return api.post<RestaurantSelectionOption>("/restaurant-selection", {
    ...payload,
  });
}
