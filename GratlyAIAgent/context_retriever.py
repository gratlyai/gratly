"""Permission-aware data retrieval for the Gratly AI Agent."""

import logging
from typing import Dict, Any, List, Optional
from datetime import date, timedelta
import pymysql

logger = logging.getLogger(__name__)

try:
    from Backend.db import (
        _get_cursor,
        _fetch_restaurant_key,
        _fetch_restaurant_name,
        _fetch_restaurant_guid,
        _fetch_user_permission_names,
        _fetch_employee_guid_for_user,
        _serialize_permissions,
    )
except ImportError:
    from db import (
        _get_cursor,
        _fetch_restaurant_key,
        _fetch_restaurant_name,
        _fetch_restaurant_guid,
        _fetch_user_permission_names,
        _fetch_employee_guid_for_user,
        _serialize_permissions,
    )


class ContextRetriever:
    """Retrieves data with permission-based filtering for the AI agent."""

    def __init__(self, user_id: int):
        self.user_id = user_id
        self.restaurant_id = _fetch_restaurant_key(user_id)
        self.restaurant_name = _fetch_restaurant_name(user_id)
        self.restaurant_guid = _fetch_restaurant_guid(user_id)

        logger.info(f"ContextRetriever init: user_id={user_id}, restaurant_id={self.restaurant_id}, restaurant_guid={self.restaurant_guid}")

        permission_names = _fetch_user_permission_names(user_id)
        self.permissions = _serialize_permissions(permission_names) or {}

        self.is_admin = bool(
            self.permissions.get("adminAccess")
            or self.permissions.get("superadminAccess")
            or self.permissions.get("managerAccess")
        )

        logger.info(f"ContextRetriever: is_admin={self.is_admin}, permissions={list(self.permissions.keys())}")

        # For non-admins, get their employee GUID to filter data
        self.employee_guid = None if self.is_admin else _fetch_employee_guid_for_user(user_id)

    def get_employees(self, search_term: Optional[str] = None) -> Dict[str, Any]:
        """Get employees - admins see all, employees see only themselves."""
        if not self.restaurant_guid:
            return {"error": "Restaurant not found", "employees": []}

        cursor = _get_cursor(dictionary=True)
        try:
            query = """
                SELECT
                    se.EMPLOYEEGUID AS employee_guid,
                    se.EMPLOYEEFNAME AS first_name,
                    se.EMPLOYEELNAME AS last_name,
                    se.EMAIL AS email,
                    se.JOBTITLE AS job_title,
                    se.IS_ACTIVE AS is_active
                FROM GRATLYDB.SRC_EMPLOYEES se
                WHERE se.RESTAURANTGUID = %s
            """
            params: List[Any] = [self.restaurant_guid]

            # Non-admins can only see themselves
            if not self.is_admin and self.employee_guid:
                query += " AND se.EMPLOYEEGUID = %s"
                params.append(self.employee_guid)

            # Apply search filter
            if search_term:
                query += " AND (se.EMPLOYEEFNAME LIKE %s OR se.EMPLOYEELNAME LIKE %s OR CONCAT(se.EMPLOYEEFNAME, ' ', se.EMPLOYEELNAME) LIKE %s)"
                search_pattern = f"%{search_term}%"
                params.extend([search_pattern, search_pattern, search_pattern])

            query += " ORDER BY se.EMPLOYEEFNAME, se.EMPLOYEELNAME"
            cursor.execute(query, params)
            rows = cursor.fetchall()

            employees = [
                {
                    "name": f"{row.get('first_name', '')} {row.get('last_name', '')}".strip(),
                    "firstName": row.get("first_name"),
                    "lastName": row.get("last_name"),
                    "email": row.get("email"),
                    "jobTitle": row.get("job_title"),
                    "isActive": row.get("is_active", "1") == "1",
                }
                for row in rows
            ]

            return {
                "employees": employees,
                "count": len(employees),
                "accessLevel": "full" if self.is_admin else "self_only",
            }
        except pymysql.MySQLError as err:
            return {"error": f"Database error: {err}", "employees": []}
        finally:
            cursor.close()

    def get_payout_summary(self, start_date: str, end_date: str) -> Dict[str, Any]:
        """Get payout summary for a date range."""
        if not self.restaurant_id:
            return {"error": "Restaurant not found"}

        cursor = _get_cursor(dictionary=True)
        try:
            query = """
                SELECT
                    pf.EMPLOYEEGUID AS employee_guid,
                    CONCAT_WS(' ', se.EMPLOYEEFNAME, se.EMPLOYEELNAME) AS employee_name,
                    COALESCE(SUM(pf.NET_PAYOUT), 0) AS total_payout,
                    COUNT(DISTINCT pf.BUSINESSDATE) AS days_worked
                FROM GRATLYDB.PAYOUT_FINAL pf
                LEFT JOIN GRATLYDB.SRC_EMPLOYEES se ON se.EMPLOYEEGUID = pf.EMPLOYEEGUID
                WHERE pf.RESTAURANTID = %s
                  AND STR_TO_DATE(pf.BUSINESSDATE, '%%Y-%%m-%%d') BETWEEN %s AND %s
            """
            params: List[Any] = [self.restaurant_id, start_date, end_date]

            if not self.is_admin and self.employee_guid:
                query += " AND pf.EMPLOYEEGUID = %s"
                params.append(self.employee_guid)

            query += " GROUP BY pf.EMPLOYEEGUID, employee_name ORDER BY total_payout DESC"
            cursor.execute(query, params)
            rows = cursor.fetchall()

            employees = []
            total_amount = 0.0
            for row in rows:
                amount = float(row.get("total_payout") or 0)
                total_amount += amount
                employees.append({
                    "name": (row.get("employee_name") or "").strip() or "Unknown",
                    "totalPayout": round(amount, 2),
                    "daysWorked": row.get("days_worked", 0),
                })

            return {
                "startDate": start_date,
                "endDate": end_date,
                "totalPayout": round(total_amount, 2),
                "employeeCount": len(employees),
                "employees": employees if self.is_admin else employees[:1],  # Non-admins only see their own
                "accessLevel": "full" if self.is_admin else "self_only",
            }
        except pymysql.MySQLError as err:
            return {"error": f"Database error: {err}"}
        finally:
            cursor.close()

    def calculate_employee_payout(
        self,
        employee_name: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None
    ) -> Dict[str, Any]:
        """Calculate detailed payout for a specific employee."""
        if not self.restaurant_id:
            return {"error": "Restaurant not found"}

        # Default date range to current month
        today = date.today()
        if not start_date:
            start_date = date(today.year, today.month, 1).strftime("%Y-%m-%d")
        if not end_date:
            end_date = today.strftime("%Y-%m-%d")

        cursor = _get_cursor(dictionary=True)
        try:
            # First find the employee
            find_query = """
                SELECT EMPLOYEEGUID, EMPLOYEEFNAME, EMPLOYEELNAME
                FROM GRATLYDB.SRC_EMPLOYEES
                WHERE RESTAURANTGUID = %s
                  AND (EMPLOYEEFNAME LIKE %s OR EMPLOYEELNAME LIKE %s
                       OR CONCAT(EMPLOYEEFNAME, ' ', EMPLOYEELNAME) LIKE %s)
            """
            search_pattern = f"%{employee_name}%"
            cursor.execute(find_query, (self.restaurant_guid, search_pattern, search_pattern, search_pattern))
            employee = cursor.fetchone()

            if not employee:
                return {"error": f"Employee '{employee_name}' not found"}

            target_guid = employee["EMPLOYEEGUID"]
            full_name = f"{employee['EMPLOYEEFNAME']} {employee['EMPLOYEELNAME']}".strip()

            # Check permission - non-admins can only query themselves
            if not self.is_admin and self.employee_guid and target_guid != self.employee_guid:
                return {"error": "You don't have permission to view this employee's data"}

            # Get payout details
            payout_query = """
                SELECT
                    pf.BUSINESSDATE AS business_date,
                    COALESCE(pf.NET_PAYOUT, 0) AS net_payout,
                    COALESCE(pf.PREPAYOUT_DEDUCTION, 0) AS deduction
                FROM GRATLYDB.PAYOUT_FINAL pf
                WHERE pf.RESTAURANTID = %s
                  AND pf.EMPLOYEEGUID = %s
                  AND STR_TO_DATE(pf.BUSINESSDATE, '%%Y-%%m-%%d') BETWEEN %s AND %s
                ORDER BY pf.BUSINESSDATE
            """
            cursor.execute(payout_query, (self.restaurant_id, target_guid, start_date, end_date))
            payouts = cursor.fetchall()

            daily_payouts = []
            total_net = 0.0
            total_deductions = 0.0

            for row in payouts:
                net = float(row.get("net_payout") or 0)
                deduction = float(row.get("deduction") or 0)
                total_net += net
                total_deductions += deduction
                daily_payouts.append({
                    "date": row.get("business_date"),
                    "netPayout": round(net, 2),
                    "deduction": round(deduction, 2),
                })

            return {
                "employeeName": full_name,
                "startDate": start_date,
                "endDate": end_date,
                "totalNetPayout": round(total_net, 2),
                "totalDeductions": round(total_deductions, 2),
                "grossPayout": round(total_net + total_deductions, 2),
                "daysWithPayouts": len(daily_payouts),
                "dailyBreakdown": daily_payouts[-10:] if len(daily_payouts) > 10 else daily_payouts,  # Last 10 days
            }
        except pymysql.MySQLError as err:
            return {"error": f"Database error: {err}"}
        finally:
            cursor.close()

    def get_payout_schedules(self, schedule_name: Optional[str] = None) -> Dict[str, Any]:
        """Get payout schedule information."""
        if not self.restaurant_id:
            return {"error": "Restaurant not found", "schedules": []}

        cursor = _get_cursor(dictionary=True)
        try:
            query = """
                SELECT
                    ps.PAYOUT_SCHEDULEID AS schedule_id,
                    ps.NAME AS name,
                    ps.PAYOUT_RULE AS payout_rule,
                    ps.CREATEDDATE AS created_date,
                    ps.IS_ACTIVE AS is_active
                FROM GRATLYDB.PAYOUT_SCHEDULE ps
                WHERE ps.RESTAURANTID = %s
            """
            params: List[Any] = [self.restaurant_id]

            if schedule_name:
                query += " AND ps.NAME LIKE %s"
                params.append(f"%{schedule_name}%")

            query += " ORDER BY ps.NAME"
            cursor.execute(query, params)
            rows = cursor.fetchall()

            schedules = [
                {
                    "scheduleId": row.get("schedule_id"),
                    "name": row.get("name"),
                    "payoutRule": row.get("payout_rule"),
                    "isActive": row.get("is_active") == 1 or row.get("is_active") == "1",
                }
                for row in rows
            ]

            return {
                "schedules": schedules,
                "count": len(schedules),
            }
        except pymysql.MySQLError as err:
            return {"error": f"Database error: {err}", "schedules": []}
        finally:
            cursor.close()

    def get_report(
        self,
        report_type: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None
    ) -> Dict[str, Any]:
        """Get a summary report for a time period."""
        today = date.today()

        # Determine date range based on report type
        if report_type == "yesterday":
            yesterday = today - timedelta(days=1)
            start_date = yesterday.strftime("%Y-%m-%d")
            end_date = yesterday.strftime("%Y-%m-%d")
        elif report_type == "this-week":
            start_date = (today - timedelta(days=today.weekday())).strftime("%Y-%m-%d")
            end_date = today.strftime("%Y-%m-%d")
        elif report_type == "this-month":
            start_date = date(today.year, today.month, 1).strftime("%Y-%m-%d")
            end_date = today.strftime("%Y-%m-%d")
        elif report_type == "last-month":
            first_of_month = date(today.year, today.month, 1)
            last_month_end = first_of_month - timedelta(days=1)
            last_month_start = date(last_month_end.year, last_month_end.month, 1)
            start_date = last_month_start.strftime("%Y-%m-%d")
            end_date = last_month_end.strftime("%Y-%m-%d")
        elif report_type == "custom":
            if not start_date or not end_date:
                return {"error": "Custom report requires start_date and end_date"}
        else:
            return {"error": f"Unknown report type: {report_type}"}

        # Get the payout summary for this period
        summary = self.get_payout_summary(start_date, end_date)
        summary["reportType"] = report_type
        return summary

    def get_sales_and_tips(self, start_date: Optional[str] = None, end_date: Optional[str] = None) -> Dict[str, Any]:
        """Get sales and tips data for employees."""
        if not self.restaurant_id:
            return {"error": "Restaurant not found"}

        today = date.today()
        if not start_date:
            start_date = (today - timedelta(days=30)).strftime("%Y-%m-%d")  # Last 30 days
        if not end_date:
            end_date = today.strftime("%Y-%m-%d")

        cursor = _get_cursor(dictionary=True)
        try:
            # First check what data exists
            logger.info(f"Fetching sales for restaurant_guid={self.restaurant_guid}, dates {start_date} to {end_date}")

            query = """
                SELECT
                    te.EMPLOYEEGUID AS employee_guid,
                    CONCAT_WS(' ', se.EMPLOYEEFNAME, se.EMPLOYEELNAME) AS employee_name,
                    te.BUSINESSDATE AS business_date,
                    COALESCE(te.NONCASHSALES, 0) + COALESCE(te.CASHSALES, 0) AS daily_sales,
                    COALESCE(te.NONCASHTIPS, 0) + COALESCE(te.DECLAREDCASHTIPS, 0) AS daily_tips,
                    COALESCE(te.NONCASHGRATUITYSERVICECHARGES, 0) + COALESCE(te.CASHGRATUITYSERVICECHARGES, 0) AS daily_gratuity
                FROM GRATLYDB.SRC_TIMEENTRIES te
                LEFT JOIN GRATLYDB.SRC_EMPLOYEES se ON se.EMPLOYEEGUID = te.EMPLOYEEGUID
                WHERE te.RESTAURANTGUID = %s
                  AND te.BUSINESSDATE BETWEEN %s AND %s
            """
            params: List[Any] = [self.restaurant_guid, start_date, end_date]

            if not self.is_admin and self.employee_guid:
                query += " AND te.EMPLOYEEGUID = %s"
                params.append(self.employee_guid)

            query += " ORDER BY te.BUSINESSDATE DESC, employee_name"
            cursor.execute(query, params)
            rows = cursor.fetchall()

            logger.info(f"Found {len(rows)} sales records")

            # Build daily records and aggregate by employee
            daily_records = []
            employee_totals = {}
            total_sales = 0.0
            total_tips = 0.0

            for row in rows:
                sales = float(row.get("daily_sales") or 0)
                tips = float(row.get("daily_tips") or 0)
                gratuity = float(row.get("daily_gratuity") or 0)
                name = (row.get("employee_name") or "").strip() or "Unknown"
                biz_date = row.get("business_date", "")

                total_sales += sales
                total_tips += tips + gratuity

                # Track daily record
                daily_records.append({
                    "date": str(biz_date),
                    "name": name,
                    "sales": round(sales, 2),
                    "tips": round(tips, 2),
                    "gratuity": round(gratuity, 2),
                })

                # Aggregate by employee
                if name not in employee_totals:
                    employee_totals[name] = {"sales": 0, "tips": 0, "gratuity": 0, "days": 0}
                employee_totals[name]["sales"] += sales
                employee_totals[name]["tips"] += tips
                employee_totals[name]["gratuity"] += gratuity
                employee_totals[name]["days"] += 1

            employees = [
                {
                    "name": name,
                    "totalSales": round(data["sales"], 2),
                    "totalTips": round(data["tips"], 2),
                    "totalGratuity": round(data["gratuity"], 2),
                    "daysWorked": data["days"],
                }
                for name, data in sorted(employee_totals.items(), key=lambda x: x[1]["sales"], reverse=True)
            ]

            return {
                "startDate": start_date,
                "endDate": end_date,
                "totalSales": round(total_sales, 2),
                "totalTips": round(total_tips, 2),
                "employeeCount": len(employees),
                "employees": employees,
                "dailyRecords": daily_records[:50],  # Last 50 daily records
            }
        except pymysql.MySQLError as err:
            logger.error(f"Sales query error: {err}")
            return {"error": f"Database error: {err}"}
        finally:
            cursor.close()

    def get_pending_approvals(self) -> Dict[str, Any]:
        """Get pending payout approvals (admin only)."""
        if not self.is_admin:
            return {"error": "You don't have permission to view pending approvals"}

        if not self.permissions.get("approvePayouts") and not self.permissions.get("adminAccess"):
            return {"error": "You don't have approval permissions"}

        if not self.restaurant_id:
            return {"error": "Restaurant not found", "approvals": []}

        cursor = _get_cursor(dictionary=True)
        try:
            query = """
                SELECT
                    pa.PAYOUT_APPROVALID AS approval_id,
                    pa.PAYOUT_SCHEDULEID AS schedule_id,
                    ps.NAME AS schedule_name,
                    pa.BUSINESSDATE AS business_date,
                    pa.IS_APPROVED AS is_approved,
                    COUNT(pai.PAYOUT_APPROVAL_ITEMID) AS item_count,
                    COALESCE(SUM(pai.NET_PAYOUT), 0) AS total_amount
                FROM GRATLYDB.PAYOUT_APPROVAL pa
                LEFT JOIN GRATLYDB.PAYOUT_SCHEDULE ps ON ps.PAYOUT_SCHEDULEID = pa.PAYOUT_SCHEDULEID
                LEFT JOIN GRATLYDB.PAYOUT_APPROVAL_ITEMS pai ON pai.PAYOUT_APPROVALID = pa.PAYOUT_APPROVALID
                WHERE pa.RESTAURANTID = %s
                  AND (pa.IS_APPROVED = 0 OR pa.IS_APPROVED IS NULL)
                GROUP BY pa.PAYOUT_APPROVALID, pa.PAYOUT_SCHEDULEID, ps.NAME, pa.BUSINESSDATE, pa.IS_APPROVED
                ORDER BY pa.BUSINESSDATE DESC
                LIMIT 20
            """
            cursor.execute(query, (self.restaurant_id,))
            rows = cursor.fetchall()

            approvals = [
                {
                    "approvalId": row.get("approval_id"),
                    "scheduleId": row.get("schedule_id"),
                    "scheduleName": row.get("schedule_name"),
                    "businessDate": row.get("business_date"),
                    "employeeCount": row.get("item_count", 0),
                    "totalAmount": round(float(row.get("total_amount") or 0), 2),
                }
                for row in rows
            ]

            return {
                "approvals": approvals,
                "count": len(approvals),
            }
        except pymysql.MySQLError as err:
            return {"error": f"Database error: {err}", "approvals": []}
        finally:
            cursor.close()
