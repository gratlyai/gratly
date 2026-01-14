import { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { fetchUserProfile, updateUserProfile } from "./api/users";
import {
  fetchEmployeePaymentMethods,
  refreshEmployeePaymentMethods,
  setEmployeePreferredPaymentMethod,
  startEmployeeOnboarding,
  type MoovPaymentMethod,
} from "./api/moov";
import {
  getStoredPermissions,
  permissionConfig,
  type PermissionDescriptor,
  type PermissionState,
} from "./auth/permissions";
import { fetchPermissionCatalog } from "./api/permissions";

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

  // Employee payment methods
  const [employeePaymentMethods, setEmployeePaymentMethods] = useState<MoovPaymentMethod[]>([]);
  const [isLoadingEmployeeData, setIsLoadingEmployeeData] = useState(false);
  const [employeeError, setEmployeeError] = useState<string>("");
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [isRefreshingMethods, setIsRefreshingMethods] = useState(false);

  const storedUserId = localStorage.getItem("userId");
  const userId = storedUserId && Number.isFinite(Number(storedUserId)) ? Number(storedUserId) : null;
  const initials =
    [profile.firstName, profile.lastName]
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => value[0]?.toUpperCase())
      .slice(0, 2)
      .join("") || "U";

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

  // Load employee payment methods and connection
  useEffect(() => {
    if (!userId) return;

    const loadEmployeeData = async () => {
      try {
        setIsLoadingEmployeeData(true);
        setEmployeeError("");
        const methods = await fetchEmployeePaymentMethods(userId);
        setEmployeePaymentMethods(Array.isArray(methods) ? methods : methods?.methods || []);
      } catch (err) {
        setEmployeeError(err instanceof Error ? err.message : "Failed to load payment methods");
      } finally {
        setIsLoadingEmployeeData(false);
      }
    };

    loadEmployeeData();
  }, [userId]);


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

  const handleStartEmployeeOnboarding = async () => {
    if (!userId) return;
    try {
      setIsOnboarding(true);
      setEmployeeError("");
      const returnUrl = `${window.location.origin}/gratly-profile`;
      const refreshUrl = returnUrl;
      const result = await startEmployeeOnboarding(userId, returnUrl, refreshUrl);
      if (result.redirectUrl) {
        window.location.href = result.redirectUrl;
      }
    } catch (err) {
      setEmployeeError(err instanceof Error ? err.message : "Failed to start onboarding");
    } finally {
      setIsOnboarding(false);
    }
  };

  const handleRefreshEmployeeMethods = async () => {
    if (!userId) return;
    try {
      setIsRefreshingMethods(true);
      setEmployeeError("");
      const response = await refreshEmployeePaymentMethods(userId);
      setEmployeePaymentMethods(response?.methods || response || []);
    } catch (err) {
      setEmployeeError(err instanceof Error ? err.message : "Failed to refresh payment methods");
    } finally {
      setIsRefreshingMethods(false);
    }
  };

  const handleSetPreferredEmployeeMethod = async (methodId: string) => {
    if (!userId) return;
    try {
      setEmployeeError("");
      await setEmployeePreferredPaymentMethod(userId, methodId);
      setEmployeePaymentMethods(methods =>
        methods.map(m => ({
          ...m,
          isPreferred: m.moovPaymentMethodId === methodId,
        }))
      );
    } catch (err) {
      setEmployeeError(err instanceof Error ? err.message : "Failed to update preferred method");
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

        {/* Employee Payment Methods Card */}
        <div className="bg-white rounded-xl shadow-md border border-gray-200 p-6 mt-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-gray-900">Payment Methods</h3>
            <button
              type="button"
              onClick={handleRefreshEmployeeMethods}
              disabled={isRefreshingMethods}
              className="text-xs font-semibold text-gray-900 hover:text-gray-700 disabled:text-gray-400 disabled:cursor-not-allowed"
            >
              {isRefreshingMethods ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          {employeeError && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-sm font-semibold text-red-700">{employeeError}</p>
            </div>
          )}

          {isLoadingEmployeeData ? (
            <p className="text-gray-600">Loading payment methods...</p>
          ) : (
            <>
              {employeeConnection?.connected && (
                <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <p className="text-sm font-semibold text-emerald-900">✓ Moov Account Connected</p>
                  <p className="text-xs text-emerald-700 mt-1">
                    Status: {employeeConnection.onboardingStatus || "verified"}
                  </p>
                </div>
              )}

              {employeePaymentMethods.length > 0 ? (
                <div className="space-y-2 mb-4">
                  {employeePaymentMethods.map((method) => (
                    <div
                      key={method.moovPaymentMethodId}
                      className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3"
                    >
                      <div className="flex-1">
                        <p className="font-semibold text-gray-900">
                          {method.brand || method.methodType}
                          {method.last4 && ` •••${method.last4}`}
                        </p>
                        <p className="text-xs text-gray-500">
                          {method.isVerified ? "✓ Verified" : "Not verified"} • {method.status}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        {method.isPreferred && (
                          <span className="rounded-full bg-blue-100 px-2 py-1 text-[10px] font-semibold text-blue-700">
                            Preferred
                          </span>
                        )}
                        {!method.isPreferred && (
                          <button
                            type="button"
                            onClick={() => handleSetPreferredEmployeeMethod(method.moovPaymentMethodId)}
                            className="text-[10px] font-semibold text-gray-900 hover:text-gray-700"
                          >
                            Set preferred
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500 mb-4">No payment methods on file</p>
              )}

              <button
                type="button"
                onClick={handleStartEmployeeOnboarding}
                disabled={isOnboarding}
                className="w-full rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-400"
              >
                {isOnboarding ? "Opening..." : "Add or Update Payment Method"}
              </button>

              {!employeeConnection?.connected && (
                <p className="text-xs text-gray-500 mt-3 text-center">
                  Set up your Moov account to receive instant payouts and manage payment methods.
                </p>
              )}
            </>
          )}
        </div>

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
