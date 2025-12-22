import { fetchUsers } from "../api/users";
import { useEffect, useState } from "react";
//  import { fetchUsers } from "./api/users";



type User = {
  employeeID: number;
  jobID: string;
  inDate: string;
  outDate: string;
  regularHours: string;
  nonCashSales: string;
  nonCashGratuityServiceCharges: string;
  nonCashTips: string
};

export default function App() {
  const [users, setUsers] = useState<User[]>([]);

  useEffect(() => {
    fetchUsers().then(setUsers);
  }, []);

  return (
    <ul>
      {users.map((u) => (
        <li key={u.employeeID}>{u.jobID} ({u.nonCashSales})</li>
      ))}
    </ul>
  );
}

/*export default function Dashboard() {
  return (
    <div className="flex">
      <Sidebar />
      <main className="p-6 flex-1 bg-gray-100">
        <h1 className="text-2xl mb-6">Dashboard</h1>
        <div className="grid grid-cols-4 gap-4">
          <StatCard title="Today's Tips" value="$1,200" />
          <StatCard title="This Week" value="$6,400" />
          <StatCard title="Employees" value="18" />
          <StatCard title="Pending Payouts" value="$840" />
        </div>
      </main>
    </div>
  );
}
  */
