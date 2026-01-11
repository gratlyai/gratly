import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { fetchEmployees, sendTeamInvite, type Employee } from "../../core/api/employees";
import AppShell from "../components/AppShell";
import { useSessionScope } from "../hooks/useSessionScope";

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
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
};

const TeamScreen = () => {
  const navigation = useNavigation();
  const scope = useSessionScope();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAllEmployees, setShowAllEmployees] = useState(false);
  const [pendingInvites, setPendingInvites] = useState<Record<string, boolean>>({});
  const [inviteSending, setInviteSending] = useState<Record<string, boolean>>({});
  const [inviteErrors, setInviteErrors] = useState<Record<string, string>>({});

  const restaurantId = scope?.restaurantId ?? null;
  const userId = scope?.userId ?? null;

  const isInactive = (status: string) => status.trim().toLowerCase() === "inactive";
  const activeEmployees = employees.filter((employee) => !isInactive(employee.is_active));
  const visibleEmployees = showAllEmployees ? employees : activeEmployees;

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    if (restaurantId === null || userId === null) {
      setEmployees([]);
      setIsLoading(false);
      return () => {
        isMounted = false;
      };
    }
    fetchEmployees({ restaurantId, userId })
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
    if (!employee.email || userId === null) {
      setInviteErrors((current) => ({
        ...current,
        [key]: "Missing user context or email.",
      }));
      return;
    }
    setInviteSending((current) => ({ ...current, [key]: true }));
    setInviteErrors((current) => ({ ...current, [key]: "" }));
    try {
      await sendTeamInvite({
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
    <AppShell>
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>Team</Text>
            <Text style={styles.subtitle}>Roster and contact details for your employees.</Text>
          </View>
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Show all</Text>
            <Switch value={showAllEmployees} onValueChange={setShowAllEmployees} />
          </View>
        </View>

        {isLoading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size={20} />
            <Text style={styles.loadingText}>Loading team members...</Text>
          </View>
        ) : (
          <FlatList
            data={visibleEmployees}
            keyExtractor={(item, index) => `${getEmployeeKey(item, index)}-${index}`}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <Text style={styles.emptyText}>
                {showAllEmployees ? "No employees found." : "No active employees found."}
              </Text>
            }
            renderItem={({ item, index }) => {
              const employeeKey = getEmployeeKey(item, index);
              const inactive = isInactive(item.is_active);
              const hasGratlyAccount = Boolean(item.userId);
              const isAwaiting = Boolean(pendingInvites[employeeKey]);
              const gratlyStatus = hasGratlyAccount
                ? "Active"
                : isAwaiting
                ? "Awaiting"
                : "Inactive";
              const inviteError = inviteErrors[employeeKey];
              const canInvite = Boolean(item.email);
              const isSendingInvite = Boolean(inviteSending[employeeKey]);

              return (
                <Pressable
                  style={styles.employeeCard}
                  onPress={() => {
                    if (item.employeeGuid) {
                      navigation.navigate(
                        "EmployeeProfile" as never,
                        { employeeGuid: item.employeeGuid } as never,
                      );
                    }
                  }}
                >
                  <View style={styles.employeeHeader}>
                    <Text style={styles.employeeName}>
                      {formatValue(item.firstName)} {formatValue(item.lastName)}
                    </Text>
                    <Text style={[styles.badge, inactive ? styles.badgeInactive : styles.badgeActive]}>
                      {item.is_active}
                    </Text>
                  </View>
                  <Text style={styles.employeeDetail}>Phone: {formatPhoneNumber(item.phoneNumber)}</Text>
                  <Text style={styles.employeeDetail}>Email: {formatValue(item.email)}</Text>
                  <View style={styles.statusRow}>
                    <Text style={styles.statusLabel}>Gratly:</Text>
                    <Text
                      style={[
                        styles.badge,
                        hasGratlyAccount
                          ? styles.badgeActive
                          : isAwaiting
                          ? styles.badgePending
                          : styles.badgeInactive,
                      ]}
                    >
                      {gratlyStatus}
                    </Text>
                    {!hasGratlyAccount && !isAwaiting ? (
                      <Pressable
                        style={[styles.inviteButton, !canInvite && styles.buttonDisabled]}
                        onPress={() => sendInvite(item, employeeKey)}
                        disabled={!canInvite || isSendingInvite}
                      >
                        <Text style={styles.inviteButtonText}>
                          {isSendingInvite ? "Sending..." : "Send Invite"}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                  {inviteError ? <Text style={styles.errorText}>{inviteError}</Text> : null}
                </Pressable>
              );
            }}
          />
        )}
      </View>
    </AppShell>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: "#f4f2ee",
  },
  headerRow: {
    marginBottom: 16,
    gap: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#111827",
  },
  subtitle: {
    marginTop: 4,
    color: "#6b7280",
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  toggleLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#4b5563",
  },
  loadingBox: {
    backgroundColor: "#ffffff",
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    alignItems: "center",
    gap: 8,
  },
  loadingText: {
    color: "#6b7280",
  },
  list: {
    gap: 12,
    paddingBottom: 20,
  },
  employeeCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  employeeHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
    gap: 8,
  },
  employeeName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
  },
  employeeDetail: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 4,
  },
  statusRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  statusLabel: {
    fontSize: 12,
    color: "#6b7280",
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 12,
    overflow: "hidden",
  },
  badgeActive: {
    backgroundColor: "#d1fae5",
    color: "#065f46",
  },
  badgeInactive: {
    backgroundColor: "#fee2e2",
    color: "#991b1b",
  },
  badgePending: {
    backgroundColor: "#fef3c7",
    color: "#92400e",
  },
  inviteButton: {
    backgroundColor: "#f3f4f6",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  inviteButtonText: {
    fontSize: 12,
    color: "#374151",
    fontWeight: "600",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  emptyText: {
    textAlign: "center",
    color: "#6b7280",
    marginTop: 24,
  },
  errorText: {
    marginTop: 8,
    color: "#b91c1c",
    fontSize: 12,
  },
});

export default TeamScreen;
