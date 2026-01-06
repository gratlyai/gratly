import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from "react-router-dom";
import { fetchUserProfile, updateUserProfile } from "./api/users";
import {
  API_BASE_URL,
} from "./api/client";
import {
  fetchEmployeeConnection,
  fetchEmployeePayoutMethods,
  fetchRestaurantConnection,
  fetchRestaurantPayoutMethods,
  setEmployeePreferredPayoutMethod,
  setRestaurantPreferredPayoutMethod,
  startEmployeeCardsConnect,
  startEmployeeConnect,
  startRestaurantCardsConnect,
  startRestaurantConnect,
  syncEmployeePayoutMethods,
  syncRestaurantPayoutMethods,
  type AstraConnection,
  type AstraPayoutMethod,
} from "./api/astra";
import {
  getStoredPermissions,
  permissionConfig,
  type PermissionDescriptor,
  type PermissionState,
} from "./auth/permissions";
import { fetchPermissionCatalog } from "./api/permissions";
import { useLocation } from "react-router-dom";

interface UserProfile {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  restaurant: string;
}

const formatValue = (value: string) => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "N/A";
};

const buildFallbackProfile = (): UserProfile => {
  const storedName = localStorage.getItem("userName") || "";
  const nameParts = storedName.split(" ").filter(Boolean);
  const firstName = nameParts[0] ?? "";
  const lastName = nameParts.slice(1).join(" ");
  return {
    firstName,
    lastName,
    email: "",
    phoneNumber: "",
    restaurant: localStorage.getItem("restaurantName") || "",
  };
};

