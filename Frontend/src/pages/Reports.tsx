import { StatCard } from "../components/StatCard";

export default function Dashboard() {
  return (
    <main className="p-6 bg-gray-100">
      <h1 className="text-2xl mb-6">Dashboard</h1>
      <div className="grid grid-cols-4 gap-4">
        <StatCard title="Today's Tips" value="$1,200" />
        <StatCard title="This Week" value="$6,400" />
        <StatCard title="Employees" value="18" />
        <StatCard title="Pending Payouts" value="$840" />
      </div>
    </main>
  );
}
