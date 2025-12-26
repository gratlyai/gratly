import React, { useState, useEffect } from 'react';
import { api } from './api/client';

interface WidgetData {
  netSales: number;
  netSalesChange: number;
  totalTips: number;
  tipsChange: number;
  totalGratuity: number;
  gratuityChange: number;
  pendingPayouts: number;
  payoutsChange: number;
  recentTransactions: Array<{
    id: string;
    employee: string;
    amount: number;
    date: string;
    status: string;
  }>;
  revenueChart: Array<{ day: string; amount: number }>;
}

const IconNetSales = () => (
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
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <circle cx="12" cy="12" r="3.5" />
    <path d="M12 9.5v5" />
  </svg>
);

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
  const revenueChartKey = 'weeklyRevenueChart';
  const revenueChartDateKey = 'weeklyRevenueDate';
  const revenueChartWeekKey = 'weeklyRevenueWeekKey';
  const storedUserName = localStorage.getItem('userName') || '';
  const firstName = storedUserName.trim().split(/\s+/)[0] || 'there';

  const loadStoredRevenueChart = (): Array<{ day: string; amount: number }> => {
    const stored = localStorage.getItem(revenueChartKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as Array<{ day: string; amount: number }>;
        if (Array.isArray(parsed) && parsed.length === 7) {
          return dayLabels.map((day, index) => ({
            day,
            amount: Number(parsed[index]?.amount) || 0,
          }));
        }
      } catch (error) {
        console.warn('Failed to read stored weekly revenue chart:', error);
      }
    }
    return dayLabels.map((day) => ({ day, amount: 0 }));
  };

  const getDayIndex = (date: Date): number => (date.getDay() + 6) % 7;
  const getWeekKey = (date: Date): string => {
    const start = new Date(date);
    const dayIndex = getDayIndex(start);
    start.setDate(start.getDate() - dayIndex);
    return start.toISOString().slice(0, 10);
  };

  const [widgetData, setWidgetData] = useState<WidgetData>({
    netSales: 0,
    netSalesChange: 0,
    totalTips: 0,
    tipsChange: 0,
    totalGratuity: 0,
    gratuityChange: 0,
    pendingPayouts: 8450.25,
    payoutsChange: -3.1,
    recentTransactions: [
      { id: '1', employee: 'John Smith', amount: 245.50, date: '2024-12-20', status: 'completed' },
      { id: '2', employee: 'Sarah Johnson', amount: 198.75, date: '2024-12-20', status: 'completed' },
      { id: '3', employee: 'Mike Davis', amount: 312.00, date: '2024-12-19', status: 'pending' },
      { id: '4', employee: 'Emily Wilson', amount: 175.25, date: '2024-12-19', status: 'completed' },
      { id: '5', employee: 'David Brown', amount: 289.50, date: '2024-12-18', status: 'completed' },
    ],
    revenueChart: loadStoredRevenueChart(),
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
    if (!Number.isFinite(widgetData.netSales) || widgetData.netSales <= 0) {
      return;
    }

    const today = new Date();
    const todayKey = today.toISOString().slice(0, 10);
    const lastUpdateKey = localStorage.getItem(revenueChartDateKey);
    const currentWeekKey = getWeekKey(today);
    const storedWeekKey = localStorage.getItem(revenueChartWeekKey);

    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const yesterdayIndex = getDayIndex(yesterday);
    const todayIndex = getDayIndex(today);

    let nextChart = widgetData.revenueChart;
    if (!Array.isArray(nextChart) || nextChart.length !== 7) {
      nextChart = dayLabels.map((day) => ({ day, amount: 0 }));
    }

    if (todayIndex === 0 || storedWeekKey !== currentWeekKey) {
      nextChart = dayLabels.map((day) => ({ day, amount: 0 }));
    } else {
      nextChart = nextChart.map((item, index) => ({
        day: dayLabels[index],
        amount: Number(item.amount) || 0,
      }));
    }

    if (
      lastUpdateKey === todayKey &&
      Number(nextChart[yesterdayIndex]?.amount || 0) === widgetData.netSales
    ) {
      return;
    }

    nextChart[yesterdayIndex] = {
      day: dayLabels[yesterdayIndex],
      amount: widgetData.netSales,
    };

    setWidgetData((prev) => ({
      ...prev,
      revenueChart: nextChart,
    }));

    localStorage.setItem(revenueChartKey, JSON.stringify(nextChart));
    localStorage.setItem(revenueChartDateKey, todayKey);
    localStorage.setItem(revenueChartWeekKey, currentWeekKey);
  }, [widgetData.netSales]);

  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const getChangeColor = (change: number): string => {
    return change >= 0 ? 'text-green-600' : 'text-red-600';
  };

  const getChangeIcon = (change: number): string => {
    return change >= 0 ? '↑' : '↓';
  };

  const maxRevenue = Math.max(...widgetData.revenueChart.map(d => d.amount), 0);
  const revenueMax = maxRevenue > 0 ? Math.ceil(maxRevenue / 1000) * 1000 : 1000;
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
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <IconNetSales />
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
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
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
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
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
              <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                <IconPending />
              </div>
            </div>
            <div className="mb-2">
              <p className="text-3xl font-bold text-gray-900">{formatCurrency(widgetData.pendingPayouts)}</p>
            </div>
            <div className={`flex items-center text-sm ${getChangeColor(widgetData.payoutsChange)}`}>
              <span className="font-semibold">{getChangeIcon(widgetData.payoutsChange)} {Math.abs(widgetData.payoutsChange)}%</span>
              <span className="ml-2 text-gray-500">vs last month</span>
            </div>
          </div>
        </div>

        {/* Bottom Row - 2 Larger Widgets */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Widget 5: Revenue Chart */}
          <div className="bg-white rounded-xl shadow-md p-6 border border-gray-200 flex flex-col">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Weekly Revenue</h3>
                <p className="text-sm text-gray-600">Last 7 days performance</p>
              </div>
              <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                <IconRevenue />
              </div>
            </div>
            
            {/* Simple Bar Chart */}
            <div className="mt-2 flex-1 flex flex-col">
              <div className="relative flex-1">
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
                  {widgetData.revenueChart.map((item) => {
                    const normalized = Math.max(
                      0,
                      Math.min(1, revenueRange === 0 ? 0 : (item.amount - revenueMin) / revenueRange)
                    );
                    return (
                      <div key={item.day} className="flex-1 flex items-end">
                        <div
                          className="w-full bg-gradient-to-t from-indigo-600 to-indigo-400 rounded-t-lg hover:from-indigo-700 hover:to-indigo-500 transition-all cursor-pointer"
                          style={{ height: `${normalized * 100}%` }}
                          title={`${item.day}: ${formatCurrency(item.amount)}`}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="ml-12 mt-2 flex justify-between gap-2 text-xs text-gray-600 font-medium">
                {widgetData.revenueChart.map((item) => (
                  <span key={item.day} className="flex-1 text-center">
                    {item.day}
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
                <p className="text-sm text-gray-600">Latest tip distributions</p>
              </div>
              <div className="w-10 h-10 bg-teal-100 rounded-lg flex items-center justify-center">
                <IconTransactions />
              </div>
            </div>
            
            <div className="space-y-3">
              {widgetData.recentTransactions.map((transaction) => (
                <div 
                  key={transaction.id} 
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors border border-gray-100"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
                      <span className="text-sm font-bold text-gray-600">
                        {transaction.employee.split(' ').map(n => n[0]).join('')}
                      </span>
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{transaction.employee}</p>
                      <p className="text-xs text-gray-500">{transaction.date}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-gray-900">{formatCurrency(transaction.amount)}</p>
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      transaction.status === 'completed' 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-yellow-100 text-yellow-800'
                    }`}>
                      {transaction.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
  );
};

export default GratlyHomeDashboard;
