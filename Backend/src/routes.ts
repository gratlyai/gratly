import { Router } from "express";
import { db } from "./db";

const router = Router();

router.get("/timeentries", async (_req, res) => {
  const [rows] = await db.query("SELECT employeeID,jobID,inDate,outDate,businessDate,regularHours,nonCashSales,nonCshGratuityServiceCharges,nonCashTips FROM calctip.TimeEntries");
  res.json(rows);
});

export default router;
