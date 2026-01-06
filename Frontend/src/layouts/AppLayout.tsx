import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import homeLogo from "../assets/homelogo.png";
import approvalsLogo from "../assets/approvalslogo.png";
import shiftPayoutLogo from "../assets/shiftpayoutlogo.png";
import reportsLogo from "../assets/reportslogo.png";
import teamLogo from "../assets/teamlogo.png";
import settingsLogo from "../assets/settingslogo.png";
import gratlyLogo from "../assets/gratlylogodash.png";
import { getStoredPermissions, type PermissionState } from "../auth/permissions";
import { fetchUserPermissions } from "../api/permissions";
import {
  assignRestaurantSelection,
  fetchRestaurantSelectionOptions,
  type RestaurantSelectionOption,
} from "../api/restaurantSelection";
import { fetchRestaurantDetails } from "../api/superadmin";
import { fetchEmployeeConnection } from "../api/astra";

type NavItem = {
  label: string;
  to: string;
  permissionKey?: "home" | "approvals" | "shift-payout" | "team" | "reports" | "billing" | "settings" | "profile";
  icon: React.ReactNode;
};

const AppLayout: React.FC = () => {
  const [logoData, setLogoData] = useState<string>("");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [isSidebarHovered, setIsSidebarHovered] = useState<boolean>(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState<boolean>(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const { restaurantKey, employeeId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const loadLogo = async (): Promise<void> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fs = (window as any).fs;
        if (!fs?.readFile) {
          return;
        }
        const data = await fs.readFile("image.png");
        const blob = new Blob([data], { type: "image/png" });
        const url = URL.createObjectURL(blob);
        setLogoData(url);
      } catch (error) {
        console.error("Error loading logo:", error);
      }
    };
    loadLogo();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const storedUserName = localStorage.getItem("userName") || "User";
  const storedUserId = localStorage.getItem("userId") || "";
  const restaurantName = localStorage.getItem("restaurantName") || "";
  const storedRestaurantKey = localStorage.getItem("restaurantKey") || "";
  const userInitials =
    storedUserName
      .split(" ")
      .filter(Boolean)
      .map((part) => part[0]?.toUpperCase())
      .slice(0, 2)
      .join("") || "U";
  const activeEmployeeId = employeeId || storedUserId;
  const [permissions, setPermissions] = useState<PermissionState>(() =>
    getStoredPermissions(activeEmployeeId),
  );
  const [permissionsLoaded, setPermissionsLoaded] = useState<boolean>(false);
  const isAdminUser = permissions.adminAccess || permissions.superadminAccess;
  const isSuperAdmin = permissions.superadminAccess;
  const isBusinessUser =
    isAdminUser ||
    permissions.managerAccess ||
    permissions.createPayoutSchedules ||
    permissions.approvePayouts ||
    permissions.manageTeam;
  const businessBase = restaurantKey ? `/business/${restaurantKey}` : "/business";
  const employeeBase = activeEmployeeId ? `/employees/${activeEmployeeId}` : "/employees";
  const basePath = restaurantKey ? businessBase : employeeBase;
  const isCompactSidebar = isSidebarCollapsed && !isSidebarHovered;
  const outletKey = restaurantKey ?? employeeId ?? "default";
  const [restaurantOptions, setRestaurantOptions] = useState<RestaurantSelectionOption[]>([]);
  const [selectedRestaurantValue, setSelectedRestaurantValue] = useState<string>("");
  const [isRestaurantOptionsLoading, setIsRestaurantOptionsLoading] = useState<boolean>(false);
  const [isRestaurantSaving, setIsRestaurantSaving] = useState<boolean>(false);
  const [restaurantSelectionError, setRestaurantSelectionError] = useState<string | null>(null);
  const showRestaurantSelector = isSuperAdmin || (permissions.adminAccess && !restaurantKey);
  const [showAstraPrompt, setShowAstraPrompt] = useState<boolean>(false);
  const [astraPromptLoading, setAstraPromptLoading] = useState<boolean>(false);
  const [astraPromptMessage, setAstraPromptMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const nextPermissions = getStoredPermissions(activeEmployeeId);
    if (isMounted) {
      setPermissions(nextPermissions);
    }
    const numericUserId = Number(activeEmployeeId);
    if (!Number.isFinite(numericUserId) || numericUserId <= 0) {
      setPermissionsLoaded(true);
      return () => {
        isMounted = false;
      };
    }
    fetchUserPermissions(numericUserId)
      .then((data) => {
        if (!isMounted) {
          return;
        }
        setPermissions({ ...nextPermissions, ...data });
        localStorage.setItem(`employeePermissions:${numericUserId}`, JSON.stringify(data));
        setPermissionsLoaded(true);
      })
      .catch(() => {
        // Keep local storage permissions if the API is unavailable.
        setPermissionsLoaded(true);
      });
    return () => {
      isMounted = false;
    };
  }, [activeEmployeeId, storedUserName]);

  useEffect(() => {
    if (!showRestaurantSelector) {
      return;
    }
    const numericUserId = Number(storedUserId);
    if (!Number.isFinite(numericUserId) || numericUserId <= 0) {
      return;
    }
    setIsRestaurantOptionsLoading(true);
    setRestaurantSelectionError(null);
    const loadOptions = isSuperAdmin
      ? fetchRestaurantDetails(numericUserId).then((data) =>
          data.map((restaurant) => ({
            restaurantId: restaurant.restaurantId ?? null,
            restaurantGuid: restaurant.restaurantGuid ?? null,
            restaurantName: restaurant.restaurantName ?? null,
          })),
        )
      : fetchRestaurantSelectionOptions(numericUserId);
    loadOptions
      .then((data) => {
        setRestaurantOptions(data);
      })
      .catch((error) => {
        setRestaurantSelectionError(
          error instanceof Error ? error.message : "Failed to load restaurants.",
        );
        setRestaurantOptions([]);
      })
      .finally(() => {
        setIsRestaurantOptionsLoading(false);
      });
  }, [showRestaurantSelector, storedUserId, isSuperAdmin]);

  useEffect(() => {
    if (!restaurantOptions.length) {
      return;
    }
    if (selectedRestaurantValue) {
      return;
    }
    const initialId = restaurantKey || storedRestaurantKey;
    if (!initialId) {
      return;
    }
    const matched = restaurantOptions.find(
      (option) =>
        option.restaurantId && String(option.restaurantId) === String(initialId),
    );
    if (matched?.restaurantGuid) {
      setSelectedRestaurantValue(`guid:${matched.restaurantGuid}`);
    } else if (matched?.restaurantId) {
      setSelectedRestaurantValue(String(matched.restaurantId));
    }
  }, [restaurantOptions, restaurantKey, selectedRestaurantValue, storedRestaurantKey]);

  useEffect(() => {
    if (!permissionsLoaded) {
      return;
    }
    if (isSuperAdmin) {
      setShowAstraPrompt(false);
      return;
    }
    if (isBusinessUser) {
      setShowAstraPrompt(false);
      return;
    }
    if (!permissions.employeeOnly) {
      setShowAstraPrompt(false);
      return;
    }
    const numericUserId = Number(activeEmployeeId);
    if (!Number.isFinite(numericUserId) || numericUserId <= 0) {
      return;
    }
    setAstraPromptLoading(true);
    setAstraPromptMessage(null);
    fetchEmployeeConnection(numericUserId)
      .then((connection) => {
        const isConnected = Boolean(connection?.connected);
        const needsPrompt = !isConnected;
        setShowAstraPrompt(needsPrompt);
        if (needsPrompt) {
          setAstraPromptMessage(
            "You’re almost ready—complete Astra setup and add a debit card to receive instant payouts.",
          );
        }
      })
      .catch(() => {
        // If Astra is unavailable, avoid blocking login with a modal.
        setShowAstraPrompt(false);
      })
      .finally(() => {
        setAstraPromptLoading(false);
      });
  }, [activeEmployeeId, permissions, permissionsLoaded]);

  const canAccess = (key?: NavItem["permissionKey"]) => {
    if (!key) {
      return true;
    }
    if (key === "home" || key === "reports") {
      return true;
    }
    if (key === "profile") {
      return true;
    }
    if (key === "settings") {
      return isSuperAdmin;
    }
    if (isAdminUser) {
      return true;
    }
    if (key === "approvals") {
      return permissions.managerAccess || permissions.approvePayouts;
    }
    if (key === "shift-payout") {
      return permissions.managerAccess || permissions.createPayoutSchedules;
    }
    if (key === "team") {
      return permissions.managerAccess || permissions.manageTeam;
    }
    if (key === "billing") {
      return isAdminUser;
    }
    return false;
  };

  const handleRestaurantSelection = async (
    event: React.ChangeEvent<HTMLSelectElement>,
  ): Promise<void> => {
    const nextValue = event.target.value;
    setSelectedRestaurantValue(nextValue);
    setRestaurantSelectionError(null);
    if (!nextValue) {
      return;
    }
    const numericUserId = Number(storedUserId);
    if (!Number.isFinite(numericUserId) || numericUserId <= 0) {
      setRestaurantSelectionError("Missing user context.");
      return;
    }
    const selectedOption = restaurantOptions.find((option) => {
      if (option.restaurantId) {
        return String(option.restaurantId) === nextValue;
      }
      return option.restaurantGuid ? `guid:${option.restaurantGuid}` === nextValue : false;
    });
    if (!selectedOption) {
      setRestaurantSelectionError("Selected restaurant is unavailable.");
      return;
    }
    const currentRestaurantId = restaurantKey || storedRestaurantKey;
    if (
      currentRestaurantId &&
      selectedOption.restaurantId &&
      String(currentRestaurantId) === String(selectedOption.restaurantId)
    ) {
      return;
    }
    setIsRestaurantSaving(true);
    try {
      const result = await assignRestaurantSelection(
        numericUserId,
        selectedOption.restaurantId ?? null,
        selectedOption.restaurantGuid ?? null,
      );
      const resolvedName =
        result.restaurantName ||
        restaurantOptions.find(
          (option) => option.restaurantId === result.restaurantId,
        )?.restaurantName ||
        "";
      if (!result.restaurantId) {
        throw new Error("Restaurant selection did not return an ID.");
      }
      localStorage.setItem("restaurantKey", String(result.restaurantId));
      if (resolvedName) {
        localStorage.setItem("restaurantName", resolvedName);
      } else {
        localStorage.removeItem("restaurantName");
      }
      setRestaurantOptions((prev) =>
        prev.map((option) => {
          if (option.restaurantGuid && option.restaurantGuid === result.restaurantGuid) {
            return { ...option, restaurantId: result.restaurantId };
          }
          return option;
        }),
      );
      setSelectedRestaurantValue(String(result.restaurantId));
      try {
        const updatedPermissions = await fetchUserPermissions(numericUserId);
        setPermissions((prev) => ({ ...prev, ...updatedPermissions }));
        localStorage.setItem(
          `employeePermissions:${numericUserId}`,
          JSON.stringify(updatedPermissions),
        );
      } catch (error) {
        console.warn("Failed to refresh permissions:", error);
      }
      const nextBase = `/business/${result.restaurantId}`;
      const currentBase = restaurantKey ? `/business/${restaurantKey}` : "";
      const nextPath =
        restaurantKey && location.pathname.startsWith(currentBase)
          ? location.pathname.replace(currentBase, nextBase)
          : `${nextBase}/home`;
      navigate(nextPath, { replace: true });
    } catch (error) {
      setRestaurantSelectionError(
        error instanceof Error ? error.message : "Failed to assign restaurant.",
      );
    } finally {
      setIsRestaurantSaving(false);
    }
  };

  const restaurantSelectLabel = isRestaurantOptionsLoading
    ? "Loading restaurants..."
    : restaurantOptions.length
      ? "Select restaurant"
      : "No restaurants available";
  const isRestaurantSelectDisabled =
    isRestaurantOptionsLoading || isRestaurantSaving || restaurantOptions.length === 0;

  const navItems = useMemo<NavItem[]>(
    () => [
      {
        label: "Home",
        to: `${basePath}/home`,
        permissionKey: "home",
        icon: <img src={homeLogo} alt="Home" className="h-8 w-8 object-contain" />,
      },
      {
        label: "Approvals",
        to: `${basePath}/approvals`,
        permissionKey: "approvals",
        icon: (
          <span
            aria-hidden="true"
            className={`inline-block ${isCompactSidebar ? "h-7 w-7" : "h-8 w-8"}`}
            style={{
              backgroundColor: "currentColor",
              WebkitMaskImage: `url(${approvalsLogo})`,
              WebkitMaskRepeat: "no-repeat",
              WebkitMaskPosition: "center",
              WebkitMaskSize: "100% 100%",
              maskImage: `url(${approvalsLogo})`,
              maskRepeat: "no-repeat",
              maskPosition: "center",
              maskSize: "100% 100%",
            }}
          />
        ),
      },
      {
        label: "Shift Payout",
        to: `${basePath}/shift-payout`,
        permissionKey: "shift-payout",
        icon: (
          <span
            aria-hidden="true"
            className={`inline-block ${isCompactSidebar ? "h-7 w-7" : "h-8 w-8"}`}
            style={{
              backgroundColor: "currentColor",
              WebkitMaskImage: `url(${shiftPayoutLogo})`,
              WebkitMaskRepeat: "no-repeat",
              WebkitMaskPosition: "center",
              WebkitMaskSize: "100% 100%",
              maskImage: `url(${shiftPayoutLogo})`,
              maskRepeat: "no-repeat",
              maskPosition: "center",
              maskSize: "100% 100%",
            }}
          />
        ),
      },
      {
        label: "Team",
        to: `${basePath}/team`,
        permissionKey: "team",
        icon: (
          <span
            aria-hidden="true"
            className={`inline-block ${isCompactSidebar ? "h-7 w-7" : "h-8 w-8"}`}
            style={{
              backgroundColor: "currentColor",
              WebkitMaskImage: `url(${teamLogo})`,
              WebkitMaskRepeat: "no-repeat",
              WebkitMaskPosition: "center",
              WebkitMaskSize: "100% 100%",
              maskImage: `url(${teamLogo})`,
              maskRepeat: "no-repeat",
              maskPosition: "center",
              maskSize: "100% 100%",
            }}
          />
        ),
      },
      {
        label: "Reports",
        to: `${basePath}/reports`,
        permissionKey: "reports",
        icon: (
          <span
            aria-hidden="true"
            className={`inline-flex items-center justify-center self-center ${isCompactSidebar ? "h-10 w-10" : "h-11 w-11"}`}
            style={{
              backgroundColor: "currentColor",
              WebkitMaskImage: `url(${reportsLogo})`,
              WebkitMaskRepeat: "no-repeat",
              WebkitMaskPosition: "center",
              WebkitMaskSize: "100% 100%",
              maskImage: `url(${reportsLogo})`,
              maskRepeat: "no-repeat",
              maskPosition: "center",
              maskSize: "100% 100%",
            }}
          />
        ),
      },
      {
        label: "Settings",
        to: `${basePath}/settings`,
        permissionKey: "settings",
        icon: (
          <span
            aria-hidden="true"
            className={`inline-block ${isCompactSidebar ? "h-7 w-7" : "h-8 w-8"}`}
            style={{
              backgroundColor: "currentColor",
              WebkitMaskImage: `url(${settingsLogo})`,
              WebkitMaskRepeat: "no-repeat",
              WebkitMaskPosition: "center",
              WebkitMaskSize: "100% 100%",
              maskImage: `url(${settingsLogo})`,
              maskRepeat: "no-repeat",
              maskPosition: "center",
              maskSize: "100% 100%",
            }}
          />
        ),
      },
    ],
    [basePath, isCompactSidebar],
  );

  const allowedNavItems = useMemo(() => navItems.filter((item) => canAccess(item.permissionKey)), [navItems, permissions, isAdminUser]);

  useEffect(() => {
    if (!isBusinessUser && restaurantKey && activeEmployeeId) {
      navigate(`${employeeBase}/home`, { replace: true });
    }
  }, [isBusinessUser, restaurantKey, activeEmployeeId, employeeBase, navigate]);

  useEffect(() => {
    if (isBusinessUser && !restaurantKey && storedRestaurantKey) {
      navigate(`/business/${storedRestaurantKey}/home`, { replace: true });
    }
  }, [isBusinessUser, restaurantKey, storedRestaurantKey, navigate]);

  useEffect(() => {
    if (!isBusinessUser && employeeId && storedUserId && employeeId !== storedUserId) {
      navigate(`${employeeBase}/home`, { replace: true });
    }
  }, [isBusinessUser, employeeId, storedUserId, employeeBase, navigate]);

  useEffect(() => {
    if (!location.pathname.startsWith(basePath)) {
      return;
    }
    if (!permissionsLoaded) {
      return;
    }
    const pathSegment = location.pathname
      .slice(basePath.length)
      .split("/")
      .filter(Boolean)[0];
    if (!pathSegment) {
      return;
    }
    if (!canAccess(pathSegment as NavItem["permissionKey"])) {
      const fallbackPath = allowedNavItems[0]?.to || `${basePath}/profile`;
      if (fallbackPath !== location.pathname) {
        navigate(fallbackPath, { replace: true });
      }
    }
  }, [allowedNavItems, basePath, location.pathname, navigate, permissions]);

  return (
    <div className="h-screen w-full overflow-hidden" style={{ backgroundColor: "#f4f2ee" }}>
      {/* Top Bar */}
      <div className="bg-white border-b border-gray-200 px-6 flex items-center justify-between shadow-sm fixed top-0 left-0 right-0 z-40 h-16">
        {logoData ? (
          <img src={logoData} alt="Gratly Logo" className="h-12" />
        ) : (
          <img src={gratlyLogo} alt="Gratly Logo" className="h-12" />
        )}
        {showRestaurantSelector ? (
          <div className="absolute left-1/2 -translate-x-1/2">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Restaurant
              </span>
              <select
                value={selectedRestaurantValue}
                onChange={handleRestaurantSelection}
                disabled={isRestaurantSelectDisabled}
                className="h-9 w-80 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:border-gray-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="">{restaurantSelectLabel}</option>
                {restaurantOptions.map((restaurant) => {
                  const optionValue = restaurant.restaurantId
                    ? String(restaurant.restaurantId)
                    : `guid:${restaurant.restaurantGuid ?? "unknown"}`;
                  return (
                    <option key={optionValue} value={optionValue}>
                      {restaurant.restaurantName ?? "Unknown Restaurant"}
                      {restaurant.restaurantId ? ` (ID ${restaurant.restaurantId})` : " (Not onboarded)"}
                    </option>
                  );
                })}
              </select>
              {restaurantSelectionError ? (
                <span className="text-xs font-semibold text-red-600">
                  {restaurantSelectionError}
                </span>
              ) : null}
            </div>
          </div>
        ) : restaurantName ? (
          <div className="absolute left-1/2 -translate-x-1/2 text-center text-lg font-semibold text-gray-700 max-w-[40vw] truncate">
            {restaurantName}
          </div>
        ) : null}
        <div className="relative" ref={userMenuRef}>
          <button
            type="button"
            onClick={() => setIsUserMenuOpen((prev) => !prev)}
            className="flex items-center gap-3 rounded-full border border-gray-200 bg-white px-3 py-2 shadow-sm hover:bg-gray-50"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#cab99a] text-sm font-semibold text-black">
              {userInitials}
            </span>
            <span className="text-sm font-semibold text-gray-900">{storedUserName}</span>
            <span className="text-sm text-gray-500">▾</span>
          </button>
          {isUserMenuOpen && (
            <div className="absolute right-0 mt-2 w-48 rounded-lg border border-gray-200 bg-white shadow-lg">
              <Link
                to={`${basePath}/profile`}
                className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                onClick={() => setIsUserMenuOpen(false)}
              >
                Profile
              </Link>
              {isAdminUser ? (
                <Link
                  to={`${basePath}/billing`}
                  className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                  onClick={() => setIsUserMenuOpen(false)}
                >
                  Billing
                </Link>
              ) : null}
              <button
                type="button"
                className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                onClick={() => navigate("/login")}
              >
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex">
        {/* Sidebar */}
        <div
          className={`bg-white border-r border-gray-200 p-6 fixed top-16 left-0 h-[calc(100vh-4rem)] overflow-y-auto transition-all duration-200 ${
            isSidebarCollapsed && !isSidebarHovered ? "w-20" : "w-64"
          }`}
          onMouseEnter={() => setIsSidebarHovered(true)}
          onMouseLeave={() => setIsSidebarHovered(false)}
          onClick={() => {
            if (isSidebarCollapsed) {
              setIsSidebarCollapsed(false);
            }
          }}
        >
          <div className={`flex ${isSidebarCollapsed ? "justify-center" : "justify-end"} mb-4`}>
            <button
              type="button"
              onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
                event.stopPropagation();
                setIsSidebarCollapsed((prev) => {
                  const next = !prev;
                  if (next) {
                    setIsSidebarHovered(false);
                  }
                  return next;
                });
              }}
              className="inline-flex h-6 w-6 items-center justify-center bg-transparent border-0 p-0 text-black hover:text-black dark:text-black dark:hover:text-black"
              aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <span className="flex flex-col items-center gap-1">
                <span className="block h-0.5 w-4 bg-current" />
                <span className="block h-0.5 w-4 bg-current" />
                <span className="block h-0.5 w-4 bg-current" />
              </span>
            </button>
          </div>
          <nav className="space-y-2">
            {allowedNavItems.map((item) => {
              const isActive = location.pathname === item.to;
              return (
                <Link
                  key={item.label}
                  to={item.to}
                  className={`w-full text-left py-3 font-medium transition-all block ${
                    isActive
                      ? `bg-[#cab99a] text-gray-900${isCompactSidebar ? "" : " shadow-md"}`
                      : "text-gray-700 hover:bg-[#e6d7b8] hover:!text-black visited:text-gray-700"
                  } ${isCompactSidebar ? "px-0 -ml-1 w-[calc(100%+0.5rem)] rounded-md" : "px-4 rounded-lg"}`}
                >
                  <span className="inline-flex items-center gap-3">
                    <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center">
                      {item.icon}
                    </span>
                    {(!isSidebarCollapsed || isSidebarHovered) && <span>{item.label}</span>}
                  </span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Main Content */}
        <div
          className={`flex-1 mt-16 h-[calc(100vh-4rem)] overflow-y-auto ${
            isSidebarCollapsed && !isSidebarHovered ? "ml-20" : "ml-64"
          }`}
        >
          <Outlet key={outletKey} />
        </div>
      </div>

      {showAstraPrompt ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900">Complete Astra onboarding</h2>
            <p className="mt-2 text-sm text-gray-600">
              {astraPromptMessage ??
                "Complete your Astra onboarding and add a debit card to get paid tips and gratuities instantly."}
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                onClick={() => setShowAstraPrompt(false)}
              >
                Later
              </button>
              <button
                type="button"
                disabled={astraPromptLoading}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => {
                  setShowAstraPrompt(false);
                  navigate(`${employeeBase}/profile#astra-employee-payouts`);
                }}
              >
                Complete onboarding
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default AppLayout;
