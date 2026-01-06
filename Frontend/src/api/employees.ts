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

export type EmployeeWithJob = {
  employeeGuid: string | null;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
};

export async function fetchEmployees(options?: {
  restaurantId?: number | null;
  userId?: number | null;
}): Promise<Employee[]> {
  try {
    const params = new URLSearchParams();
    if (options?.restaurantId && Number.isFinite(options.restaurantId)) {
      params.set("restaurant_id", String(options.restaurantId));
    }
    if (options?.userId && Number.isFinite(options.userId)) {
      params.set("user_id", String(options.userId));
    }
    const query = params.toString();
    const url = query ? `/employees?${query}` : "/employees";
    return await api.get<Employee[]>(url);
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

export async function fetchActiveEmployeesByJobTitle(
  restaurantId: number,
): Promise<EmployeeWithJob[]> {
  try {
    return await api.get<EmployeeWithJob[]>(`/employees/active-by-job?restaurant_id=${restaurantId}`);
  } catch (error) {
    console.warn("Failed to load active employees by job:", error);
    return [];
  }
}
