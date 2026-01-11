import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
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
  fetchRestaurantConnection,
  fetchRestaurantPaymentMethods,
  refreshEmployeePaymentMethods,
  refreshRestaurantPaymentMethods,
  setEmployeePreferredPaymentMethod,
  setRestaurantPreferredPaymentMethod,
  startEmployeeOnboarding,
  startRestaurantOnboarding,
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
  const [moovRestaurantConnection, setMoovRestaurantConnection] =
    useState<MoovConnection | null>(null);
  const [moovEmployeeConnection, setMoovEmployeeConnection] =
    useState<MoovConnection | null>(null);
  const [moovRestaurantMethods, setMoovRestaurantMethods] = useState<MoovPaymentMethod[]>([]);
  const [moovEmployeeMethods, setMoovEmployeeMethods] = useState<MoovPaymentMethod[]>([]);
  const [moovRestaurantError, setMoovRestaurantError] = useState("");
  const [moovEmployeeError, setMoovEmployeeError] = useState("");
  const [isConnectingRestaurant, setIsConnectingRestaurant] = useState(false);
  const [isConnectingEmployee, setIsConnectingEmployee] = useState(false);
  const [isSyncingRestaurant, setIsSyncingRestaurant] = useState(false);
  const [isSyncingEmployee, setIsSyncingEmployee] = useState(false);

  const isAdminUser = Boolean(session?.permissions?.adminAccess || session?.permissions?.superadminAccess);
  const initials =
    [profile.firstName, profile.lastName]
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => value[0]?.toUpperCase())
      .slice(0, 2)
      .join("") || "U";

  const formatMoovMethod = (method: MoovPaymentMethod) => {
    const last4 = method.last4 ? `**** ${method.last4}` : "****";
    const label = method.methodType === "bank_account" ? "Bank account" : "Card";
    const brand = method.brand ? `${method.brand} ` : "";
    return `${label} (${brand}${last4})`;
  };

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
    if (!restaurantId || !isAdminUser) {
      return;
    }
    let isMounted = true;
    fetchRestaurantConnection(restaurantId)
      .then((data) => {
        if (isMounted) {
          setMoovRestaurantConnection(data);
        }
      })
      .catch((error) => {
        if (isMounted) {
          setMoovRestaurantError(error instanceof Error ? error.message : "Failed to load Moov connection.");
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
          setMoovEmployeeConnection(data);
        }
      })
      .catch((error) => {
        if (isMounted) {
          setMoovEmployeeError(error instanceof Error ? error.message : "Failed to load Moov connection.");
        }
      });
    return () => {
      isMounted = false;
    };
  }, [userId]);

  useEffect(() => {
    if (!moovRestaurantConnection?.connected || !restaurantId) {
      return;
    }
    fetchRestaurantPaymentMethods(restaurantId)
      .then((data) => setMoovRestaurantMethods(data.methods ?? []))
      .catch(() => setMoovRestaurantMethods([]));
  }, [moovRestaurantConnection, restaurantId]);

  useEffect(() => {
    if (!moovEmployeeConnection?.connected || !userId) {
      return;
    }
    fetchEmployeePaymentMethods(userId)
      .then((data) => setMoovEmployeeMethods(data.methods ?? []))
      .catch(() => setMoovEmployeeMethods([]));
  }, [moovEmployeeConnection, userId]);

  useEffect(() => {
    if (!showSavedToast) {
      return;
    }
    const timeoutId = setTimeout(() => setShowSavedToast(false), 1500);
    return () => clearTimeout(timeoutId);
  }, [showSavedToast]);

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

  const openExternalUrl = async (url: string, onError: (message: string) => void) => {
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) {
        onError("Unable to open Moov. Please try again.");
        return;
      }
      await Linking.openURL(url);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Unable to open Moov.");
    }
  };

  const handleRestaurantConnect = async () => {
    if (!restaurantId || !userId) {
      setMoovRestaurantError("Missing restaurant or user ID. Please log in again.");
      return;
    }
    setIsConnectingRestaurant(true);
    setMoovRestaurantError("");
    try {
      const returnUrl = "gratly://profile?connected=1&type=restaurant";
      const response = await startRestaurantOnboarding(restaurantId, returnUrl);
      await openExternalUrl(response.redirectUrl, setMoovRestaurantError);
    } catch (error) {
      setMoovRestaurantError(error instanceof Error ? error.message : "Unable to start Moov connect.");
    } finally {
      setIsConnectingRestaurant(false);
    }
  };

  const handleEmployeeConnect = async () => {
    if (!userId) {
      setMoovEmployeeError("Missing user ID. Please log in again.");
      return;
    }
    setIsConnectingEmployee(true);
    setMoovEmployeeError("");
    try {
      const returnUrl = "gratly://profile?connected=1&type=employee";
      const response = await startEmployeeOnboarding(userId, returnUrl);
      await openExternalUrl(response.redirectUrl, setMoovEmployeeError);
    } catch (error) {
      setMoovEmployeeError(error instanceof Error ? error.message : "Unable to start Moov connect.");
    } finally {
      setIsConnectingEmployee(false);
    }
  };

  const handleRestaurantSync = async () => {
    if (!restaurantId) {
      return;
    }
    setIsSyncingRestaurant(true);
    setMoovRestaurantError("");
    try {
      const response = await refreshRestaurantPaymentMethods(restaurantId);
      setMoovRestaurantMethods(response.methods ?? []);
    } catch (error) {
      setMoovRestaurantError(error instanceof Error ? error.message : "Unable to sync payout methods.");
    } finally {
      setIsSyncingRestaurant(false);
    }
  };

  const handleEmployeeSync = async () => {
    if (!userId) {
      return;
    }
    setIsSyncingEmployee(true);
    setMoovEmployeeError("");
    try {
      const response = await refreshEmployeePaymentMethods(userId);
      setMoovEmployeeMethods(response.methods ?? []);
    } catch (error) {
      setMoovEmployeeError(error instanceof Error ? error.message : "Unable to sync payout methods.");
    } finally {
      setIsSyncingEmployee(false);
    }
  };

  const handleRestaurantPreferred = async (methodId: string) => {
    if (!restaurantId) {
      return;
    }
    try {
      await setRestaurantPreferredPaymentMethod(restaurantId, methodId);
      setMoovRestaurantMethods((methods) =>
        methods.map((method) => ({ ...method, isPreferred: method.id === methodId })),
      );
    } catch (error) {
      setMoovRestaurantError(error instanceof Error ? error.message : "Unable to update preferred method.");
    }
  };

  const handleEmployeePreferred = async (methodId: string) => {
    if (!userId) {
      return;
    }
    try {
      await setEmployeePreferredPaymentMethod(userId, methodId);
      setMoovEmployeeMethods((methods) =>
        methods.map((method) => ({ ...method, isPreferred: method.id === methodId })),
      );
    } catch (error) {
      setMoovEmployeeError(error instanceof Error ? error.message : "Unable to update preferred method.");
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

        {!isLoadingProfile && isAdminUser && restaurantId ? (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionCardTitle}>Moov Business Payouts</Text>
            <View style={styles.sectionBody}>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Connection status</Text>
                <Text
                  style={[
                    styles.infoValue,
                    moovRestaurantConnection?.connected ? styles.statusConnected : styles.statusMuted,
                  ]}
                >
                  {moovRestaurantConnection?.connected ? "Connected" : "Not connected"}
                </Text>
              </View>
              {moovRestaurantConnection?.connected ? (
                <View style={styles.statusDetails}>
                  <Text style={styles.statusDetailText}>
                    Onboarding status: {moovRestaurantConnection.onboardingStatus ?? "pending_review"}
                  </Text>
                  <Text style={styles.statusDetailText}>
                    Account status: {moovRestaurantConnection.status ?? "N/A"}
                  </Text>
                  {moovRestaurantConnection.moovAccountId ? (
                    <Text style={styles.statusDetailText}>
                      Moov account ID: {moovRestaurantConnection.moovAccountId}
                    </Text>
                  ) : null}
                </View>
              ) : null}
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Connect Moov to receive payouts</Text>
                <Pressable
                  onPress={handleRestaurantConnect}
                  disabled={isConnectingRestaurant}
                  style={styles.linkButton}
                >
                  <Text style={styles.linkButtonText}>
                    {isConnectingRestaurant ? "Starting..." : "Connect to Moov"}
                  </Text>
                </Pressable>
              </View>
              {moovRestaurantConnection?.connected ? (
                <View style={styles.methodsCard}>
                  <View style={styles.methodsHeader}>
                    <Text style={styles.methodsTitle}>Payout methods</Text>
                    <View style={styles.methodsActions}>
                      <Pressable
                        onPress={handleRestaurantSync}
                        disabled={isSyncingRestaurant}
                        style={styles.linkButton}
                      >
                        <Text style={styles.linkButtonText}>
                          {isSyncingRestaurant ? "Syncing..." : "Sync"}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                  {moovRestaurantMethods.length ? (
                    <View style={styles.methodList}>
                      {moovRestaurantMethods.map((method) => (
                        <View key={method.id} style={styles.methodItem}>
                          <View style={styles.methodInfo}>
                            <Text style={styles.methodLabel}>{formatMoovMethod(method)}</Text>
                            <Text style={styles.methodSubLabel}>
                              Status: {method.status ?? "active"}
                            </Text>
                          </View>
                          {method.isPreferred ? (
                            <View style={styles.preferredPill}>
                              <Text style={styles.preferredText}>Preferred</Text>
                            </View>
                          ) : (
                            <Pressable
                              onPress={() => handleRestaurantPreferred(method.id)}
                              style={styles.linkButton}
                            >
                              <Text style={styles.linkButtonText}>Set preferred</Text>
                            </Pressable>
                          )}
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.emptyText}>No payment methods found yet.</Text>
                  )}
                </View>
              ) : null}
              {moovRestaurantError ? (
                <Text style={styles.errorText}>{moovRestaurantError}</Text>
              ) : null}
            </View>
          </View>
        ) : null}

        {!isLoadingProfile && userId && !isAdminUser ? (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionCardTitle}>Moov Employee Payouts</Text>
            <View style={styles.sectionBody}>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Connection status</Text>
                <Text
                  style={[
                    styles.infoValue,
                    moovEmployeeConnection?.connected ? styles.statusConnected : styles.statusMuted,
                  ]}
                >
                  {moovEmployeeConnection?.connected ? "Connected" : "Not connected"}
                </Text>
              </View>
              {moovEmployeeConnection?.connected ? (
                <View style={styles.statusDetails}>
                  <Text style={styles.statusDetailText}>
                    Onboarding status: {moovEmployeeConnection.onboardingStatus ?? "pending_review"}
                  </Text>
                  <Text style={styles.statusDetailText}>
                    Account status: {moovEmployeeConnection.status ?? "N/A"}
                  </Text>
                  {moovEmployeeConnection.moovAccountId ? (
                    <Text style={styles.statusDetailText}>
                      Moov account ID: {moovEmployeeConnection.moovAccountId}
                    </Text>
                  ) : null}
                </View>
              ) : null}
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Connect Moov to receive payouts</Text>
                <Pressable
                  onPress={handleEmployeeConnect}
                  disabled={isConnectingEmployee}
                  style={styles.linkButton}
                >
                  <Text style={styles.linkButtonText}>
                    {isConnectingEmployee ? "Starting..." : "Connect to Moov"}
                  </Text>
                </Pressable>
              </View>
              {moovEmployeeConnection?.connected ? (
                <View style={styles.methodsCard}>
                  <View style={styles.methodsHeader}>
                    <Text style={styles.methodsTitle}>Payout methods</Text>
                    <View style={styles.methodsActions}>
                      <Pressable
                        onPress={handleEmployeeSync}
                        disabled={isSyncingEmployee}
                        style={styles.linkButton}
                      >
                        <Text style={styles.linkButtonText}>
                          {isSyncingEmployee ? "Syncing..." : "Sync"}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                  {moovEmployeeMethods.length ? (
                    <View style={styles.methodList}>
                      {moovEmployeeMethods.map((method) => (
                        <View key={method.id} style={styles.methodItem}>
                          <View style={styles.methodInfo}>
                            <Text style={styles.methodLabel}>{formatMoovMethod(method)}</Text>
                            <Text style={styles.methodSubLabel}>
                              Status: {method.status ?? "active"}
                            </Text>
                          </View>
                          {method.isPreferred ? (
                            <View style={styles.preferredPill}>
                              <Text style={styles.preferredText}>Preferred</Text>
                            </View>
                          ) : (
                            <Pressable
                              onPress={() => handleEmployeePreferred(method.id)}
                              style={styles.linkButton}
                            >
                              <Text style={styles.linkButtonText}>Set preferred</Text>
                            </Pressable>
                          )}
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.emptyText}>No payment methods found yet.</Text>
                  )}
                </View>
              ) : null}
              {moovEmployeeError ? (
                <Text style={styles.errorText}>{moovEmployeeError}</Text>
              ) : null}
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
  infoRow: {
    backgroundColor: "#f9fafb",
    borderRadius: controlRadius,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  infoLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#111827",
    fontFamily,
  },
  infoValue: {
    fontSize: 11,
    fontWeight: "700",
    fontFamily,
  },
  statusConnected: {
    color: "#16a34a",
  },
  statusMuted: {
    color: "#6b7280",
  },
  statusDetails: {
    backgroundColor: "#f9fafb",
    borderRadius: controlRadius,
    padding: 12,
    gap: 4,
  },
  statusDetailText: {
    fontSize: 11,
    color: "#6b7280",
    fontFamily,
  },
  linkButton: {
    paddingHorizontal: 6,
  },
  linkButtonText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#111827",
    fontFamily,
  },
  methodsCard: {
    backgroundColor: "#f9fafb",
    borderRadius: controlRadius,
    padding: 12,
    gap: 8,
  },
  methodsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  methodsTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#111827",
    fontFamily,
  },
  methodsActions: {
    flexDirection: "row",
    gap: 8,
  },
  methodList: {
    gap: 8,
  },
  methodItem: {
    backgroundColor: "#ffffff",
    borderRadius: controlRadius,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  methodInfo: {
    flex: 1,
    marginRight: 8,
  },
  methodLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#111827",
    fontFamily,
  },
  methodSubLabel: {
    fontSize: 10,
    color: "#6b7280",
    fontFamily,
  },
  preferredPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: "#dcfce7",
  },
  preferredText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#15803d",
    fontFamily,
  },
  emptyText: {
    fontSize: 11,
    color: "#6b7280",
    fontFamily,
  },
  errorText: {
    fontSize: 11,
    color: "#dc2626",
    fontWeight: "600",
    fontFamily,
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
});

export default ProfileScreen;
