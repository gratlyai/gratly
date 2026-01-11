import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { api } from "../../core/api/client";
import AppShell from "../components/AppShell";
import { fetchPendingPayouts, fetchWeeklyTipsGratuities } from "../../core/api/reports";
import { fetchRecentTransfers } from "../../core/api/payments";
import { useAuth } from "../providers/useAuth";
import { useSessionScope } from "../hooks/useSessionScope";

type WidgetData = {
  netSales: number;
  netSalesChange: number;
  totalTips: number;
  tipsChange: number;
  totalGratuity: number;
  gratuityChange: number;
  pendingPayouts: number;
  recentTransactions: Array<{
    id: string;
    employeeName?: string | null;
    amount: number;
    businessDate?: string | null;
    createdAt?: string | null;
  }>;
  weeklyTipsGratuities: Array<{ day: string; date: string; tips: number; gratuity: number }>;
};

const formatCurrency = (value: number) => {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
};

const formatCurrencyWhole = (value: number) => {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    }).format(value);
  } catch {
    return `$${Math.round(value)}`;
  }
};

const formatPercent = (value: number) => {
  if (!Number.isFinite(value)) {
    return "0%";
  }
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(1)}%`;
};

const IconNetSales = () => (
  <Svg
    width={20}
    height={20}
    viewBox="0 0 24 24"
    fill="none"
    stroke="#374151"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <Rect x={3} y={6} width={18} height={12} rx={2} />
    <Circle cx={12} cy={12} r={3.5} />
    <Path d="M12 9.5v5" />
  </Svg>
);

const IconTips = () => (
  <Svg
    width={20}
    height={20}
    viewBox="0 0 24 24"
    fill="none"
    stroke="#374151"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <Path d="M3 7h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    <Path d="M3 7l9-4 9 4" />
    <Path d="M16 12h2" />
  </Svg>
);

const IconGratuity = () => (
  <Svg
    width={20}
    height={20}
    viewBox="0 0 24 24"
    fill="none"
    stroke="#374151"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <Circle cx={8} cy={9} r={3} />
    <Circle cx={16} cy={9} r={3} />
    <Path d="M3 19c0-3 3-5 5-5" />
    <Path d="M21 19c0-3-3-5-5-5" />
  </Svg>
);

const IconPending = () => (
  <Svg
    width={20}
    height={20}
    viewBox="0 0 24 24"
    fill="none"
    stroke="#374151"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <Circle cx={12} cy={12} r={8} />
    <Path d="M12 8v5l3 3" />
  </Svg>
);

const parseDateParts = (value: string): Date | null => {
  const isoDate = value.split("T")[0]?.split(" ")[0] || value;
  const parts = isoDate.split("-");
  if (parts.length === 3) {
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
      return new Date(year, month - 1, day);
    }
  }
  const fallback = new Date(isoDate);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
};

const formatShortDate = (value: string): string => {
  const parsed = parseDateParts(value);
  if (!parsed) {
    return value.split("T")[0]?.split(" ")[0] || value;
  }
  try {
    return new Intl.DateTimeFormat("en-US", { month: "2-digit", day: "2-digit" }).format(parsed);
  } catch {
    return value.split("T")[0]?.split(" ")[0] || value;
  }
};

const getNiceStep = (value: number): number => {
  if (value <= 10) return 2;
  if (value <= 50) return 5;
  if (value <= 100) return 10;
  if (value <= 250) return 25;
  if (value <= 500) return 50;
  if (value <= 1000) return 100;
  if (value <= 2500) return 250;
  if (value <= 5000) return 500;
  if (value <= 10000) return 1000;
  return 5000;
};

const HomeScreen = () => {
  const { session } = useAuth();
  const scope = useSessionScope();
  const userId = scope?.userId ?? null;
  const restaurantId = scope?.restaurantId ?? null;
  const firstName = session?.userName?.split(/\s+/)[0] ?? "there";
  const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const earnedColor = "#e6d7b8";
  const paidColor = "#cab99a";
  const chartHeight = 180;

  const [widgetData, setWidgetData] = useState<WidgetData>({
    netSales: 0,
    netSalesChange: 0,
    totalTips: 0,
    tipsChange: 0,
    totalGratuity: 0,
    gratuityChange: 0,
    pendingPayouts: 0,
    recentTransactions: [],
    weeklyTipsGratuities: dayLabels.map((day, index) => ({
      day,
      date: `day-${index}`,
      tips: 0,
      gratuity: 0,
    })),
  });

  useEffect(() => {
    if (userId === null || restaurantId === null) {
      return;
    }
    const query = new URLSearchParams({
      user_id: String(userId),
      restaurant_id: String(restaurantId),
    }).toString();
    api
      .get<{
        totalGratuity: number;
        gratuityChange: number;
        totalTips: number;
        tipsChange: number;
        netSales: number;
        netSalesChange: number;
      }>(`/total-gratuity?${query}`)
      .then((data) => {
        setWidgetData((prev) => ({
          ...prev,
          totalGratuity: Number(data?.totalGratuity) || 0,
          gratuityChange: Number(data?.gratuityChange) || 0,
          totalTips: Number(data?.totalTips) || 0,
          tipsChange: Number(data?.tipsChange) || 0,
          netSales: Number(data?.netSales) || 0,
          netSalesChange: Number(data?.netSalesChange) || 0,
        }));
      })
      .catch((error) => {
        console.warn("Failed to load metrics:", error);
      });
  }, [restaurantId, userId]);

  useEffect(() => {
    if (userId === null || restaurantId === null) {
      return;
    }
    fetchPendingPayouts(userId, restaurantId).then((data) => {
      setWidgetData((prev) => ({
        ...prev,
        pendingPayouts: Number(data.pendingPayouts) || 0,
      }));
    });
  }, [restaurantId, userId]);

  useEffect(() => {
    if (userId === null || restaurantId === null) {
      return;
    }
    fetchRecentTransfers(userId)
      .then((data) => {
        const settlements = (data.transfers || []).map((item, index) => ({
          id: item.transferId ? `${item.transferId}-${item.employeeGuid ?? index}` : `transfer-${index}`,
          employeeName: item.employeeName ?? item.employeeGuid ?? null,
          amount: Number(item.amount) || 0,
          businessDate: null,
          createdAt: item.createdAt ?? null,
        }));
        setWidgetData((prev) => ({
          ...prev,
          recentTransactions: settlements,
        }));
      })
      .catch((error) => {
        console.warn("Failed to load recent transfers:", error);
      });
  }, [restaurantId, userId]);

  useEffect(() => {
    if (userId === null || restaurantId === null) {
      return;
    }
    fetchWeeklyTipsGratuities(userId, restaurantId)
      .then((data) => {
        if (!data.days?.length) {
          return;
        }
        const mapped = data.days.map((day, index) => ({
          day: dayLabels[index] ?? "",
          date: day.date,
          tips: day.tips || 0,
          gratuity: day.gratuity || 0,
        }));
        setWidgetData((prev) => ({
          ...prev,
          weeklyTipsGratuities: mapped,
        }));
      })
      .catch((error) => {
        console.warn("Failed to load weekly tips/gratuities:", error);
      });
  }, [restaurantId, userId]);

  const maxRevenue = Math.max(
    ...widgetData.weeklyTipsGratuities.map((entry) => entry.tips + entry.gratuity),
    0,
  );
  const step = getNiceStep(maxRevenue || 10);
  const revenueMax = maxRevenue > 0 ? Math.ceil(maxRevenue / step) * step : step * 5;
  const revenueRange = revenueMax;
  const yAxisTicks = Array.from({ length: 6 }, (_, index) =>
    Math.round((revenueMax / 5) * index),
  );
  const yAxisTicksDescending = [...yAxisTicks].reverse();
  const netSalesDelta = widgetData.netSales - widgetData.netSalesChange;
  const netSalesPercentChange =
    widgetData.netSalesChange === 0 ? 0 : (netSalesDelta / widgetData.netSalesChange) * 100;
  const tipsDelta = widgetData.totalTips - widgetData.tipsChange;
  const tipsPercentChange =
    widgetData.tipsChange === 0 ? 0 : (tipsDelta / widgetData.tipsChange) * 100;
  const gratuityDelta = widgetData.totalGratuity - widgetData.gratuityChange;
  const gratuityPercentChange =
    widgetData.gratuityChange === 0 ? 0 : (gratuityDelta / widgetData.gratuityChange) * 100;

  return (
    <AppShell>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.greeting}>Hi {firstName},</Text>
        <Text style={styles.subtitle}>Here's what happened yesterday.</Text>

        <View style={styles.grid}>
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardLabel}>Net Sales</Text>
              <View style={styles.cardIconBox}>
                <IconNetSales />
              </View>
            </View>
            <Text style={styles.cardValue}>{formatCurrency(widgetData.netSales)}</Text>
            <Text style={styles.cardMeta}>
              <Text style={netSalesPercentChange >= 0 ? styles.positiveText : styles.negativeText}>
                {netSalesPercentChange >= 0 ? "↑ " : "↓ "}
                {Math.abs(netSalesPercentChange).toFixed(1)}%
              </Text>
              <Text style={styles.vsLabel}> vs last week</Text>
            </Text>
          </View>
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardLabel}>Total Tips</Text>
              <View style={styles.cardIconBox}>
                <IconTips />
              </View>
            </View>
            <Text style={styles.cardValue}>{formatCurrency(widgetData.totalTips)}</Text>
            <Text style={styles.cardMeta}>
              <Text style={tipsPercentChange >= 0 ? styles.positiveText : styles.negativeText}>
                {tipsPercentChange >= 0 ? "↑ " : "↓ "}
                {Math.abs(tipsPercentChange).toFixed(1)}%
              </Text>
              <Text style={styles.vsLabel}> vs last week</Text>
            </Text>
          </View>
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardLabel}>Total Gratuity</Text>
              <View style={styles.cardIconBox}>
                <IconGratuity />
              </View>
            </View>
            <Text style={styles.cardValue}>{formatCurrency(widgetData.totalGratuity)}</Text>
            <Text style={styles.cardMeta}>
              <Text style={gratuityPercentChange >= 0 ? styles.positiveText : styles.negativeText}>
                {gratuityPercentChange >= 0 ? "↑ " : "↓ "}
                {Math.abs(gratuityPercentChange).toFixed(1)}%
              </Text>
              <Text style={styles.vsLabel}> vs last week</Text>
            </Text>
          </View>
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardLabel}>Pending Payouts</Text>
              <View style={styles.cardIconBox}>
                <IconPending />
              </View>
            </View>
            <Text style={styles.cardValue}>{formatCurrency(widgetData.pendingPayouts)}</Text>
            <Text style={styles.cardMeta}>Awaiting approval</Text>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>Weekly Tips & Gratuities</Text>
              <Text style={styles.sectionSubtitle}>Last 7 days performance</Text>
            </View>
            <View style={styles.legend}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: earnedColor }]} />
                <Text style={styles.legendText}>Earned</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: paidColor }]} />
                <Text style={styles.legendText}>Paid</Text>
              </View>
            </View>
          </View>

          <View style={styles.chartContainer}>
            <View style={[styles.chartYAxis, { height: chartHeight }]}>
              {yAxisTicksDescending.map((value) => (
                <Text key={`tick-${value}`} style={styles.axisLabel}>
                  {formatCurrencyWhole(value)}
                </Text>
              ))}
            </View>
            <View style={styles.chartPlot}>
              <View style={[styles.chartGrid, { height: chartHeight }]}>
                {yAxisTicks.map((value) => {
                  const normalized = revenueRange ? value / revenueRange : 0;
                  const rawTop = chartHeight - normalized * chartHeight;
                  const top = Math.max(0, Math.min(chartHeight - 1, rawTop));
                  return <View key={`grid-${value}`} style={[styles.chartGridLine, { top }]} />;
                })}
                <View style={styles.chartBars}>
                  {widgetData.weeklyTipsGratuities.map((item) => {
                    const total = item.tips + item.gratuity;
                    const barHeight = revenueRange ? (total / revenueRange) * chartHeight : 0;
                    return (
                      <View key={item.date} style={styles.barWrapper}>
                        <View
                          style={[
                            styles.bar,
                            { height: Math.max(2, barHeight), backgroundColor: earnedColor },
                          ]}
                        />
                      </View>
                    );
                  })}
                </View>
              </View>
              <View style={styles.chartLabels}>
                {widgetData.weeklyTipsGratuities.map((item) => (
                  <View key={`label-${item.date}`} style={styles.chartLabel}>
                    <Text style={styles.chartLabelText}>{formatShortDate(item.date)}</Text>
                    <Text style={styles.chartLabelSub}>{item.day}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Transactions</Text>
          {widgetData.recentTransactions.length === 0 ? (
            <Text style={styles.emptyText}>No recent transactions.</Text>
          ) : (
            widgetData.recentTransactions.map((tx) => (
              <View key={tx.id} style={styles.rowBetween}>
                <View>
                  <Text style={styles.rowLabel}>{tx.employeeName || "Employee"}</Text>
                  <Text style={styles.rowMeta}>{tx.businessDate || tx.createdAt || ""}</Text>
                </View>
                <Text style={styles.rowValue}>{formatCurrency(tx.amount)}</Text>
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
  greeting: {
    fontSize: 24,
    fontWeight: "400",
    color: "#111827",
  },
  subtitle: {
    marginTop: 6,
    color: "#6b7280",
  },
  grid: {
    marginTop: 16,
    gap: 12,
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    paddingVertical: 5,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#e6d7b8",
    alignItems: "center",
    justifyContent: "center",
    transform: [{ translateY: 12 }],
  },
  cardLabel: {
    fontSize: 12,
    textTransform: "uppercase",
    color: "#6b7280",
  },
  cardValue: {
    marginTop: 6,
    fontSize: 20,
    fontWeight: "700",
    color: "#111827",
  },
  cardMeta: {
    marginTop: 4,
    color: "#6b7280",
  },
  positiveText: {
    color: "#16a34a",
  },
  negativeText: {
    color: "#dc2626",
  },
  vsLabel: {
    color: "#111827",
  },
  section: {
    marginTop: 20,
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    color: "#6b7280",
    marginBottom: 12,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: "#6b7280",
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
    gap: 12,
  },
  legend: {
    alignItems: "flex-end",
    gap: 6,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 11,
    color: "#6b7280",
  },
  chartContainer: {
    flexDirection: "row",
    marginTop: 8,
  },
  chartYAxis: {
    width: 52,
    justifyContent: "space-between",
  },
  axisLabel: {
    fontSize: 10,
    color: "#6b7280",
  },
  chartPlot: {
    flex: 1,
  },
  chartGrid: {
    position: "relative",
    justifyContent: "flex-end",
  },
  chartGridLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "#e5e7eb",
  },
  chartBars: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    top: 0,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: 4,
  },
  barWrapper: {
    flex: 1,
    alignItems: "center",
  },
  bar: {
    width: 14,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
  },
  chartLabels: {
    marginTop: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingLeft: 4,
    paddingRight: 4,
  },
  chartLabel: {
    flex: 1,
    alignItems: "center",
  },
  chartLabelText: {
    fontSize: 10,
    color: "#6b7280",
  },
  chartLabelSub: {
    fontSize: 9,
    color: "#9ca3af",
  },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
  },
  rowLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
  },
  rowMeta: {
    fontSize: 12,
    color: "#6b7280",
  },
  rowValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
  },
  emptyText: {
    color: "#6b7280",
  },
});

export default HomeScreen;
