import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../providers/useAuth";
import AppShell from "../components/AppShell";
import { fetchPermissionCatalog } from "../../core/api/permissions";
import { fetchUserProfile, updateUserProfile } from "../../core/api/users";
import {
  fetchEmployeeConnection,
  fetchEmployeePaymentMethods,
  refreshEmployeePaymentMethods,
  setEmployeePreferredPaymentMethod,
  startEmployeeOnboarding,
  type MoovConnection,
  type MoovPaymentMethod,
} from "../../core/api/moov";
import {
  defaultEmployeePermissions,
  permissionConfig,
  type PermissionDescriptor,
  type PermissionState,
} from "../../core/auth/permissions";
import { setItem, StorageKeys } from "../../core/storage/secureStore";
import { useSessionScope } from "../hooks/useSessionScope";
import type { SettingsStackParamList } from "../navigation/types";

type ProfileState = {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  restaurant: string;
};

const fontFamily = Platform.select({ ios: "SF Pro Text", android: "Roboto" }) ?? "System";
const controlRadius = 8;

const formatValue = (value: string) => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "N/A";
};

const buildFallbackProfile = (name: string, restaurantName: string | null): ProfileState => {
  const nameParts = name.split(" ").filter(Boolean);
  const firstName = nameParts[0] ?? "";
  const lastName = nameParts.slice(1).join(" ");
  return {
    firstName,
    lastName,
    email: "",
    phoneNumber: "",
    restaurant: restaurantName ?? "",
  };
};

