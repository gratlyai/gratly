import React, { useState, useEffect } from 'react';

interface WidgetData {
  totalRevenue: number;
  revenueChange: number;
  totalTips: number;
  tipsChange: number;
  activeEmployees: number;
  employeesChange: number;
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

const GratlyHomeDashboard: React.FC = () => {
  const [widgetData, setWidgetData] = useState<WidgetData>({
    totalRevenue: 48250.75,
    revenueChange: 12.5,
    totalTips: 15840.50,
    tipsChange: 8.3,
    activeEmployees: 42,
    employeesChange: 5.2,
    pendingPayouts: 8450.25,
    payoutsChange: -3.1,
    recentTransactions: [
      { id: '1', employee: 'John Smith', amount: 245.50, date: '2024-12-20', status: 'completed' },
      { id: '2', employee: 'Sarah Johnson', amount: 198.75, date: '2024-12-20', status: 'completed' },
      { id: '3', employee: 'Mike Davis', amount: 312.00, date: '2024-12-19', status: 'pending' },
      { id: '4', employee: 'Emily Wilson', amount: 175.25, date: '2024-12-19', status: 'completed' },
      { id: '5', employee: 'David Brown', amount: 289.50, date: '2024-12-18', status: 'completed' },
    ],
    revenueChart: [
      { day: 'Mon', amount: 6500 },
      { day: 'Tue', amount: 7200 },
      { day: 'Wed', amount: 6800 },
      { day: 'Thu', amount: 8100 },
      { day: 'Fri', amount: 9500 },
      { day: 'Sat', amount: 10200 },
      { day: 'Sun', amount: 8900 },
    ]
  });

  useEffect(() => {
    // Simulate API calls - replace with actual API endpoints
    const fetchWidgetData = async () => {
      // Example API call structure:
      // const response = await fetch('https://api.example.com/dashboard-data');
      // const data = await response.json();
      // setWidgetData(data);
      
      console.log('Widget data ready for API integration');
    };

    fetchWidgetData();
  }, []);

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

  const maxRevenue = Math.max(...widgetData.revenueChart.map(d => d.amount));

  return (
    <div className="p-8">
      <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Dashboard Overview</h1>
          <p className="text-gray-600 mt-2">Welcome back! Here's what's happening today.</p>
        </div>

        {/* Top 4 Stat Widgets */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
          {/* Widget 1: Total Revenue */}
          <div className="bg-white rounded-xl shadow-md p-6 border border-gray-200 hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-gray-600">Total Revenue</h3>
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <span className="text-xl">💰</span>
              </div>
            </div>
            <div className="mb-2">
              <p className="text-3xl font-bold text-gray-900">{formatCurrency(widgetData.totalRevenue)}</p>
            </div>
            <div className={`flex items-center text-sm ${getChangeColor(widgetData.revenueChange)}`}>
              <span className="font-semibold">{getChangeIcon(widgetData.revenueChange)} {Math.abs(widgetData.revenueChange)}%</span>
              <span className="ml-2 text-gray-500">vs last month</span>
            </div>
          </div>

          {/* Widget 2: Total Tips */}
          <div className="bg-white rounded-xl shadow-md p-6 border border-gray-200 hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-gray-600">Total Tips</h3>
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                <span className="text-xl">💵</span>
              </div>
            </div>
            <div className="mb-2">
              <p className="text-3xl font-bold text-gray-900">{formatCurrency(widgetData.totalTips)}</p>
            </div>
            <div className={`flex items-center text-sm ${getChangeColor(widgetData.tipsChange)}`}>
              <span className="font-semibold">{getChangeIcon(widgetData.tipsChange)} {Math.abs(widgetData.tipsChange)}%</span>
              <span className="ml-2 text-gray-500">vs last month</span>
            </div>
          </div>

          {/* Widget 3: Active Employees */}
          <div className="bg-white rounded-xl shadow-md p-6 border border-gray-200 hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-gray-600">Active Employees</h3>
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                <span className="text-xl">👥</span>
              </div>
            </div>
            <div className="mb-2">
              <p className="text-3xl font-bold text-gray-900">{widgetData.activeEmployees}</p>
            </div>
            <div className={`flex items-center text-sm ${getChangeColor(widgetData.employeesChange)}`}>
              <span className="font-semibold">{getChangeIcon(widgetData.employeesChange)} {Math.abs(widgetData.employeesChange)}%</span>
              <span className="ml-2 text-gray-500">vs last month</span>
            </div>
          </div>

          {/* Widget 4: Pending Payouts */}
          <div className="bg-white rounded-xl shadow-md p-6 border border-gray-200 hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-gray-600">Pending Payouts</h3>
              <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                <span className="text-xl">⏳</span>
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
          <div className="bg-white rounded-xl shadow-md p-6 border border-gray-200">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Weekly Revenue</h3>
                <p className="text-sm text-gray-600">Last 7 days performance</p>
              </div>
              <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                <span className="text-xl">📊</span>
              </div>
            </div>
            
            {/* Simple Bar Chart */}
            <div className="flex items-end justify-between h-48 gap-2">
              {widgetData.revenueChart.map((item) => (
                <div key={item.day} className="flex-1 flex flex-col items-center">
                  <div 
                    className="w-full bg-gradient-to-t from-indigo-600 to-indigo-400 rounded-t-lg hover:from-indigo-700 hover:to-indigo-500 transition-all cursor-pointer"
                    style={{ height: `${(item.amount / maxRevenue) * 100}%` }}
                    title={`${item.day}: ${formatCurrency(item.amount)}`}
                  />
                  <span className="text-xs text-gray-600 mt-2 font-medium">{item.day}</span>
                </div>
              ))}
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
                <span className="text-xl">📋</span>
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
