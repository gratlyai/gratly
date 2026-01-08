import React, { useState, useEffect } from 'react';
import { api } from './api/client';
import { fetchRecentSettlements } from './api/payments';
import { fetchPendingPayouts, fetchWeeklyTipsGratuities } from './api/reports';
import iconNetSales from './assets/icon-net-sales.svg';

interface WidgetData {
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
}

const IconTips = () => (
  <svg
    className="h-5 w-5 text-gray-700"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M3 7h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    <path d="M3 7l9-4 9 4" />
    <path d="M16 12h2" />
  </svg>
);

const IconGratuity = () => (
  <svg
    className="h-5 w-5 text-gray-700"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="8" cy="9" r="3" />
    <circle cx="16" cy="9" r="3" />
    <path d="M3 19c0-3 3-5 5-5" />
    <path d="M21 19c0-3-3-5-5-5" />
  </svg>
);

const IconPending = () => (
  <svg
    className="h-5 w-5 text-gray-700"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="8" />
    <path d="M12 8v5l3 3" />
  </svg>
);

const IconRevenue = () => (
  <svg
    className="h-5 w-5 text-gray-700"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 19h16" />
    <rect x="6" y="10" width="3" height="6" rx="1" />
    <rect x="11" y="7" width="3" height="9" rx="1" />
    <rect x="16" y="12" width="3" height="4" rx="1" />
  </svg>
);

const IconTransactions = () => (
  <svg
    className="h-5 w-5 text-gray-700"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M8 6h13" />
    <path d="M8 12h13" />
    <path d="M8 18h13" />
    <circle cx="4" cy="6" r="1" />
    <circle cx="4" cy="12" r="1" />
    <circle cx="4" cy="18" r="1" />
  </svg>
);

const IconInfo = ({ label }: { label: string }) => (
  <span className="relative inline-flex items-center group" aria-label={label}>
    <svg
      className="h-4 w-4 text-gray-500"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10v6" />
      <path d="M12 7.5h.01" />
    </svg>
    <span className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 w-56 -translate-x-1/2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
      {label}
    </span>
  </span>
);