const ProfileScreen = () => {
  const { session, updateSessionUserName, setRememberedEmail } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<SettingsStackParamList>>();
  const scope = useSessionScope();
  const userId = scope?.userId ?? null;
  const restaurantId = scope?.restaurantId ?? null;
  const initialProfile = useMemo(
    () => buildFallbackProfile(session?.userName ?? "", session?.restaurantName ?? null),
    [session?.restaurantName, session?.userName],
  );
  const [profile, setProfile] = useState<ProfileState>(initialProfile);
  const [editedProfile, setEditedProfile] = useState<ProfileState>(initialProfile);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [showSavedToast, setShowSavedToast] = useState(false);
  const [permissionCatalog, setPermissionCatalog] =
    useState<PermissionDescriptor[]>(permissionConfig);
  const [permissions, setPermissions] = useState<PermissionState>(
    session?.permissions ?? defaultEmployeePermissions,
  );

  // Employee payment methods
  const [employeePaymentMethods, setEmployeePaymentMethods] = useState<MoovPaymentMethod[]>([]);
  const [employeeConnection, setEmployeeConnection] = useState<MoovConnection | null>(null);
  const [isLoadingEmployeeData, setIsLoadingEmployeeData] = useState(false);
  const [employeeMethodsError, setEmployeeMethodsError] = useState("");
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [isRefreshingMethods, setIsRefreshingMethods] = useState(false);

  const isAdminUser = Boolean(session?.permissions?.adminAccess || session?.permissions?.superadminAccess);
  const initials =
    [profile.firstName, profile.lastName]
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => value[0]?.toUpperCase())
      .slice(0, 2)
      .join("") || "U";

  useEffect(() => {
    setPermissions(session?.permissions ?? defaultEmployeePermissions);
  }, [session?.permissions]);

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
          restaurant: data.restaurantName ?? session?.restaurantName ?? "",
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
  }, [session?.restaurantName, userId]);

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
    if (!showSavedToast) {
      return;
    }
    const timeoutId = setTimeout(() => setShowSavedToast(false), 1500);
    return () => clearTimeout(timeoutId);
  }, [showSavedToast]);

  // Load employee payment methods and connection
  useEffect(() => {
    if (!userId) return;

    const loadEmployeeData = async () => {
      try {
        setIsLoadingEmployeeData(true);
        setEmployeeMethodsError("");
        const [methods, connection] = await Promise.all([
          fetchEmployeePaymentMethods(userId),
          fetchEmployeeConnection(userId),
        ]);
        setEmployeePaymentMethods(methods);
        setEmployeeConnection(connection);
      } catch (err) {
        setEmployeeMethodsError(err instanceof Error ? err.message : "Failed to load payment methods");
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
    if (!userId) {
      setSaveError("Unable to update profile. Please log in again.");
      return;
    }
    setIsSaving(true);
    setSaveError("");
    try {
      const updated = await updateUserProfile(userId, {
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
        await setItem(StorageKeys.userName, fullName);
        updateSessionUserName(fullName);
      }
      if (nextProfile.email) {
        await setRememberedEmail(nextProfile.email);
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
      setEmployeeMethodsError("");
      const returnUrl = "gratly://profile";
      const refreshUrl = returnUrl;
      const result = await startEmployeeOnboarding(userId, returnUrl, refreshUrl);
      if (result.redirectUrl) {
        // For iOS, we can use Linking to open the URL
        // Since this is React Native, we would use Linking.openURL here
        // But for now, we'll show an alert with instructions
        alert(`Opening Moov onboarding flow`);
      }
    } catch (err) {
      setEmployeeMethodsError(err instanceof Error ? err.message : "Failed to start onboarding");
    } finally {
      setIsOnboarding(false);
    }
  };

  const handleRefreshEmployeeMethods = async () => {
    if (!userId) return;
    try {
      setIsRefreshingMethods(true);
      setEmployeeMethodsError("");
      const methods = await refreshEmployeePaymentMethods(userId);
      setEmployeePaymentMethods(methods);
    } catch (err) {
      setEmployeeMethodsError(err instanceof Error ? err.message : "Failed to refresh payment methods");
    } finally {
      setIsRefreshingMethods(false);
    }
  };

  const handleSetPreferredEmployeeMethod = async (methodId: string) => {
    if (!userId) return;
    try {
      setEmployeeMethodsError("");
      await setEmployeePreferredPaymentMethod(userId, methodId);
      setEmployeePaymentMethods(methods =>
        methods.map(m => ({
          ...m,
          isPreferred: m.moovPaymentMethodId === methodId,
        }))
      );
    } catch (err) {
      setEmployeeMethodsError(err instanceof Error ? err.message : "Failed to update preferred method");
    }
  };

  const handleOpenBilling = () => {
    if (isAdminUser) {
      navigation.navigate("Billing");
    }
  };

  return (
    <AppShell>
      <ScrollView contentContainerStyle={styles.container}>
        {showSavedToast ? (
          <View style={styles.successBanner}>
            <Text style={styles.bannerText}>Profile updated successfully!</Text>
          </View>
        ) : null}
        {saveError ? (
          <View style={styles.errorBanner}>
            <Text style={styles.bannerText}>{saveError}</Text>
          </View>
        ) : null}
        <View style={styles.pageHeader}>
          <Text style={styles.pageTitle}>Profile Settings</Text>
          <Text style={styles.pageSubtitle}>Manage your account information and permissions</Text>
        </View>

        {isLoadingProfile ? (
          <View style={styles.card}>
            <Text style={styles.loadingText}>Loading profile...</Text>
          </View>
        ) : (
          <View style={styles.profileCard}>
            <View style={styles.profileHeader}>
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarText}>{initials}</Text>
              </View>
              <Text style={styles.profileName}>
                {formatValue(profile.firstName)} {formatValue(profile.lastName)}
              </Text>
              <Text style={styles.profileRestaurant}>{formatValue(profile.restaurant)}</Text>
            </View>

            <View style={styles.profileContent}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Personal Information</Text>
                {!isEditing ? (
                  <Pressable style={styles.editButton} onPress={handleEdit}>
                    <Text style={styles.editButtonText}>Edit Profile</Text>
                  </Pressable>
                ) : (
                  <View style={styles.editActions}>
                    <Pressable style={styles.cancelButton} onPress={handleCancel}>
                      <Text style={styles.cancelButtonText}>Cancel</Text>
                    </Pressable>
                    <Pressable style={styles.saveButton} onPress={handleSave} disabled={isSaving}>
                      {isSaving ? (
                        <ActivityIndicator size={18} color="#111827" />
                      ) : (
                        <Text style={styles.saveButtonText}>Save Changes</Text>
                      )}
                    </Pressable>
                  </View>
                )}
              </View>

              <View style={styles.formGrid}>
                <View style={styles.field}>
                  <Text style={styles.label}>First Name</Text>
                  {isEditing ? (
                    <TextInput
                      style={styles.input}
                      value={editedProfile.firstName}
                      onChangeText={(value) => setEditedProfile({ ...editedProfile, firstName: value })}
                    />
                  ) : (
                    <View style={styles.readOnlyField}>
                      <Text style={styles.readOnlyText}>{formatValue(profile.firstName)}</Text>
                    </View>
                  )}
                </View>
                <View style={styles.field}>
                  <Text style={styles.label}>Last Name</Text>
                  {isEditing ? (
                    <TextInput
                      style={styles.input}
                      value={editedProfile.lastName}
                      onChangeText={(value) => setEditedProfile({ ...editedProfile, lastName: value })}
                    />
                  ) : (
                    <View style={styles.readOnlyField}>
                      <Text style={styles.readOnlyText}>{formatValue(profile.lastName)}</Text>
                    </View>
                  )}
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Email Address</Text>
                {isEditing ? (
                  <TextInput
                    style={styles.input}
                    value={editedProfile.email}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    onChangeText={(value) => setEditedProfile({ ...editedProfile, email: value })}
                  />
                ) : (
                  <View style={styles.readOnlyField}>
                    <Text style={styles.readOnlyText}>{formatValue(profile.email)}</Text>
                  </View>
                )}
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Phone Number</Text>
                {isEditing ? (
                  <TextInput
                    style={styles.input}
                    value={editedProfile.phoneNumber}
                    keyboardType="phone-pad"
                    onChangeText={(value) => setEditedProfile({ ...editedProfile, phoneNumber: value })}
                  />
                ) : (
                  <View style={styles.readOnlyField}>
                    <Text style={styles.readOnlyText}>{formatValue(profile.phoneNumber)}</Text>
                  </View>
                )}
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Restaurant</Text>
                <View style={styles.readOnlyField}>
                  <Text style={styles.readOnlyText}>{formatValue(profile.restaurant)}</Text>
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Permissions</Text>
                <View style={styles.permissionCard}>
                  <View style={styles.permissionGrid}>
                    {permissionCatalog.map((permission) => {
                      const active = permissions[permission.key];
                      return (
                        <View
                          key={permission.key}
                          style={[
                            styles.permissionItem,
                            active ? styles.permissionItemActive : styles.permissionItemInactive,
                          ]}
                        >
                          <View
                            style={[
                              styles.permissionCheck,
                              active ? styles.permissionCheckActive : styles.permissionCheckInactive,
                            ]}
                          >
                            {active ? <Ionicons name="checkmark" size={12} color="#111827" /> : null}
                          </View>
                          <Text
                            style={[
                              styles.permissionLabel,
                              active ? styles.permissionLabelActive : styles.permissionLabelInactive,
                            ]}
                          >
                            {permission.label}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                  <Text style={styles.permissionNote}>Permissions are managed by your admin or owner.</Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* Employee Payment Methods Section */}
        {!isLoadingProfile && (
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionCardTitle}>Payment Methods</Text>
              <Pressable
                onPress={handleRefreshEmployeeMethods}
                disabled={isRefreshingMethods}
              >
                <Text style={[styles.refreshButton, isRefreshingMethods && styles.refreshButtonDisabled]}>
                  {isRefreshingMethods ? "Refreshing..." : "Refresh"}
                </Text>
              </Pressable>
            </View>
            <View style={styles.sectionBody}>
              {employeeMethodsError ? (
                <View style={styles.errorBanner}>
                  <Text style={styles.errorText}>{employeeMethodsError}</Text>
                </View>
              ) : null}

              {isLoadingEmployeeData ? (
                <ActivityIndicator size="large" color="#111827" style={{ marginVertical: 20 }} />
              ) : (
                <>
                  {employeeConnection?.connected && (
                    <View style={styles.successBanner}>
                      <Text style={styles.successText}>✓ Moov Account Connected</Text>
                      <Text style={styles.successSubtext}>Status: {employeeConnection.onboardingStatus || "verified"}</Text>
                    </View>
                  )}

                  {employeePaymentMethods.length > 0 ? (
                    <View style={styles.methodsList}>
                      {employeePaymentMethods.map((method) => (
                        <View key={method.moovPaymentMethodId} style={styles.methodItem}>
                          <View style={styles.methodInfo}>
                            <Text style={styles.methodBrand}>
                              {method.brand || method.methodType}
                              {method.last4 ? ` •••${method.last4}` : ""}
                            </Text>
                            <Text style={styles.methodStatus}>
                              {method.isVerified ? "✓ Verified" : "Not verified"} • {method.status}
                            </Text>
                          </View>
                          {method.isPreferred ? (
                            <View style={styles.preferredBadge}>
                              <Text style={styles.preferredText}>Preferred</Text>
                            </View>
                          ) : (
                            <Pressable onPress={() => handleSetPreferredEmployeeMethod(method.moovPaymentMethodId)}>
                              <Text style={styles.setPreferredLink}>Set preferred</Text>
                            </Pressable>
                          )}
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.emptyText}>No payment methods on file</Text>
                  )}

                  <Pressable
                    style={[styles.actionButton, isOnboarding && styles.actionButtonDisabled]}
                    onPress={handleStartEmployeeOnboarding}
                    disabled={isOnboarding}
                  >
                    <Text style={styles.actionButtonText}>
                      {isOnboarding ? "Opening..." : "Add or Update Payment Method"}
                    </Text>
                  </Pressable>

                  {!employeeConnection?.connected && (
                    <Text style={styles.infoText}>
                      Set up your Moov account to receive instant payouts and manage payment methods.
                    </Text>
                  )}
                </>
              )}
            </View>
          </View>
        )}

        {!isLoadingProfile && isAdminUser && restaurantId ? (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionCardTitle}>Admin Tools</Text>
            <View style={styles.sectionBody}>
              <Pressable style={styles.navRow} onPress={handleOpenBilling}>
                <View style={styles.navText}>
                  <Text style={styles.navTitle}>Billing</Text>
                  <Text style={styles.navSubtitle}>Monthly fee, payment method, and invoices</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
              </Pressable>
            </View>
          </View>
        ) : null}

        <View style={styles.sectionCard}>
          <Text style={styles.sectionCardTitle}>Account Security</Text>
          <View style={styles.sectionBody}>
            <View style={styles.securityItem}>
              <Text style={styles.securityLabel}>Two-Factor Authentication</Text>
              <Text style={styles.securityValue}>Enabled</Text>
            </View>
            <View style={styles.securityItem}>
              <Text style={styles.securityLabel}>Session History</Text>
              <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
            </View>
          </View>
        </View>
      </ScrollView>
    </AppShell>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: "#f4f2ee",
    flexGrow: 1,
  },
  pageHeader: {
    marginBottom: 16,
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: "400",
    color: "#111827",
    fontFamily,
  },
  pageSubtitle: {
    marginTop: 6,
    fontSize: 12,
    color: "#6b7280",
    fontFamily,
  },
  successBanner: {
    marginBottom: 12,
    backgroundColor: "#ecfdf3",
    borderColor: "#bbf7d0",
    borderWidth: 1,
    padding: 12,
    borderRadius: controlRadius,
  },
  errorBanner: {
    marginBottom: 12,
    backgroundColor: "#fef2f2",
    borderColor: "#fecaca",
    borderWidth: 1,
    padding: 12,
    borderRadius: controlRadius,
  },
  bannerText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#111827",
    fontFamily,
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 16,
    borderColor: "#e5e7eb",
    borderWidth: 1,
  },
  loadingText: {
    color: "#6b7280",
    fontFamily,
  },
  profileCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderColor: "#e5e7eb",
    borderWidth: 1,
    overflow: "hidden",
  },
  profileHeader: {
    paddingVertical: 24,
    paddingHorizontal: 16,
    backgroundColor: "#cab99a",
    alignItems: "center",
  },
  avatarCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
  },
  avatarText: {
    fontSize: 28,
    fontWeight: "700",
    color: "#111827",
    fontFamily,
  },
  profileName: {
    fontSize: 20,
    fontWeight: "700",
    color: "#111827",
    fontFamily,
  },
  profileRestaurant: {
    marginTop: 4,
    fontSize: 12,
    color: "#111827",
    fontFamily,
  },
  profileContent: {
    padding: 16,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
    fontFamily,
  },
  editButton: {
    backgroundColor: "#cab99a",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: controlRadius,
  },
  editButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#111827",
    fontFamily,
  },
  editActions: {
    flexDirection: "row",
    gap: 8,
  },
  cancelButton: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: controlRadius,
    backgroundColor: "#ffffff",
  },
  cancelButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#111827",
    fontFamily,
  },
  saveButton: {
    backgroundColor: "#cab99a",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: controlRadius,
  },
  saveButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#111827",
    fontFamily,
  },
  formGrid: {
    flexDirection: "row",
    gap: 12,
  },
  field: {
    marginBottom: 12,
    flex: 1,
  },
  label: {
    fontSize: 12,
    fontWeight: "400",
    color: "#374151",
    marginBottom: 6,
    fontFamily,
  },
  input: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: controlRadius,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: "#111827",
    fontFamily,
  },
  readOnlyField: {
    backgroundColor: "#f9fafb",
    borderRadius: controlRadius,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  readOnlyText: {
    fontSize: 13,
    color: "#111827",
    fontFamily,
  },
  permissionCard: {
    backgroundColor: "#f9fafb",
    borderRadius: controlRadius,
    padding: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  permissionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  permissionItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: controlRadius,
    width: "48%",
  },
  permissionItemActive: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#111827",
  },
  permissionItemInactive: {
    backgroundColor: "#f3f4f6",
    borderWidth: 1,
    borderColor: "transparent",
  },
  permissionCheck: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  permissionCheckActive: {
    backgroundColor: "#cab99a",
  },
  permissionCheckInactive: {
    backgroundColor: "#e5e7eb",
  },
  permissionLabel: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily,
  },
  permissionLabelActive: {
    color: "#111827",
  },
  permissionLabelInactive: {
    color: "#6b7280",
  },
  permissionNote: {
    marginTop: 8,
    fontSize: 10,
    color: "#6b7280",
    fontFamily,
  },
  sectionCard: {
    marginTop: 16,
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    padding: 16,
  },
  sectionCardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 12,
    fontFamily,
  },
  sectionBody: {
    gap: 8,
  },
  navRow: {
    backgroundColor: "#f9fafb",
    borderRadius: controlRadius,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  navText: {
    flex: 1,
    marginRight: 8,
  },
  navTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: "#111827",
    fontFamily,
  },
  navSubtitle: {
    marginTop: 2,
    fontSize: 10,
    color: "#6b7280",
    fontFamily,
  },
  securityItem: {
    backgroundColor: "#f9fafb",
    borderRadius: controlRadius,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  securityLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#111827",
    fontFamily,
  },
  securityValue: {
    fontSize: 11,
    fontWeight: "700",
    color: "#16a34a",
    fontFamily,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  refreshButton: {
    fontSize: 10,
    fontWeight: "600",
    color: "#111827",
    fontFamily,
  },
  refreshButtonDisabled: {
    color: "#d1d5db",
  },
  methodsList: {
    marginBottom: 12,
    gap: 8,
  },
  methodItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#f3f4f6",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  methodInfo: {
    flex: 1,
  },
  methodBrand: {
    fontSize: 13,
    fontWeight: "600",
    color: "#111827",
    fontFamily,
  },
  methodStatus: {
    fontSize: 11,
    color: "#6b7280",
    fontFamily,
    marginTop: 4,
  },
  preferredBadge: {
    backgroundColor: "#dbeafe",
    borderRadius: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  preferredText: {
    fontSize: 10,
    fontWeight: "600",
    color: "#1e40af",
    fontFamily,
  },
  setPreferredLink: {
    fontSize: 10,
    fontWeight: "600",
    color: "#111827",
    fontFamily,
  },
  emptyText: {
    fontSize: 12,
    color: "#6b7280",
    fontFamily,
    marginBottom: 12,
  },
  actionButton: {
    backgroundColor: "#111827",
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 12,
  },
  actionButtonDisabled: {
    opacity: 0.6,
  },
  actionButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#ffffff",
    fontFamily,
  },
  infoText: {
    fontSize: 11,
    color: "#6b7280",
    fontFamily,
    textAlign: "center",
    marginTop: 8,
  },
});

export default ProfileScreen;
