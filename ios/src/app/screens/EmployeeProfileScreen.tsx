import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { TeamStackParamList } from "../navigation/types";
import { fetchEmployee, type Employee } from "../../core/api/employees";
import {
  fetchPermissionCatalog,
  fetchUserPermissions,
  updateUserPermissions,
} from "../../core/api/permissions";
import {
  defaultEmployeePermissions,
  permissionConfig,
  type PermissionDescriptor,
  type PermissionState,
  getStoredPermissions,
  setStoredPermissions,
} from "../../core/auth/permissions";
import { useAuth } from "../providers/useAuth";
import AppShell from "../components/AppShell";

const formatValue = (value: string | null | undefined) => {
  if (!value) {
    return "N/A";
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "N/A";
};

type EmployeeRoute = RouteProp<TeamStackParamList, "EmployeeProfile">;

const EmployeeProfileScreen = () => {
  const navigation = useNavigation();
  const route = useRoute<EmployeeRoute>();
  const { session } = useAuth();
  const { employeeGuid } = route.params;
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [permissions, setPermissions] = useState<PermissionState>(defaultEmployeePermissions);
  const [permissionCatalog, setPermissionCatalog] = useState<PermissionDescriptor[]>(permissionConfig);
  const [isSavingPermissions, setIsSavingPermissions] = useState(false);

  const storageKey = useMemo(() => {
    const userId = employee?.userId;
    if (userId) {
      return String(userId);
    }
    return employeeGuid;
  }, [employee?.userId, employeeGuid]);

  useEffect(() => {
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
    if (!storageKey) {
      return;
    }
    if (employee?.userId) {
      fetchUserPermissions(employee.userId)
        .then(async (data) => {
          const merged = { ...defaultEmployeePermissions, ...data };
          setPermissions(merged);
          await setStoredPermissions(String(employee.userId), merged);
        })
        .catch(async () => {
          const cached = await getStoredPermissions(storageKey);
          setPermissions(cached);
        });
      return;
    }
    void getStoredPermissions(storageKey).then((cached) => {
      setPermissions(cached);
    });
  }, [employee?.userId, storageKey]);

  const handlePermissionChange = async (
    permissionKey: keyof PermissionState,
    checked: boolean,
  ) => {
    const nextPermissions = { ...permissions, [permissionKey]: checked };
    const previousPermissions = permissions;
    setPermissions(nextPermissions);
    if (!employee?.userId) {
      await setStoredPermissions(storageKey, nextPermissions);
      return;
    }
    const actorUserId = Number(session?.userId);
    setIsSavingPermissions(true);
    try {
      const updated = await updateUserPermissions(
        employee.userId,
        nextPermissions,
        Number.isFinite(actorUserId) ? actorUserId : undefined,
      );
      const merged = { ...defaultEmployeePermissions, ...updated };
      setPermissions(merged);
      await setStoredPermissions(String(employee.userId), merged);
    } catch (error) {
      console.warn("Failed to update permissions:", error);
      setPermissions(previousPermissions);
    } finally {
      setIsSavingPermissions(false);
    }
  };

  return (
    <AppShell>
      <ScrollView contentContainerStyle={styles.container}>
        <Pressable style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>Back to team</Text>
        </Pressable>

        {isLoading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size={20} />
            <Text style={styles.loadingText}>Loading employee profile...</Text>
          </View>
        ) : !employee ? (
          <View style={styles.loadingBox}>
            <Text style={styles.loadingText}>Employee not found.</Text>
          </View>
        ) : (
          <View style={styles.card}>
            <View style={styles.headerRow}>
              <View>
                <Text style={styles.title}>
                  {formatValue(employee.firstName)} {formatValue(employee.lastName)}
                </Text>
                <Text style={styles.subtitle}>Manage employee details and permissions.</Text>
              </View>
              <Text style={styles.statusBadge}>{employee.is_active}</Text>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Employee Info</Text>
              <Text style={styles.detail}>First name: {formatValue(employee.firstName)}</Text>
              <Text style={styles.detail}>Last name: {formatValue(employee.lastName)}</Text>
              <Text style={styles.detail}>Email: {formatValue(employee.email)}</Text>
              <Text style={styles.detail}>Phone: {formatValue(employee.phoneNumber)}</Text>
              <Text style={styles.detail}>Employee ID: {formatValue(employee.employeeGuid)}</Text>
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Permissions</Text>
                {isSavingPermissions ? <Text style={styles.savingText}>Saving...</Text> : null}
              </View>
              {permissionCatalog.map((permission) => (
                <View key={permission.key} style={styles.permissionRow}>
                  <Text style={styles.permissionLabel}>{permission.label}</Text>
                  <Switch
                    value={permissions[permission.key]}
                    onValueChange={(checked) => handlePermissionChange(permission.key, checked)}
                  />
                </View>
              ))}
            </View>
          </View>
        )}
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
  backButton: {
    marginBottom: 12,
  },
  backButtonText: {
    color: "#6b7280",
    fontWeight: "600",
  },
  loadingBox: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    alignItems: "center",
    gap: 8,
  },
  loadingText: {
    color: "#6b7280",
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
    gap: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: "#111827",
  },
  subtitle: {
    marginTop: 4,
    color: "#6b7280",
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#f3f4f6",
    color: "#374151",
    fontSize: 12,
    overflow: "hidden",
  },
  section: {
    marginTop: 16,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#111827",
  },
  detail: {
    marginTop: 6,
    color: "#6b7280",
  },
  permissionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
  },
  permissionLabel: {
    color: "#111827",
    flex: 1,
    paddingRight: 12,
  },
  savingText: {
    color: "#6b7280",
    fontSize: 12,
  },
});

export default EmployeeProfileScreen;
