import { Link, useParams } from "react-router-dom";

export const Sidebar = () => {
  const { restaurantKey } = useParams();
  const businessBase = restaurantKey ? `/business/${restaurantKey}` : "/business";

  return (
    <aside className="w-64 bg-gray-900 text-white min-h-screen p-4">
      <h2 className="text-xl font-bold mb-6">DishOut</h2>
      <nav className="space-y-3">
        <Link to={`${businessBase}/home`}>Home</Link>
        <Link to={`${businessBase}/reconciliation`}>Reconciliation</Link>
        <Link to={`${businessBase}/shift-payout`}>Shift Payout</Link>
        <Link to={`${businessBase}/employees`}>Employees</Link>
        <Link to={`${businessBase}/tip-pools`}>Tip Pools</Link>
        <Link to={`${businessBase}/distributions`}>Distributions</Link>
        <Link to={`${businessBase}/reports`}>Reports</Link>
        <Link to={`${businessBase}/settings`}>Settings</Link>
      </nav>
    </aside>
  );
};
