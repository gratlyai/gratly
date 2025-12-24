import { api } from "./client";

export type Employee = {
  userId: number | null;
  employeeGuid: string | null;
  firstName: string | null;
  lastName: string | null;
  phoneNumber: string | null;
  email: string | null;
  is_active: string;
};

export async function fetchEmployees(): Promise<Employee[]> {
  try {
    return await api.get<Employee[]>("/employees");
  } catch (error) {
    console.warn("Failed to load employees:", error);
    return [];
  }
}

export async function fetchEmployee(employeeGuid: string): Promise<Employee | null> {
  try {
    return await api.get<Employee>(`/employees/${employeeGuid}`);
  } catch (error) {
    console.warn("Failed to load employee:", error);
    return null;
  }
}
