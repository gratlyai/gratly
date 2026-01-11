import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { registerPushTokenIfNeeded } from "../../core/notifications/notifications";
import { useAuth } from "../providers/useAuth";
import AppShell from "../components/AppShell";
import type { SettingsStackParamList } from "../navigation/types";

const SettingsScreen = () => {
  const { session } = useAuth();
  const isSuperAdmin = Boolean(session?.permissions.superadminAccess);
  const isAdminUser = Boolean(session?.permissions.adminAccess || session?.permissions.superadminAccess);
  const navigation = useNavigation<NativeStackNavigationProp<SettingsStackParamList>>();
  const [pushStatus, setPushStatus] = useState<string | null>(null);

  const requestPush = async () => {
    setPushStatus("Requesting permissions...");
    try {
      const token = await registerPushTokenIfNeeded();
      setPushStatus(token ? "Push token registered." : "Push permissions not granted.");
    } catch (error) {
      setPushStatus(error instanceof Error ? error.message : "Failed to register push token.");
    }
  };

  return (
    <AppShell>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Settings</Text>
        {!isSuperAdmin ? (
          <Text style={styles.notice}>Superadmin access required for full settings.</Text>
        ) : null}

        {isAdminUser ? (
          <View style={styles.card}>
            <Pressable style={styles.navRow} onPress={() => navigation.navigate("Billing")}>
              <View style={styles.navText}>
                <Text style={styles.navTitle}>Billing</Text>
                <Text style={styles.navSubtitle}>Monthly fee, payment method, and invoices</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
            </Pressable>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>TODO</Text>
          <Text style={styles.todoItem}>• Restaurant selector + admin users summary</Text>
          <Text style={styles.todoItem}>• Update Restaurant Settings modal + onboarding form</Text>
          <Text style={styles.todoItem}>• Moov billing config (amount, currency)</Text>
          <Text style={styles.todoItem}>• Error/success banners and saving states</Text>
        </View>

        <Pressable style={styles.button} onPress={requestPush}>
          <Text style={styles.buttonText}>Enable Push Notifications</Text>
        </Pressable>
        {pushStatus ? <Text style={styles.statusText}>{pushStatus}</Text> : null}
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
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#111827",
  },
  notice: {
    marginTop: 8,
    color: "#b45309",
  },
  card: {
    marginTop: 16,
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 16,
    borderColor: "#e5e7eb",
    borderWidth: 1,
  },
  navRow: {
    backgroundColor: "#f9fafb",
    borderRadius: 12,
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
    fontSize: 13,
    fontWeight: "600",
    color: "#111827",
  },
  navSubtitle: {
    marginTop: 2,
    fontSize: 11,
    color: "#6b7280",
  },
  sectionTitle: {
    fontSize: 12,
    textTransform: "uppercase",
    color: "#6b7280",
    marginBottom: 12,
    fontWeight: "700",
  },
  todoItem: {
    marginBottom: 8,
    color: "#111827",
  },
  button: {
    marginTop: 20,
    backgroundColor: "#cab99a",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  buttonText: {
    color: "#111827",
    fontWeight: "600",
  },
  statusText: {
    marginTop: 10,
    color: "#6b7280",
  },
});

export default SettingsScreen;