const GratlyProfilePage: React.FC = () => {
  const navigate = useNavigate();
  const { restaurantKey, employeeId } = useParams();
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [profile, setProfile] = useState<UserProfile>(() => buildFallbackProfile());
  const [editedProfile, setEditedProfile] = useState<UserProfile>(() => buildFallbackProfile());
  const [isLoadingProfile, setIsLoadingProfile] = useState<boolean>(true);
  const [permissions, setPermissions] = useState<PermissionState>(() =>
    getStoredPermissions(localStorage.getItem("userId")),
  );
  const location = useLocation();
  const [permissionCatalog, setPermissionCatalog] =
    useState<PermissionDescriptor[]>(permissionConfig);
  const [showSavedToast, setShowSavedToast] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [astraRestaurantConnection, setAstraRestaurantConnection] = useState<AstraConnection | null>(null);
  const [astraEmployeeConnection, setAstraEmployeeConnection] = useState<AstraConnection | null>(null);
  const [astraRestaurantMethods, setAstraRestaurantMethods] = useState<AstraPayoutMethod[]>([]);
  const [astraEmployeeMethods, setAstraEmployeeMethods] = useState<AstraPayoutMethod[]>([]);
  const [astraRestaurantError, setAstraRestaurantError] = useState<string>("");
  const [astraEmployeeError, setAstraEmployeeError] = useState<string>("");
  const [isConnectingRestaurant, setIsConnectingRestaurant] = useState<boolean>(false);
  const [isConnectingEmployee, setIsConnectingEmployee] = useState<boolean>(false);
  const [isSyncingRestaurant, setIsSyncingRestaurant] = useState<boolean>(false);
  const [isSyncingEmployee, setIsSyncingEmployee] = useState<boolean>(false);
  const [isAddingRestaurantCard, setIsAddingRestaurantCard] = useState<boolean>(false);
  const [isAddingEmployeeCard, setIsAddingEmployeeCard] = useState<boolean>(false);
  const restaurantId = restaurantKey ? Number(restaurantKey) : null;
  const storedUserId = localStorage.getItem("userId");
  const userId = storedUserId && Number.isFinite(Number(storedUserId)) ? Number(storedUserId) : null;
  const isAdminUser = permissions.adminAccess || permissions.superadminAccess;
  const initials =
    [profile.firstName, profile.lastName]
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => value[0]?.toUpperCase())
      .slice(0, 2)
      .join("") || "U";
  const formatAstraMethod = (method: AstraPayoutMethod) => {
    const last4 = method.last4 ? `**** ${method.last4}` : "****";
    const label = method.label || (method.methodType === "debit_card" ? "Debit card" : "Bank account");
    const brand = method.brand ? `${method.brand} ` : "";
    return `${label} (${brand}${last4})`;
  };

  useEffect(() => {
    let isMounted = true;
    if (!userId) {
      setIsLoadingProfile(false);
      return;
    }
    fetchUserProfile(userId)
      .then((data) => {
        if (!isMounted || !data) {
          return;
        }
        const nextProfile = {
          firstName: data.firstName ?? "",
          lastName: data.lastName ?? "",
          email: data.email ?? "",
          phoneNumber: data.phoneNumber ?? "",
          restaurant: data.restaurantName ?? localStorage.getItem("restaurantName") ?? "",
        };
        setProfile(nextProfile);
        setEditedProfile(nextProfile);
      })
      .finally(() => {
        if (isMounted) {
          setIsLoadingProfile(false);
        }
      });
    return () => {
      isMounted = false;
    };
  }, [userId]);

  useEffect(() => {
    if (!location.hash) {
      return;
    }
    const targetId = location.hash.replace("#", "");
    if (!targetId) {
      return;
    }
    const attemptScroll = () => {
      const target = document.getElementById(targetId);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };
    const timeoutId = window.setTimeout(attemptScroll, 150);
    return () => window.clearTimeout(timeoutId);
  }, [location.hash]);

  useEffect(() => {
    const storedUserId = localStorage.getItem("userId");
    setPermissions(getStoredPermissions(storedUserId));
  }, []);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const code = query.get("code");
    const state = query.get("state");
    if (!code || !state) {
      return;
    }
    const context = localStorage.getItem("astraReturnContext");
    if (!context) {
      return;
    }
    localStorage.setItem("astraPendingSync", context);
    localStorage.removeItem("astraReturnContext");
    const callbackPath =
      context === "restaurant" ? "/astra/oauth/callback/business" : "/astra/oauth/callback/employee";
    const callbackUrl = `${API_BASE_URL}${callbackPath}?${new URLSearchParams({ code, state }).toString()}`;
    window.location.href = callbackUrl;
  }, []);

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

  useEffect(() => {
    if (!restaurantId || !isAdminUser) {
      return;
    }
    let isMounted = true;
    fetchRestaurantConnection(restaurantId)
      .then((data) => {
        if (isMounted) {
          setAstraRestaurantConnection(data);
        }
      })
      .catch((error) => {
        if (isMounted) {
          setAstraRestaurantError(error instanceof Error ? error.message : "Failed to load Astra connection.");
        }
      });
    return () => {
      isMounted = false;
    };
  }, [restaurantId, isAdminUser]);

  useEffect(() => {
    if (!userId) {
      return;
    }
    let isMounted = true;
    fetchEmployeeConnection(userId)
      .then((data) => {
        if (isMounted) {
          setAstraEmployeeConnection(data);
        }
      })
      .catch((error) => {
        if (isMounted) {
          setAstraEmployeeError(error instanceof Error ? error.message : "Failed to load Astra connection.");
        }
      });
    return () => {
      isMounted = false;
    };
  }, [userId]);

  useEffect(() => {
    if (!astraRestaurantConnection?.connected || !restaurantId) {
      return;
    }
    fetchRestaurantPayoutMethods(restaurantId)
      .then((data) => setAstraRestaurantMethods(data.methods ?? []))
      .catch(() => {
        setAstraRestaurantMethods([]);
      });
  }, [astraRestaurantConnection, restaurantId]);

  useEffect(() => {
    if (!astraEmployeeConnection?.connected || !userId) {
      return;
    }
    fetchEmployeePayoutMethods(userId)
      .then((data) => setAstraEmployeeMethods(data.methods ?? []))
      .catch(() => {
        setAstraEmployeeMethods([]);
      });
  }, [astraEmployeeConnection, userId]);

  useEffect(() => {
    if (!userId) {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") !== "1") {
      return;
    }
    const context = localStorage.getItem("astraPendingSync") || localStorage.getItem("astraReturnContext");
    if (!context) {
      return;
    }
    const finalize = () => {
      localStorage.removeItem("astraPendingSync");
      localStorage.removeItem("astraReturnContext");
    };
    if (context === "restaurant") {
      if (!restaurantId || !isAdminUser) {
        finalize();
        return;
      }
      setIsSyncingRestaurant(true);
      syncRestaurantPayoutMethods(restaurantId)
        .then((response) => {
          setAstraRestaurantMethods(response.methods ?? []);
          if (response.cardError) {
            setAstraRestaurantError(response.cardError);
          }
        })
        .catch((error) => {
          setAstraRestaurantError(error instanceof Error ? error.message : "Unable to sync payout methods.");
        })
        .finally(() => {
          setIsSyncingRestaurant(false);
          finalize();
        });
      return;
    }
    setIsSyncingEmployee(true);
    syncEmployeePayoutMethods(userId)
      .then((response) => {
        setAstraEmployeeMethods(response.methods ?? []);
        if (response.cardError) {
          setAstraEmployeeError(response.cardError);
        }
      })
      .catch((error) => {
        setAstraEmployeeError(error instanceof Error ? error.message : "Unable to sync payout methods.");
      })
      .finally(() => {
        setIsSyncingEmployee(false);
        finalize();
      });
  }, [isAdminUser, restaurantId, userId]);

  const handleEdit = () => {
    setIsEditing(true);
    setEditedProfile(profile);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditedProfile(profile);
  };

  const handleSave = async () => {
    const storedUserId = localStorage.getItem("userId");
    if (!storedUserId) {
      setSaveError("Unable to update profile. Please log in again.");
      return;
    }
    const numericUserId = Number(storedUserId);
    if (!Number.isFinite(numericUserId)) {
      setSaveError("Unable to update profile. Please log in again.");
      return;
    }
    setIsSaving(true);
    setSaveError("");
    try {
      const updated = await updateUserProfile(numericUserId, {
        firstName: editedProfile.firstName,
        lastName: editedProfile.lastName,
        email: editedProfile.email,
        phoneNumber: editedProfile.phoneNumber,
      });
      const nextProfile = {
        firstName: updated.firstName ?? "",
        lastName: updated.lastName ?? "",
        email: updated.email ?? "",
        phoneNumber: updated.phoneNumber ?? "",
        restaurant: updated.restaurantName ?? profile.restaurant,
      };
      setProfile(nextProfile);
      setEditedProfile(nextProfile);
      const fullName = `${nextProfile.firstName} ${nextProfile.lastName}`.trim();
      if (fullName) {
        localStorage.setItem("userName", fullName);
      }
      if (updated.email) {
        localStorage.setItem("rememberedEmail", updated.email);
      }
      setIsEditing(false);
      setShowSavedToast(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update profile.";
      setSaveError(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRestaurantConnect = async () => {
    if (!restaurantId) {
      return;
    }
    if (!userId) {
      setAstraRestaurantError("Missing user ID. Please log in again.");
      return;
    }
    setIsConnectingRestaurant(true);
    setAstraRestaurantError("");
    try {
      const response = await startRestaurantConnect(restaurantId, userId);
      localStorage.setItem("astraReturnContext", "restaurant");
      window.location.href = response.redirectUrl;
    } catch (error) {
      setAstraRestaurantError(error instanceof Error ? error.message : "Unable to start Astra connect.");
    } finally {
      setIsConnectingRestaurant(false);
    }
  };

  const handleEmployeeConnect = async () => {
    if (!userId) {
      setAstraEmployeeError("Missing user ID. Please log in again.");
      return;
    }
    setIsConnectingEmployee(true);
    setAstraEmployeeError("");
    try {
      const response = await startEmployeeConnect(userId);
      localStorage.setItem("astraReturnContext", "employee");
      window.location.href = response.redirectUrl;
    } catch (error) {
      setAstraEmployeeError(error instanceof Error ? error.message : "Unable to start Astra connect.");
    } finally {
      setIsConnectingEmployee(false);
    }
  };

  const handleRestaurantCardConnect = async () => {
    if (!restaurantId) {
      return;
    }
    if (!userId) {
      setAstraRestaurantError("Missing user ID. Please log in again.");
      return;
    }
    setIsAddingRestaurantCard(true);
    setAstraRestaurantError("");
    try {
      const response = await startRestaurantCardsConnect(restaurantId, userId);
      localStorage.setItem("astraReturnContext", "restaurant");
      window.location.href = response.redirectUrl;
    } catch (error) {
      setAstraRestaurantError(error instanceof Error ? error.message : "Unable to start card connect.");
    } finally {
      setIsAddingRestaurantCard(false);
    }
  };

  const handleEmployeeCardConnect = async () => {
    if (!userId) {
      setAstraEmployeeError("Missing user ID. Please log in again.");
      return;
    }
    setIsAddingEmployeeCard(true);
    setAstraEmployeeError("");
    try {
      const response = await startEmployeeCardsConnect(userId);
      localStorage.setItem("astraReturnContext", "employee");
      window.location.href = response.redirectUrl;
    } catch (error) {
      setAstraEmployeeError(error instanceof Error ? error.message : "Unable to start card connect.");
    } finally {
      setIsAddingEmployeeCard(false);
    }
  };

  const handleRestaurantSync = async () => {
    if (!restaurantId) {
      return;
    }
    setIsSyncingRestaurant(true);
    setAstraRestaurantError("");
    try {
      const response = await syncRestaurantPayoutMethods(restaurantId);
      setAstraRestaurantMethods(response.methods ?? []);
      if (response.cardError) {
        setAstraRestaurantError(response.cardError);
      }
    } catch (error) {
      setAstraRestaurantError(error instanceof Error ? error.message : "Unable to sync payout methods.");
    } finally {
      setIsSyncingRestaurant(false);
    }
  };

  const handleEmployeeSync = async () => {
    if (!userId) {
      return;
    }
    setIsSyncingEmployee(true);
    setAstraEmployeeError("");
    try {
      const response = await syncEmployeePayoutMethods(userId);
      setAstraEmployeeMethods(response.methods ?? []);
      if (response.cardError) {
        setAstraEmployeeError(response.cardError);
      }
    } catch (error) {
      setAstraEmployeeError(error instanceof Error ? error.message : "Unable to sync payout methods.");
    } finally {
      setIsSyncingEmployee(false);
    }
  };

  const handleRestaurantPreferred = async (methodId: string) => {
    if (!restaurantId) {
      return;
    }
    try {
      await setRestaurantPreferredPayoutMethod(restaurantId, methodId);
      setAstraRestaurantMethods((methods) =>
        methods.map((method) => ({ ...method, isPreferred: method.id === methodId })),
      );
    } catch (error) {
      setAstraRestaurantError(error instanceof Error ? error.message : "Unable to update preferred method.");
    }
  };

  const handleEmployeePreferred = async (methodId: string) => {
    if (!userId) {
      return;
    }
    try {
      await setEmployeePreferredPayoutMethod(userId, methodId);
      setAstraEmployeeMethods((methods) =>
        methods.map((method) => ({ ...method, isPreferred: method.id === methodId })),
      );
    } catch (error) {
      setAstraEmployeeError(error instanceof Error ? error.message : "Unable to update preferred method.");
    }
  };

  useEffect(() => {
    if (!showSavedToast) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setShowSavedToast(false);
      if (restaurantKey) {
        navigate(`/business/${restaurantKey}/home`);
      } else if (employeeId) {
        navigate(`/employees/${employeeId}/home`);
      } else {
        navigate("/login");
      }
    }, 1500);
    return () => window.clearTimeout(timeoutId);
  }, [employeeId, navigate, restaurantKey, showSavedToast]);

  return (
    <div className="min-h-screen w-full" style={{ backgroundColor: '#f4f2ee' }}>
      {/* Main Content */}
      <div className="max-w-4xl mx-auto p-8">
        {showSavedToast ? (
          <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
            Profile updated successfully!
          </div>
        ) : null}
        {saveError ? (
          <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
            {saveError}
          </div>
        ) : null}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Profile Settings</h1>
          <p className="text-gray-600 mt-2">Manage your account information and permissions</p>
        </div>

        {isLoadingProfile ? (
          <div className="bg-white rounded-xl shadow-md border border-gray-200 p-8 text-gray-600">
            Loading profile...
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden">
            {/* Profile Header */}
            <div className="px-8 py-12 text-center" style={{ backgroundColor: "#cab99a" }}>
              <div className="w-24 h-24 bg-white rounded-full mx-auto flex items-center justify-center mb-4 shadow-lg">
                <span className="text-4xl font-bold text-gray-900">
                  {initials}
                </span>
              </div>
              <h2 className="text-2xl font-bold text-black">
                {formatValue(profile.firstName)} {formatValue(profile.lastName)}
              </h2>
              <p className="text-black mt-1">{formatValue(profile.restaurant)}</p>
            </div>

            {/* Profile Content */}
            <div className="p-8">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold text-gray-900">Personal Information</h3>
                {!isEditing ? (
                  <button
                    onClick={handleEdit}
                    className="bg-[#cab99a] text-black px-6 py-2 rounded-lg font-semibold hover:bg-[#bfa986] transition-all shadow-md"
                  >
                    Edit Profile
                  </button>
                ) : (
                  <div className="flex gap-3">
                    <button
                      onClick={handleCancel}
                      className="bg-white text-gray-900 px-6 py-2 rounded-lg font-semibold border-2 border-gray-300 hover:bg-gray-50 transition-all"
                    >
                      Cancel
                    </button>
                  <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="bg-[#cab99a] text-black px-6 py-2 rounded-lg font-semibold hover:bg-[#bfa986] transition-all shadow-md"
                  >
                    {isSaving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              )}
            </div>

              {/* Form Fields */}
              <div className="space-y-6">
                {/* Name Fields */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      First Name
                    </label>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editedProfile.firstName}
                        onChange={(e) => setEditedProfile({ ...editedProfile, firstName: e.target.value })}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none transition-all"
                      />
                    ) : (
                      <div className="px-4 py-3 bg-gray-50 rounded-lg text-gray-900">
                        {formatValue(profile.firstName)}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Last Name
                    </label>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editedProfile.lastName}
                        onChange={(e) => setEditedProfile({ ...editedProfile, lastName: e.target.value })}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none transition-all"
                      />
                    ) : (
                      <div className="px-4 py-3 bg-gray-50 rounded-lg text-gray-900">
                        {formatValue(profile.lastName)}
                      </div>
                    )}
                  </div>
                </div>

                {/* Email */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Email Address
                  </label>
                  {isEditing ? (
                    <input
                      type="email"
                      value={editedProfile.email}
                      onChange={(e) => setEditedProfile({ ...editedProfile, email: e.target.value })}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none transition-all"
                    />
                  ) : (
                    <div className="px-4 py-3 bg-gray-50 rounded-lg text-gray-900">
                      {formatValue(profile.email)}
                    </div>
                  )}
                </div>

                {/* Phone Number */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Phone Number
                  </label>
                  {isEditing ? (
                    <input
                      type="tel"
                      value={editedProfile.phoneNumber}
                      onChange={(e) => setEditedProfile({ ...editedProfile, phoneNumber: e.target.value })}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none transition-all"
                    />
                  ) : (
                    <div className="px-4 py-3 bg-gray-50 rounded-lg text-gray-900">
                      {formatValue(profile.phoneNumber)}
                    </div>
                  )}
                </div>

                {/* Restaurant */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Restaurant
                  </label>
                  <div className="px-4 py-3 bg-gray-50 rounded-lg text-gray-900">
                    {formatValue(profile.restaurant)}
                  </div>
                </div>

                {/* Permissions */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-3">
                    Permissions
                  </label>
                  <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                    <div className="grid grid-cols-2 gap-3">
                      {permissionCatalog.map((permission) => (
                        <label
                          key={permission.key}
                          className={`flex items-center gap-3 p-3 rounded-lg transition-all cursor-default ${
                            permissions[permission.key]
                              ? 'bg-white border-2 border-gray-900'
                              : 'bg-gray-100 border-2 border-transparent'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={permissions[permission.key]}
                            readOnly
                            disabled
                            className="w-5 h-5 rounded"
                          />
                          <span className={`text-sm font-medium ${
                            permissions[permission.key]
                              ? 'text-gray-900'
                              : 'text-gray-600'
                          }`}>
                            {permission.label}
                          </span>
                        </label>
                      ))}
                    </div>
                    <p className="mt-3 text-xs font-medium text-gray-500">
                      Permissions are managed by your admin or owner.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {!isLoadingProfile && isAdminUser && restaurantId ? (
          <div className="bg-white rounded-xl shadow-md border border-gray-200 p-6 mt-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Astra Business Payouts</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3 text-sm">
                <span className="font-medium text-gray-900">Connection status</span>
                <span
                  className={`text-xs font-semibold ${
                    astraRestaurantConnection?.connected ? "text-emerald-600" : "text-gray-500"
                  }`}
                >
                  {astraRestaurantConnection?.connected ? "Connected" : "Not connected"}
                </span>
              </div>
              {astraRestaurantConnection?.connected ? (
                <div className="rounded-lg bg-gray-50 px-4 py-3 text-xs text-gray-600 space-y-1">
                  <p>Onboarding status: {astraRestaurantConnection.onboardingStatus ?? "pending_review"}</p>
                  <p>KYC/KYB status: {astraRestaurantConnection.kyxType ?? "N/A"}</p>
                  {astraRestaurantConnection.lastStatusReason ? (
                    <p>Status reason: {astraRestaurantConnection.lastStatusReason}</p>
                  ) : null}
                  {astraRestaurantConnection.astraUserId ? (
                    <p className="break-all">Astra user ID: {astraRestaurantConnection.astraUserId}</p>
                  ) : null}
                </div>
              ) : null}
              <div className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3 text-sm">
                <span className="font-medium text-gray-900">Connect Astra to receive payouts</span>
                <button
                  type="button"
                  onClick={handleRestaurantConnect}
                  disabled={isConnectingRestaurant}
                  className="text-xs font-semibold text-gray-900 hover:text-gray-700 disabled:cursor-not-allowed disabled:text-gray-400"
                >
                  {isConnectingRestaurant ? "Starting..." : "Connect to Astra"}
                </button>
              </div>
              {astraRestaurantConnection?.connected ? (
                <div className="rounded-lg bg-gray-50 px-4 py-3 text-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-900">Payout methods</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleRestaurantSync}
                        disabled={isSyncingRestaurant}
                        className="text-xs font-semibold text-gray-900 hover:text-gray-700 disabled:cursor-not-allowed disabled:text-gray-400"
                      >
                        {isSyncingRestaurant ? "Syncing..." : "Sync"}
                      </button>
                      <button
                        type="button"
                        onClick={handleRestaurantCardConnect}
                        disabled={isAddingRestaurantCard}
                        className="text-xs font-semibold text-gray-900 hover:text-gray-700 disabled:cursor-not-allowed disabled:text-gray-400"
                      >
                        {isAddingRestaurantCard ? "Opening..." : "Add debit card"}
                      </button>
                    </div>
                  </div>
                  {astraRestaurantMethods.length ? (
                    <div className="space-y-2">
                      {astraRestaurantMethods.map((method) => (
                        <div
                          key={method.id}
                          className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-xs"
                        >
                          <div>
                            <p className="font-semibold text-gray-900">{formatAstraMethod(method)}</p>
                            <p className="text-gray-500">Status: {method.status ?? "active"}</p>
                          </div>
                          {method.isPreferred ? (
                            <span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-semibold text-emerald-700">
                              Preferred
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleRestaurantPreferred(method.id)}
                              className="text-[10px] font-semibold text-gray-900 hover:text-gray-700"
                            >
                              Set preferred
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500">No payout methods found yet.</p>
                  )}
                </div>
              ) : null}
              {astraRestaurantError ? (
                <p className="text-xs font-semibold text-red-600">{astraRestaurantError}</p>
              ) : null}
            </div>
          </div>
        ) : null}

        {!isLoadingProfile && userId && !isAdminUser ? (
          <div
            id="astra-employee-payouts"
            className="bg-white rounded-xl shadow-md border border-gray-200 p-6 mt-6"
          >
            <h3 className="text-lg font-bold text-gray-900 mb-4">Astra Employee Payouts</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3 text-sm">
                <span className="font-medium text-gray-900">Connection status</span>
                <span
                  className={`text-xs font-semibold ${
                    astraEmployeeConnection?.connected ? "text-emerald-600" : "text-gray-500"
                  }`}
                >
                  {astraEmployeeConnection?.connected ? "Connected" : "Not connected"}
                </span>
              </div>
              {astraEmployeeConnection?.connected ? (
                <div className="rounded-lg bg-gray-50 px-4 py-3 text-xs text-gray-600 space-y-1">
                  <p>Onboarding status: {astraEmployeeConnection.onboardingStatus ?? "pending_review"}</p>
                  <p>KYC status: {astraEmployeeConnection.kyxType ?? "N/A"}</p>
                  {astraEmployeeConnection.lastStatusReason ? (
                    <p>Status reason: {astraEmployeeConnection.lastStatusReason}</p>
                  ) : null}
                  {astraEmployeeConnection.astraUserId ? (
                    <p className="break-all">Astra user ID: {astraEmployeeConnection.astraUserId}</p>
                  ) : null}
                </div>
              ) : null}
              <div className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3 text-sm">
                <span className="font-medium text-gray-900">Connect Astra to receive payouts</span>
                <button
                  type="button"
                  onClick={handleEmployeeConnect}
                  disabled={isConnectingEmployee}
                  className="text-xs font-semibold text-gray-900 hover:text-gray-700 disabled:cursor-not-allowed disabled:text-gray-400"
                >
                  {isConnectingEmployee ? "Starting..." : "Connect to Astra"}
                </button>
              </div>
              {astraEmployeeConnection?.connected ? (
                <div className="rounded-lg bg-gray-50 px-4 py-3 text-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-900">Payout methods</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleEmployeeSync}
                        disabled={isSyncingEmployee}
                        className="text-xs font-semibold text-gray-900 hover:text-gray-700 disabled:cursor-not-allowed disabled:text-gray-400"
                      >
                        {isSyncingEmployee ? "Syncing..." : "Sync"}
                      </button>
                      <button
                        type="button"
                        onClick={handleEmployeeCardConnect}
                        disabled={isAddingEmployeeCard}
                        className="text-xs font-semibold text-gray-900 hover:text-gray-700 disabled:cursor-not-allowed disabled:text-gray-400"
                      >
                        {isAddingEmployeeCard ? "Opening..." : "Add debit card"}
                      </button>
                    </div>
                  </div>
                  {astraEmployeeMethods.length ? (
                    <div className="space-y-2">
                      {astraEmployeeMethods.map((method) => (
                        <div
                          key={method.id}
                          className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-xs"
                        >
                          <div>
                            <p className="font-semibold text-gray-900">{formatAstraMethod(method)}</p>
                            <p className="text-gray-500">Status: {method.status ?? "active"}</p>
                          </div>
                          {method.isPreferred ? (
                            <span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-semibold text-emerald-700">
                              Preferred
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleEmployeePreferred(method.id)}
                              className="text-[10px] font-semibold text-gray-900 hover:text-gray-700"
                            >
                              Set preferred
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500">No payout methods found yet.</p>
                  )}
                </div>
              ) : null}
              {astraEmployeeError ? (
                <p className="text-xs font-semibold text-red-600">{astraEmployeeError}</p>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Additional Info Card */}
        <div className="bg-white rounded-xl shadow-md border border-gray-200 p-6 mt-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Account Security</h3>
          <div className="space-y-3">
            <button className="w-full text-left px-4 py-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors flex items-center justify-between">
              <span className="font-medium text-gray-900">Two-Factor Authentication</span>
              <span className="text-green-600 text-sm font-semibold">Enabled</span>
            </button>
            <button className="w-full text-left px-4 py-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors flex items-center justify-between">
              <span className="font-medium text-gray-900">Session History</span>
              <span className="text-gray-400">→</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GratlyProfilePage;
