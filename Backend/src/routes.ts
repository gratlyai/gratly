import { Router } from "express";
import { db } from "./db";

const router = Router();

router.get("/timeentries", async (_req, res) => {
  const [rows] = await db.query(
    "SELECT EMPLOYEEGUID AS employeeID, JOBID AS jobID, INDATE AS inDate, OUTDATE AS outDate, BUSINESSDATE AS businessDate, REGULARHOURS AS regularHours, NONCASHSALES AS nonCashSales, NONCASHGRATUITYSERVICECHARGES AS nonCshGratuityServiceCharges, NONCASHTIPS AS nonCashTips FROM GRATLYDB.SRC_TIMEENTRIES"
  );
  res.json(rows);
});

export default router;
