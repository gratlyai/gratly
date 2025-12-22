import { api } from "./client";

export type User = {
  employeeID: number;
  jobID: string;
  inDate: string;
  outDate: string;
  regularHours: string;
  nonCashSales: string;
  nonCashGratuityServiceCharges: string;
  nonCashTips: string;
};

export async function fetchUsers(): Promise<User[]> {
  try {
    return await api.get<User[]>("/users");
  } catch (error) {
    console.warn("Failed to load users:", error);
    return [];
  }
}
