import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Employee } from "../api/employees";
import { fetchEmployees } from "../api/employees";
import { api } from "../api/client";

const formatValue = (value: string | null | undefined) => {
  if (!value) {
    return "N/A";
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "N/A";
};

const formatPhoneNumber = (value: string | null | undefined) => {
  if (!value) {
    return "N/A";
  }
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 10) {
    return formatValue(value);
  }
  return `(${digits.slice(0, 3)})${digits.slice(3, 6)}-${digits.slice(6)}`;
};

export default function Employees() {
  const { restaurantKey } = useParams();
  const [userId, setUserId] = useState<number | null>(null);
  const [restaurantId, setRestaurantId] = useState<number | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAllEmployees, setShowAllEmployees] = useState(false);
  const [pendingInvites, setPendingInvites] = useState<Record<string, boolean>>({});
  const [inviteSending, setInviteSending] = useState<Record<string, boolean>>({});
  const [inviteErrors, setInviteErrors] = useState<Record<string, string>>({});
  const isInactive = (status: string) => status.trim().toLowerCase() === "inactive";
  const activeEmployees = employees.filter((employee) => !isInactive(employee.is_active));
  const visibleEmployees = showAllEmployees ? employees : activeEmployees;

  useEffect(() => {
    const storedUserId = localStorage.getItem("userId");
    if (storedUserId) {
      const parsedId = Number(storedUserId);
      if (Number.isFinite(parsedId)) {
        setUserId(parsedId);
      }
    }
  }, []);

  useEffect(() => {
    const storedRestaurantId = restaurantKey || localStorage.getItem("restaurantKey");
    if (storedRestaurantId) {
      const parsedId = Number(storedRestaurantId);
      if (Number.isFinite(parsedId)) {
        setRestaurantId(parsedId);
        return;
      }
    }
    setRestaurantId(null);
  }, [restaurantKey]);

  useEffect(() => {
    let isMounted = true;
    if (restaurantId === null && userId === null) {
      return () => {
        isMounted = false;
      };
    }
    setIsLoading(true);
    const options =
      restaurantId !== null
        ? { restaurantId }
        : userId !== null
          ? { userId }
          : undefined;
    fetchEmployees(options)
      .then((data) => {
        if (isMounted) {
          setEmployees(data);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });
    return () => {
      isMounted = false;
    };
  }, [restaurantId, userId]);

  const getEmployeeKey = (employee: Employee, index: number) =>
    employee.employeeGuid ?? employee.email ?? `employee-${index}`;

  const sendInvite = async (employee: Employee, key: string) => {
    if (!employee.email) {
      return;
    }
    if (userId === null) {
      setInviteErrors((current) => ({ ...current, [key]: "Please log in again to send invites." }));
      return;
    }
    setInviteSending((current) => ({ ...current, [key]: true }));
    setInviteErrors((current) => ({ ...current, [key]: "" }));
    try {
      await api.post("/team/invite", {
        user_id: userId,
        email: employee.email,
        first_name: employee.firstName,
        last_name: employee.lastName,
        employee_guid: employee.employeeGuid,
      });
      setPendingInvites((current) => ({ ...current, [key]: true }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to send invite";
      setInviteErrors((current) => ({ ...current, [key]: message }));
    } finally {
      setInviteSending((current) => ({ ...current, [key]: false }));
    }
  };

  return (
    <main className="px-6 py-6">
      <div className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Team</h1>
            <p className="text-sm text-gray-500">Roster and contact details for your employees.</p>
          </div>
          <label className="ml-auto flex items-center gap-2 text-sm font-medium text-gray-700">
            <input
              type="checkbox"
              checked={showAllEmployees}
              onChange={(event) => setShowAllEmployees(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
            />
            Show all employees
          </label>
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-6 py-3 font-semibold">First name</th>
                <th className="px-6 py-3 font-semibold">Last name</th>
                <th className="px-6 py-3 font-semibold">Phone</th>
                <th className="px-6 py-3 font-semibold">Email</th>
                <th className="px-6 py-3 font-semibold">POS Status</th>
                <th className="px-6 py-3 font-semibold">Gratly Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr>
                  <td className="px-6 py-4 text-gray-500" colSpan={6}>
                    Loading team members...
                  </td>
                </tr>
              ) : visibleEmployees.length === 0 ? (
                <tr>
                  <td className="px-6 py-4 text-gray-500" colSpan={6}>
                    {showAllEmployees ? "No employees found." : "No active employees found."}
                  </td>
                </tr>
              ) : (
                visibleEmployees.map((employee, index) => {
                  const employeeKey = getEmployeeKey(employee, index);
                  const inactive = isInactive(employee.is_active);
                  const statusClass = inactive
                    ? "bg-rose-100 text-rose-700"
                    : "bg-emerald-100 text-emerald-700";
                  const hasGratlyAccount = Boolean(employee.userId);
                  const isAwaiting = Boolean(pendingInvites[employeeKey]);
                  const gratlyStatus = hasGratlyAccount ? "Active" : isAwaiting ? "Awaiting" : "Inactive";
                  const gratlyStatusClass = hasGratlyAccount
                    ? "bg-emerald-100 text-emerald-700"
                    : isAwaiting
                      ? "bg-amber-100 text-amber-700"
                      : "bg-rose-100 text-rose-700";
                  const canInvite = Boolean(employee.email);
                  const isSendingInvite = Boolean(inviteSending[employeeKey]);
                  const inviteError = inviteErrors[employeeKey];
                  return (
                    <tr key={`${employeeKey}-${index}`} className="text-gray-700">
                      <td className="px-6 py-4">
                        {employee.employeeGuid ? (
                          <Link className="font-medium text-gray-900 hover:underline" to={`${employee.employeeGuid}`}>
                            {formatValue(employee.firstName)}
                          </Link>
                        ) : (
                          formatValue(employee.firstName)
                        )}
                      </td>
                      <td className="px-6 py-4">{formatValue(employee.lastName)}</td>
                      <td className="px-6 py-4">{formatPhoneNumber(employee.phoneNumber)}</td>
                      <td className="px-6 py-4">{formatValue(employee.email)}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass}`}>
                          {employee.is_active}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${gratlyStatusClass}`}>
                            {gratlyStatus}
                          </span>
                          {!hasGratlyAccount && !isAwaiting ? (
                            <button
                              type="button"
                              className="rounded-full border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-700 transition hover:border-gray-400 hover:text-gray-900 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
                              onClick={() => sendInvite(employee, employeeKey)}
                              disabled={!canInvite || isSendingInvite}
                            >
                              {isSendingInvite ? "Sending..." : "Send Invite"}
                            </button>
                          ) : null}
                        </div>
                        {inviteError ? (
                          <p className="mt-2 text-xs font-medium text-rose-600">{inviteError}</p>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
