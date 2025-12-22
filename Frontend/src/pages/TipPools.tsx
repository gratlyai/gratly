import { useState } from "react";

export default function TipPools() {
  const [roles, setRoles] = useState([
    { role: "Server", points: 5 },
    { role: "Bartender", points: 3 },
    { role: "Host", points: 2 },
  ]);

  const totalTips = 1000;
  const totalPoints = roles.reduce((a, b) => a + b.points, 0);

  return (
    <main className="p-6 bg-gray-100">
      <h1 className="text-xl mb-4">Tip Pool Preview</h1>
      {roles.map((r, i) => (
        <div key={i} className="flex gap-4 mb-2">
          <span>{r.role}</span>
          <input
            type="number"
            value={r.points}
            onChange={e => {
              const updated = [...roles];
              updated[i].points = Number(e.target.value);
              setRoles(updated);
            }}
            className="border px-2"
          />
          <span>${(totalTips * (r.points / totalPoints)).toFixed(2)}</span>
        </div>
      ))}
    </main>
  );
}
