import { api } from "./client";

export async function fetchJobTitles(userId: number): Promise<string[]> {
  try {
    const data = await api.get<string[]>(`/job-titles?user_id=${userId}`);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.warn("Failed to load job titles:", error);
    return [];
  }
}
