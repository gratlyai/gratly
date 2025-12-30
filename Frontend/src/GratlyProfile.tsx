import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from "react-router-dom";
import { fetchUserProfile, updateUserProfile } from "./api/users";
import {
  createOrFetchStripeConnectedAccount,
  createStripeOnboardingLink,
  fetchStripeConnectedAccount,
  fetchEmployees,
  type StripeConnectedAccount,
} from "./api/employees";
import { getStoredPermissions, permissionConfig, type PermissionState } from "./auth/permissions";

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
  const [logoData, setLogoData] = useState<string>('');
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [profile, setProfile] = useState<UserProfile>(() => buildFallbackProfile());
  const [editedProfile, setEditedProfile] = useState<UserProfile>(() => buildFallbackProfile());
  const [isLoadingProfile, setIsLoadingProfile] = useState<boolean>(true);
  const [permissions, setPermissions] = useState<PermissionState>(() =>
    getStoredPermissions(localStorage.getItem("userId")),
  );
  const [showSavedToast, setShowSavedToast] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [employeeGuid, setEmployeeGuid] = useState<string | null>(null);
  const [stripeAccount, setStripeAccount] = useState<StripeConnectedAccount | null>(null);
  const [isCreatingStripeAccount, setIsCreatingStripeAccount] = useState<boolean>(false);
  const [stripeError, setStripeError] = useState<string>("");
  const initials =
    [profile.firstName, profile.lastName]
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => value[0]?.toUpperCase())
      .slice(0, 2)
      .join("") || "U";
  const formatCapabilities = (capabilities?: Record<string, string> | null) => {
    if (!capabilities) {
      return "N/A";
    }
    const entries = Object.entries(capabilities)
      .map(([key, value]) => `${key}: ${value}`)
      .join(", ");
    return entries.length > 0 ? entries : "N/A";
  };
  const formatCardDetails = (card?: StripeConnectedAccount["card"] | null) => {
    if (!card) {
      return "N/A";
    }
    const brand = card.brand ?? "Card";
    const last4 = card.last4 ? `**** ${card.last4}` : "****";
    const expMonth = card.expMonth ? String(card.expMonth).padStart(2, "0") : "--";
    const expYear = card.expYear ? String(card.expYear) : "--";
    const funding = card.funding ? `, ${card.funding}` : "";
    const country = card.country ? `, ${card.country}` : "";
    return `${brand} ${last4} exp ${expMonth}/${expYear}${funding}${country}`;
  };

  useEffect(() => {
    const loadLogo = async (): Promise<void> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = await (window as any).fs.readFile('image.png');
        const blob = new Blob([data], { type: 'image/png' });
        const url = URL.createObjectURL(blob);
        setLogoData(url);
      } catch (error) {
        console.error('Error loading logo:', error);
      }
    };
    loadLogo();
  }, []);

  useEffect(() => {
    const storedUserId = localStorage.getItem("userId");
    if (!storedUserId) {
      return;
    }
    const numericUserId = Number(storedUserId);
    if (!Number.isFinite(numericUserId)) {
      return;
    }
    let isMounted = true;
    fetchEmployees()
      .then((employees) => {
        if (!isMounted) {
          return;
        }
        const match = employees.find((entry) => entry.userId === numericUserId);
        const nextEmployeeGuid = match?.employeeGuid ?? null;
        setEmployeeGuid(nextEmployeeGuid);
        if (!nextEmployeeGuid) {
          return;
        }
        fetchStripeConnectedAccount(nextEmployeeGuid)
          .then((summary) => {
            if (!isMounted || !summary?.accountId) {
              return;
            }
            setStripeAccount({
              accountId: summary.accountId,
              created: false,
              chargesEnabled: summary.chargesEnabled ?? false,
              payoutsEnabled: summary.payoutsEnabled ?? false,
              detailsSubmitted: summary.detailsSubmitted ?? false,
              disabledReason: summary.disabledReason ?? null,
              accountDeauthorized: summary.accountDeauthorized ?? false,
              businessType: summary.businessType ?? null,
              capabilities: summary.capabilities ?? null,
              defaultCurrency: summary.defaultCurrency ?? null,
              card: summary.card ?? null,
            });
          })
          .catch(() => {
            if (isMounted) {
              setStripeAccount(null);
            }
          });
      })
      .catch(() => {
        if (isMounted) {
          setEmployeeGuid(null);
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    const storedUserId = localStorage.getItem("userId");
    if (!storedUserId) {
      setIsLoadingProfile(false);
      return;
    }
    const numericUserId = Number(storedUserId);
    if (!Number.isFinite(numericUserId)) {
      setIsLoadingProfile(false);
      return;
    }
    fetchUserProfile(numericUserId)
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
  }, []);

  useEffect(() => {
    const storedUserId = localStorage.getItem("userId");
    setPermissions(getStoredPermissions(storedUserId));
  }, []);

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

  const handleStripeAccountCreate = async () => {
    if (!employeeGuid) {
      setStripeError("Employee GUID is required to create a Stripe account.");
      return;
    }
    setStripeError("");
    setIsCreatingStripeAccount(true);
    const response = await createOrFetchStripeConnectedAccount(employeeGuid);
    if (!response) {
      setStripeError("Unable to create Stripe connected account.");
      setIsCreatingStripeAccount(false);
      return;
    }
    setStripeAccount(response);

    const onboardingLink = await createStripeOnboardingLink(employeeGuid);
    if (!onboardingLink?.url) {
      setStripeError("Unable to start Stripe onboarding.");
      setIsCreatingStripeAccount(false);
      return;
    }
    window.location.assign(onboardingLink.url);
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
                      {permissionConfig.map((permission) => (
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

        {!isLoadingProfile ? (
          <div className="bg-white rounded-xl shadow-md border border-gray-200 p-6 mt-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Stripe Account Details</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3 text-sm">
                <span className="font-medium text-gray-900">Connected account</span>
                <span
                  className={`text-xs font-semibold ${
                    stripeAccount ? "text-emerald-600" : "text-gray-500"
                  }`}
                >
                  {stripeAccount ? "Connected" : "Not created"}
                </span>
              </div>
              {stripeAccount ? (
                <div className="rounded-lg bg-gray-50 px-4 py-3 text-xs text-gray-600">
                  <p>Charges enabled: {stripeAccount.chargesEnabled ? "Yes" : "No"}</p>
                  <p>Payouts enabled: {stripeAccount.payoutsEnabled ? "Yes" : "No"}</p>
                  <p>Details submitted: {stripeAccount.detailsSubmitted ? "Yes" : "No"}</p>
                  <p>Business type: {stripeAccount.businessType ?? "N/A"}</p>
                  <p>Default currency: {stripeAccount.defaultCurrency ?? "N/A"}</p>
                  <p>Capabilities: {formatCapabilities(stripeAccount.capabilities)}</p>
                  <p>Card: {formatCardDetails(stripeAccount.card)}</p>
                  {stripeAccount.accountDeauthorized ? (
                    <p>Account deauthorized: Yes</p>
                  ) : null}
                  {stripeAccount.disabledReason ? (
                    <p>Disabled reason: {stripeAccount.disabledReason}</p>
                  ) : null}
                  <p className="break-all">Account ID: {stripeAccount.accountId}</p>
                </div>
              ) : null}
              <div className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3 text-sm">
                <span className="font-medium text-gray-900">Start onboarding to receive payouts</span>
                <button
                  type="button"
                  onClick={handleStripeAccountCreate}
                  disabled={isCreatingStripeAccount || !employeeGuid}
                  className="text-xs font-semibold text-gray-900 hover:text-gray-700 disabled:cursor-not-allowed disabled:text-gray-400"
                >
                  {isCreatingStripeAccount ? "Starting..." : "Start"}
                </button>
              </div>
              {stripeError ? (
                <p className="text-xs font-semibold text-red-600">{stripeError}</p>
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
