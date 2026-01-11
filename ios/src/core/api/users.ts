import { api } from "./client";

export type UserProfile = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phoneNumber?: string | null;
  restaurantName?: string | null;
};

export type UserProfileUpdate = {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
};

export async function fetchUserProfile(userId: number): Promise<UserProfile | null> {
  try {
    return await api.get<UserProfile>(`/user-profile/${userId}`);
  } catch (error) {
    console.warn("Failed to load user profile:", error);
    return null;
  }
}

export async function updateUserProfile(
  userId: number,
  payload: UserProfileUpdate,
): Promise<UserProfile> {
  return api.put<UserProfile>(`/user-profile/${userId}`, payload);
}
