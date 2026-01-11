import { useMemo } from "react";
import { useAuth } from "../providers/useAuth";

export type SessionScope = {
  userId: number;
  restaurantId: number;
};

export const useSessionScope = (): SessionScope | null => {
  const { session } = useAuth();

  return useMemo(() => {
    const userId = Number(session?.userId);
    const restaurantId = Number(session?.restaurantKey);
    if (!Number.isFinite(userId) || !Number.isFinite(restaurantId)) {
      return null;
    }
    return { userId, restaurantId };
  }, [session?.userId, session?.restaurantKey]);
};
