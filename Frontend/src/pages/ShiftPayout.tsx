import { Sidebar } from "../components/Sidebar";

export default function ShiftPayout() {
  return (
    <div className="flex">
      <Sidebar />
      <main className="p-6 flex-1 bg-gray-100">
        <h1 className="text-2xl mb-6">Shift Payout</h1>
        <p className="text-gray-700">
          Shift payout details will appear here.
        </p>
      </main>
    </div>
  );
}
