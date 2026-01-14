import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import AppShell from "../components/AppShell";
import { useSessionScope } from "../hooks/useSessionScope";
import {
  createBillingPaymentMethodLink,
  fetchBillingSummary,
  fetchInvoices,
  type BillingSummary,
  type MonthlyInvoice,
} from "../../core/api/billing";

const fontFamily = Platform.select({ ios: "SF Pro Text", android: "Roboto" }) ?? "System";

const formatDate = (value?: string | null) => {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString();
};

const formatCurrency = (amountCents: number | null | undefined, currency?: string | null) => {
  if (amountCents === null || amountCents === undefined) {
    return "—";
  }
  const normalized = currency ? currency.toUpperCase() : "USD";
  return `${(amountCents / 100).toFixed(2)} ${normalized}`;
};

const formatPaymentMethod = (methods: any[]) => {
  if (!methods || methods.length === 0) {
    return "No payment method on file";
  }
  const method = methods[0];
  const last4 = method.last4 ? `**** ${method.last4}` : "****";
  const label = method.methodType === "bank_account" ? "Bank account" : "Card";
  return `${label} (${method.brand ?? "•"} ${last4})`;
};

const BillingScreen = () => {
  const scope = useSessionScope();
  const restaurantId = scope?.restaurantId ?? null;

  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [invoices, setInvoices] = useState<MonthlyInvoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isUpdatingPayment, setIsUpdatingPayment] = useState(false);

  useEffect(() => {
    if (!restaurantId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    Promise.all([fetchBillingSummary(restaurantId), fetchInvoices(restaurantId)])
      .then(([summaryData, invoiceData]) => {
        setSummary(summaryData);
        setInvoices(invoiceData.invoices ?? []);
      })
      .catch(() => {
        setActionError("Failed to load billing information");
      })
      .finally(() => setIsLoading(false));
  }, [restaurantId]);

  const billingAmount = useMemo(
    () => formatCurrency(summary?.config?.billingAmount ?? null, "USD"),
    [summary?.config?.billingAmount],
  );
  const billingDateLabel = useMemo(() => {
    if (summary?.config?.billingDate) {
      return `Day ${summary.config.billingDate}`;
    }
    return "—";
  }, [summary?.config?.billingDate]);

  const handleUpdatePayment = async () => {
    if (!restaurantId) return;
    setIsUpdatingPayment(true);
    setActionError(null);
    try {
      const returnUrl = "gratly://billing?connected=1";
      const { url } = await createBillingPaymentMethodLink(restaurantId, returnUrl);
      await Linking.openURL(url);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to open payment flow.");
    } finally {
      setIsUpdatingPayment(false);
    }
  };

  return (
    <AppShell>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Billing</Text>
          <Text style={styles.subtitle}>
            View your monthly Gratly fee, payment method, and invoice history.
          </Text>
        </View>

        {actionError ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{actionError}</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Monthly Fee</Text>
          <View style={styles.row}>
            <View style={styles.infoBlock}>
              <Text style={styles.infoLabel}>Amount</Text>
              <Text style={styles.infoValue}>{billingAmount}</Text>
            </View>
            <View style={styles.infoBlock}>
              <Text style={styles.infoLabel}>Billing Date</Text>
              <Text style={styles.infoValue}>{billingDateLabel}</Text>
            </View>
          </View>
          <View style={styles.methodRow}>
            <Text style={styles.infoLabel}>Payment Method</Text>
            <Text style={styles.infoValue}>{formatPaymentMethod(summary?.paymentMethods ?? [])}</Text>
          </View>
          <Pressable
            onPress={handleUpdatePayment}
            disabled={isUpdatingPayment}
            style={[styles.actionButton, isUpdatingPayment && styles.actionButtonDisabled]}
          >
            <Text style={styles.actionButtonText}>
              {isUpdatingPayment ? "Opening..." : "Update Payment Method"}
            </Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Invoice History</Text>
          {isLoading ? (
            <ActivityIndicator size={20} style={{ marginTop: 12 }} />
          ) : invoices.length === 0 ? (
            <Text style={styles.emptyText}>No invoices on file yet.</Text>
          ) : (
            invoices.map((invoice) => (
              <View key={invoice.id} style={styles.invoiceRow}>
                <View>
                  <Text style={styles.invoiceId}>{invoice.moovInvoiceId ?? invoice.billingPeriod}</Text>
                  <Text style={styles.invoiceMeta}>
                    Due {formatDate(invoice.dueDate)} · {invoice.paymentStatus ?? "pending"}
                  </Text>
                </View>
                <Text style={styles.invoiceAmount}>
                  {formatCurrency(invoice.amountCents, invoice.currency)}
                </Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </AppShell>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: "#f4f2ee",
  },
  header: {
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: "400",
    color: "#111827",
    fontFamily,
  },
  subtitle: {
    marginTop: 6,
    fontSize: 12,
    color: "#6b7280",
    fontFamily,
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    padding: 16,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
    fontFamily,
    marginBottom: 12,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  infoBlock: {
    flex: 1,
    backgroundColor: "#f9fafb",
    padding: 12,
    borderRadius: 12,
  },
  infoLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    color: "#6b7280",
    fontFamily,
  },
  infoValue: {
    marginTop: 6,
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
    fontFamily,
  },
  methodRow: {
    marginTop: 12,
  },
  actionButton: {
    marginTop: 16,
    backgroundColor: "#cab99a",
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
  },
  actionButtonDisabled: {
    opacity: 0.6,
  },
  actionButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#111827",
    fontFamily,
  },
  invoiceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "#f3f4f6",
    paddingTop: 12,
    marginTop: 12,
  },
  invoiceId: {
    fontSize: 13,
    fontWeight: "600",
    color: "#111827",
    fontFamily,
  },
  invoiceMeta: {
    fontSize: 11,
    color: "#6b7280",
    fontFamily,
    marginTop: 4,
  },
  invoiceAmount: {
    fontSize: 13,
    fontWeight: "600",
    color: "#111827",
    fontFamily,
  },
  emptyText: {
    fontSize: 12,
    color: "#6b7280",
    fontFamily,
  },
  errorBanner: {
    backgroundColor: "#fef2f2",
    borderColor: "#fecaca",
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  errorText: {
    color: "#b91c1c",
    fontSize: 12,
    fontWeight: "600",
    fontFamily,
  },
});

export default BillingScreen;
