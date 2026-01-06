import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Employee } from "../api/employees";
import { fetchEmployee } from "../api/employees";
import {
  fetchPermissionCatalog,
  fetchUserPermissions,
  updateUserPermissions,
} from "../api/permissions";
import {
  defaultEmployeePermissions,
  getStoredPermissions,
  permissionConfig,
  type PermissionDescriptor,
  type PermissionState,
} from "../auth/permissions";

const formatValue = (value: string | null | undefined) => {
  if (!value) {
    return "N/A";
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "N/A";
};
export default function EmployeeProfile() {
  const { employeeGuid } = useParams();
  const navigate = useNavigate();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [permissions, setPermissions] = useState<PermissionState>(defaultEmployeePermissions);
  const [permissionCatalog, setPermissionCatalog] =
    useState<PermissionDescriptor[]>(permissionConfig);
  const [isSavingPermissions, setIsSavingPermissions] = useState(false);
  const [currentUserPermissions] = useState<PermissionState>(() =>
    getStoredPermissions(localStorage.getItem("userId")),
  );

  const storageKey = useMemo(() => {
    const userId = employee?.userId;
    if (userId) {
      return `employeePermissions:${userId}`;
    }
    return employeeGuid ? `employeePermissions:${employeeGuid}` : "";
  }, [employee?.userId, employeeGuid]);

  useEffect(() => {
    if (!employeeGuid) {
      setIsLoading(false);
      return;
    }
    let isMounted = true;
    setIsLoading(true);
    fetchEmployee(employeeGuid)
      .then((data) => {
        if (isMounted) {
          setEmployee(data);
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
  }, [employeeGuid]);

  useEffect(() => {
    if (!storageKey) {
      return;
    }
    if (employee?.userId) {
      fetchUserPermissions(employee.userId)
        .then((data) => {
          setPermissions({ ...defaultEmployeePermissions, ...data });
          localStorage.setItem(storageKey, JSON.stringify(data));
        })
        .catch(() => {
          const saved = localStorage.getItem(storageKey);
          if (saved) {
            try {
              const parsed = JSON.parse(saved) as PermissionState;
              setPermissions({ ...defaultEmployeePermissions, ...parsed });
              return;
            } catch {
              setPermissions(defaultEmployeePermissions);
              return;
            }
          }
          setPermissions(defaultEmployeePermissions);
        });
      return;
    }
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as PermissionState;
        setPermissions({ ...defaultEmployeePermissions, ...parsed });
      } catch {
        setPermissions(defaultEmployeePermissions);
      }
    } else {
      setPermissions(defaultEmployeePermissions);
    }
  }, [employee?.userId, storageKey]);

  useEffect(() => {
    if (!storageKey) {
      return;
    }
    localStorage.setItem(storageKey, JSON.stringify(permissions));
  }, [permissions, storageKey]);

  useEffect(() => {
    let isMounted = true;
    fetchPermissionCatalog()
      .then((data) => {
        if (isMounted && data.length) {
          setPermissionCatalog(data);
        }
      })
      .catch(() => {
        // Keep static permissions on failure.
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const handlePermissionChange = async (permissionKey: keyof PermissionState, checked: boolean) => {
    const nextPermissions = { ...permissions, [permissionKey]: checked };
    const previousPermissions = permissions;
    setPermissions(nextPermissions);
    if (!employee?.userId) {
      return;
    }
    const actorUserId = Number(localStorage.getItem("userId"));
    setIsSavingPermissions(true);
    try {
      const updated = await updateUserPermissions(
        employee.userId,
        nextPermissions,
        Number.isFinite(actorUserId) ? actorUserId : undefined,
      );
      setPermissions({ ...defaultEmployeePermissions, ...updated });
      localStorage.setItem(storageKey, JSON.stringify(updated));
    } catch (error) {
      console.warn("Failed to update permissions:", error);
      setPermissions(previousPermissions);
    } finally {
      setIsSavingPermissions(false);
    }
  };

  const title = employee
    ? `${formatValue(employee.firstName)} ${formatValue(employee.lastName)}`
    : "Employee Profile";

  return (
    <main className="px-6 py-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="mb-2 text-sm font-semibold text-gray-500 hover:text-gray-800"
          >
            Back to team
          </button>
          <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
          <p className="text-sm text-gray-500">Manage employee details, permissions, and security.</p>
        </div>
        <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
          {employee?.is_active ?? "N/A"}
        </span>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">
          Loading employee profile...
        </div>
      ) : !employee ? (
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">
          Employee not found.
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">Employee info</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-400">First name</p>
                <p className="text-sm font-semibold text-gray-900">{formatValue(employee.firstName)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-400">Last name</p>
                <p className="text-sm font-semibold text-gray-900">{formatValue(employee.lastName)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-400">Phone</p>
                <p className="text-sm font-semibold text-gray-900">{formatValue(employee.phoneNumber)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-400">Email</p>
                <p className="text-sm font-semibold text-gray-900">{formatValue(employee.email)}</p>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">Security</h2>
            <div className="space-y-3 text-sm text-gray-700">
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-400">Account status</p>
                <p className="font-semibold text-gray-900">{employee.is_active}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-400">Employee GUID</p>
                <p className="break-all font-semibold text-gray-900">{formatValue(employee.employeeGuid)}</p>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm lg:col-span-2">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">Permissions</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {permissionCatalog.map((permission) => (
                <label
                  key={permission.key}
                  className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-medium text-gray-700"
                >
                  <span>{permission.label}</span>
                  <input
                    type="checkbox"
                    checked={permissions[permission.key]}
                    onChange={(event) => handlePermissionChange(permission.key, event.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
                    disabled={
                      !employee?.userId ||
                      isSavingPermissions ||
                      (permission.key === "adminAccess" && !currentUserPermissions.adminAccess)
                    }
                  />
                </label>
              ))}
            </div>
            {!employee?.userId ? (
              <p className="mt-3 text-xs font-medium text-gray-500">
                Permissions unlock after the employee signs up.
              </p>
            ) : null}
          </section>
        </div>
      )}

    </main>
  );
}
