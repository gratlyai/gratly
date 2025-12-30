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

export type StripeConnectedAccount = {
  accountId: string;
  created: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  disabledReason?: string | null;
  accountDeauthorized?: boolean;
  businessType?: string | null;
  capabilities?: Record<string, string> | null;
  defaultCurrency?: string | null;
  card?: StripeCardSummary | null;
};

export type StripeConnectedAccountSummary = {
  accountId: string | null;
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
  detailsSubmitted?: boolean;
  disabledReason?: string | null;
  accountDeauthorized?: boolean;
  businessType?: string | null;
  capabilities?: Record<string, string> | null;
  defaultCurrency?: string | null;
  card?: StripeCardSummary | null;
};

export type StripeCardSummary = {
  brand?: string | null;
  last4?: string | null;
  expMonth?: number | null;
  expYear?: number | null;
  funding?: string | null;
  country?: string | null;
};

export type StripeOnboardingLink = {
  url: string;
  expiresAt: number | null;
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

export async function createOrFetchStripeConnectedAccount(
  employeeGuid: string,
): Promise<StripeConnectedAccount | null> {
  try {
    return await api.post<StripeConnectedAccount>(
      `/employees/${employeeGuid}/stripe-connected-account`,
    );
  } catch (error) {
    console.warn("Failed to create or fetch Stripe connected account:", error);
    return null;
  }
}

export async function fetchStripeConnectedAccount(
  employeeGuid: string,
): Promise<StripeConnectedAccountSummary | null> {
  try {
    return await api.get<StripeConnectedAccountSummary>(
      `/employees/${employeeGuid}/stripe-connected-account`,
    );
  } catch (error) {
    console.warn("Failed to fetch Stripe connected account:", error);
    return null;
  }
}

export async function createStripeOnboardingLink(
  employeeGuid: string,
): Promise<StripeOnboardingLink | null> {
  try {
    return await api.post<StripeOnboardingLink>(
      `/employees/${employeeGuid}/stripe-onboarding-link`,
    );
  } catch (error) {
    console.warn("Failed to create Stripe onboarding link:", error);
    return null;
  }
}