const GratlyHomeDashboard: React.FC = () => {
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const storedUserName = localStorage.getItem('userName') || '';
  const firstName = storedUserName.trim().split(/\s+/)[0] || 'there';

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
    const fetchWidgetData = async () => {
      try {
        const storedUserId = localStorage.getItem('userId');
        const query = storedUserId ? `?user_id=${encodeURIComponent(storedUserId)}` : '';
        const data = await api.get<{
          totalGratuity: number;
          gratuityChange: number;
          totalTips: number;
          tipsChange: number;
          netSales: number;
          netSalesChange: number;
        }>(`/total-gratuity${query}`);
        const totalGratuity = Number(data?.totalGratuity);
        const gratuityChange = Number(data?.gratuityChange);
        const totalTips = Number(data?.totalTips);
        const tipsChange = Number(data?.tipsChange);
        const netSales = Number(data?.netSales);
        const netSalesChange = Number(data?.netSalesChange);
        setWidgetData((prev) => ({
          ...prev,
          totalGratuity: Number.isFinite(totalGratuity) ? totalGratuity : prev.totalGratuity,
          gratuityChange: Number.isFinite(gratuityChange) ? gratuityChange : prev.gratuityChange,
          totalTips: Number.isFinite(totalTips) ? totalTips : prev.totalTips,
          tipsChange: Number.isFinite(tipsChange) ? tipsChange : prev.tipsChange,
          netSales: Number.isFinite(netSales) ? netSales : prev.netSales,
          netSalesChange: Number.isFinite(netSalesChange) ? netSalesChange : prev.netSalesChange,
        }));
      } catch (error) {
        console.error('Failed to load tips/gratuity metrics:', error);
      }
    };

    fetchWidgetData();
  }, []);

  useEffect(() => {
    const storedUserId = localStorage.getItem('userId');
    if (!storedUserId) {
      return;
    }
    const userId = Number(storedUserId);
    if (!Number.isFinite(userId)) {
      return;
    }
    fetchPendingPayouts(userId).then((data) => {
      setWidgetData((prev) => ({
        ...prev,
        pendingPayouts: Number(data.pendingPayouts) || 0,
      }));
    });
  }, []);

  useEffect(() => {
    const storedUserId = localStorage.getItem('userId');
    if (!storedUserId) {
      setWidgetData((prev) => ({
        ...prev,
        recentTransactions: [],
      }));
      return;
    }
    const userId = Number(storedUserId);
    if (!Number.isFinite(userId)) {
      return;
    }
    fetchRecentSettlements(userId)
      .then((data) => {
        const settlements = (data.settlements || []).map((item, index) => ({
          id: item.settlementId
            ? `${item.settlementId}-${item.employeeGuid ?? index}`
            : `settlement-${index}`,
          employeeName: item.employeeName ?? null,
          amount: Number(item.amount) || 0,
          businessDate: item.businessDate ?? null,
          createdAt: item.createdAt ?? null,
        }));
        setWidgetData((prev) => ({
          ...prev,
          recentTransactions: settlements,
        }));
      })
      .catch((error) => {
        console.warn('Failed to load recent settlements:', error);
      });
  }, []);

  useEffect(() => {
    const storedUserId = localStorage.getItem('userId');
    if (!storedUserId) {
      return;
    }
    const userId = Number(storedUserId);
    if (!Number.isFinite(userId)) {
      return;
    }
    fetchWeeklyTipsGratuities(userId)
      .then((data) => {
        if (!Array.isArray(data.days) || data.days.length === 0) {
          return;
        }
        const formatted = data.days.map((entry) => {
          const dateValue = parseDateParts(entry.date);
          const dayLabel =
            !dateValue
              ? dayLabels[0]
              : dayLabels[(dateValue.getDay() + 6) % 7];
          return {
            day: dayLabel,
            date: entry.date,
            tips: Number(entry.tips) || 0,
            gratuity: Number(entry.gratuity) || 0,
          };
        });
        setWidgetData((prev) => ({
          ...prev,
          weeklyTipsGratuities: formatted,
        }));
      })
      .catch((error) => {
        console.warn('Failed to load weekly tips/gratuities:', error);
      });
  }, []);

  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const formatSettlementDate = (value: string | null | undefined): string => {
    if (!value) {
      return 'Unknown date';
    }
    const isoDate = value.split('T')[0]?.split(' ')[0] || value;
    return isoDate;
  };

  const parseDateParts = (value: string): Date | null => {
    const isoDate = value.split('T')[0]?.split(' ')[0] || value;
    const parts = isoDate.split('-');
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
      return value.split('T')[0]?.split(' ')[0] || value;
    }
    return new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit' }).format(parsed);
  };

  const getChangeColor = (change: number): string => {
    return change >= 0 ? 'text-green-600' : 'text-red-600';
  };

  const getChangeIcon = (change: number): string => {
    return change >= 0 ? '↑' : '↓';
  };

  const earnedColor = '#e6d7b8';
  const paidColor = '#cab99a';
  const maxRevenue = Math.max(
    ...widgetData.weeklyTipsGratuities.map((d) => d.tips + d.gratuity),
    0,
  );
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
  const step = getNiceStep(maxRevenue || 10);
  const revenueMax = maxRevenue > 0 ? Math.ceil(maxRevenue / step) * step : step * 5;
  const revenueMin = 0;
  const revenueRange = revenueMax - revenueMin;
  const yAxisTicks = Array.from({ length: 6 }, (_, index) =>
    Math.round((revenueMax / 5) * index)
  );
  const tipsDelta = widgetData.totalTips - widgetData.tipsChange;
  const tipsPercentChange =
    widgetData.tipsChange === 0 ? 0 : (tipsDelta / widgetData.tipsChange) * 100;
  const gratuityDelta = widgetData.totalGratuity - widgetData.gratuityChange;
  const gratuityPercentChange =
    widgetData.gratuityChange === 0 ? 0 : (gratuityDelta / widgetData.gratuityChange) * 100;
  const netSalesDelta = widgetData.netSales - widgetData.netSalesChange;
  const netSalesPercentChange =
    widgetData.netSalesChange === 0 ? 0 : (netSalesDelta / widgetData.netSalesChange) * 100;

  return (
    <div className="p-8">
      <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Dashboard Overview</h1>
          <p className="text-gray-600 mt-2">Welcome back {firstName}! Here's what happened yesterday.</p>
        </div>

        {/* Top 4 Stat Widgets */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
          {/* Widget 1: Net Sales */}
          <div className="bg-white rounded-xl shadow-md p-6 border border-gray-200 hover:shadow-lg transition-shadow">
              <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-gray-600">Net Sales</h3>
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#e6d7b8' }}>
                <img src={iconNetSales} alt="" className="h-5 w-5 text-gray-700" aria-hidden="true" />
              </div>
            </div>
            <div className="mb-2">
              <p className="text-3xl font-bold text-gray-900">{formatCurrency(widgetData.netSales)}</p>
            </div>
            <div className={`flex items-center text-sm ${getChangeColor(netSalesPercentChange)}`}>
              <span className="font-semibold">
                {getChangeIcon(netSalesPercentChange)} {Math.abs(netSalesPercentChange).toFixed(1)}%
              </span>
              <span className="ml-2 text-gray-500">vs last week</span>
            </div>
          </div>

          {/* Widget 2: Total Tips */}
          <div className="bg-white rounded-xl shadow-md p-6 border border-gray-200 hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium text-gray-600">Total Tips</h3>
                <IconInfo label="Includes tips made only by employees. Excludes tips from third party sources." />
              </div>
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#e6d7b8' }}>
                <IconTips />
              </div>
            </div>
            <div className="mb-2">
              <p className="text-3xl font-bold text-gray-900">{formatCurrency(widgetData.totalTips)}</p>
            </div>
            <div className={`flex items-center text-sm ${getChangeColor(tipsPercentChange)}`}>
              <span className="font-semibold">
                {getChangeIcon(tipsPercentChange)} {Math.abs(tipsPercentChange).toFixed(1)}%
              </span>
              <span className="ml-2 text-gray-500">vs last week</span>
            </div>
          </div>

          {/* Widget 3: Total Gratuity */}
          <div className="bg-white rounded-xl shadow-md p-6 border border-gray-200 hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium text-gray-600">Total Gratuity</h3>
                <IconInfo label="Includes gratuity made only by employees. Excludes gratuity from third party sources." />
              </div>
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#e6d7b8' }}>
                <IconGratuity />
              </div>
            </div>
            <div className="mb-2">
              <p className="text-3xl font-bold text-gray-900">{formatCurrency(widgetData.totalGratuity)}</p>
            </div>
            <div className={`flex items-center text-sm ${getChangeColor(gratuityPercentChange)}`}>
              <span className="font-semibold">
                {getChangeIcon(gratuityPercentChange)} {Math.abs(gratuityPercentChange).toFixed(1)}%
              </span>
              <span className="ml-2 text-gray-500">vs last week</span>
            </div>
          </div>

          {/* Widget 4: Pending Payouts */}
          <div className="bg-white rounded-xl shadow-md p-6 border border-gray-200 hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-gray-600">Pending Payouts</h3>
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#e6d7b8' }}>
                <IconPending />
              </div>
            </div>
            <div className="mb-2">
              <p className="text-3xl font-bold text-gray-900">{formatCurrency(widgetData.pendingPayouts)}</p>
            </div>
          </div>
        </div>

        {/* Bottom Row - 2 Larger Widgets */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Widget 5: Weekly Tips & Gratuities */}
          <div className="bg-white rounded-xl shadow-md p-6 border border-gray-200 flex flex-col">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Weekly Tips &amp; Gratuities</h3>
                <p className="text-sm text-gray-600">Last 7 days performance</p>
              </div>
              <div className="flex flex-col items-end gap-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#e6d7b8' }}>
                  <IconRevenue />
                </div>
                <div className="flex items-center gap-4 text-xs font-medium text-gray-600">
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: earnedColor }} />
                    Earned
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: paidColor }} />
                    Paid
                  </span>
                </div>
              </div>
            </div>
            
            {/* Simple Bar Chart */}
            <div className="mt-2 flex-1 flex flex-col">
              <div className="relative h-64">
                {yAxisTicks.map((value) => {
                  const top = revenueRange === 0 ? 100 : 100 - (value / revenueRange) * 100;
                  return (
                    <div
                      key={value}
                      className="absolute left-0 right-0 flex items-center"
                      style={{ top: `${top}%` }}
                    >
                      <span className="w-12 text-[11px] text-gray-500 -translate-y-1/2">
                        {formatCurrency(value)}
                      </span>
                      <div className="flex-1 border-t border-gray-200 ml-2" />
                    </div>
                  );
                })}
                <div className="absolute left-12 right-0 bottom-0 top-0 flex items-end justify-between gap-2 px-1 pb-1">
                  {widgetData.weeklyTipsGratuities.map((item) => {
                    const total = item.tips + item.gratuity;
                    const normalized = Math.max(
                      0,
                      Math.min(1, revenueRange === 0 ? 0 : (total - revenueMin) / revenueRange),
                    );
                    const barColor = earnedColor;
                    return (
                      <div key={item.date} className="flex-1 flex items-end h-full">
                        <div
                          className="w-3/4 mx-auto rounded-t-lg overflow-hidden transition-all cursor-pointer"
                          style={{ height: `${normalized * 100}%` }}
                          title={`${item.day}: ${formatCurrency(total)}`}
                        >
                          <div
                            className="h-full w-full"
                            style={{ backgroundColor: barColor }}
                            title={`Tips & Gratuity: ${formatCurrency(total)}`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="ml-12 mt-2 flex justify-between gap-2 text-xs text-gray-600 font-medium">
                {widgetData.weeklyTipsGratuities.map((item) => (
                  <span key={item.date} className="flex-1 text-center">
                    <span className="block">{formatShortDate(item.date)}</span>
                    <span className="block text-[10px] text-gray-400">{item.day}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Widget 6: Recent Transactions */}
          <div className="bg-white rounded-xl shadow-md p-6 border border-gray-200">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Recent Transactions</h3>
                <p className="text-sm text-gray-600">Latest payout settlements</p>
              </div>
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#e6d7b8' }}>
                <IconTransactions />
              </div>
            </div>
            
            <div className="space-y-3">
              {widgetData.recentTransactions.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-200 p-4 text-sm text-gray-500">
                  No recent settlements yet.
                </div>
              ) : (
                widgetData.recentTransactions.map((transaction) => {
                  const dateLabel = formatSettlementDate(
                    transaction.businessDate || transaction.createdAt,
                  );
                  return (
                    <div
                      key={transaction.id}
                      className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors border border-gray-100"
                    >
                      <div>
                        <p className="font-medium text-gray-900">{dateLabel}</p>
                        {transaction.employeeName ? (
                          <p className="text-xs text-gray-500">{transaction.employeeName}</p>
                        ) : null}
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-gray-900">
                          {formatCurrency(transaction.amount)}
                        </p>
                        <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-800">
                          completed
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
  );
};

export default GratlyHomeDashboard;
