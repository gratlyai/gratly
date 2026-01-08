from fastapi import APIRouter, HTTPException
from typing import Dict, Optional, List
import pymysql

try:
    from Backend.db import (
        _get_cursor,
        _fetch_employee_guid_for_user,
        _fetch_restaurant_guid,
        _fetch_restaurant_key,
        _fetch_user_permission_names,
        _serialize_permissions,
    )
except ImportError:
    from db import (
        _get_cursor,
        _fetch_employee_guid_for_user,
        _fetch_restaurant_guid,
        _fetch_restaurant_key,
        _fetch_user_permission_names,
        _serialize_permissions,
    )

router = APIRouter()


def _get_date_key(value: Optional[str]) -> str:
    if not value:
        return ""
    return "".join(char for char in value if char.isdigit()) or value


def _get_yesterday_key() -> str:
    from datetime import date, timedelta

    yesterday = date.today() - timedelta(days=1)
    return yesterday.strftime("%Y%m%d")


def _get_yesterday_date_strings() -> tuple[str, str]:
    from datetime import date, timedelta

    yesterday = date.today() - timedelta(days=1)
    return yesterday.strftime("%Y%m%d"), yesterday.strftime("%Y-%m-%d")


@router.get("/reports/weekly-tips-gratuities")
def get_weekly_tips_gratuities(user_id: int):
    permission_names = _fetch_user_permission_names(user_id)
    permissions = _serialize_permissions(permission_names)
    if permissions is None:
        raise HTTPException(status_code=404, detail="User permissions not found")
    restaurant_id = _fetch_restaurant_key(user_id)
    if not restaurant_id:
        raise HTTPException(status_code=404, detail="Restaurant not found")

    is_admin_view = bool(permissions.get("adminAccess") or permissions.get("managerAccess"))
    employee_guid = None
    if not is_admin_view:
        employee_guid = _fetch_employee_guid_for_user(user_id)
        if not employee_guid:
            return {"days": []}

    cursor = _get_cursor(dictionary=True)
    try:
        query = """
            SELECT
                date_value,
                COALESCE(SUM(total_payout), 0) AS total_payout
            FROM (
                SELECT
                    COALESCE(
                        STR_TO_DATE(BUSINESSDATE, '%%Y-%%m-%%d'),
                        STR_TO_DATE(BUSINESSDATE, '%%Y/%%m/%%d'),
                        STR_TO_DATE(BUSINESSDATE, '%%m/%%d/%%Y'),
                        STR_TO_DATE(BUSINESSDATE, '%%m-%%d-%%Y'),
                        STR_TO_DATE(BUSINESSDATE, '%%Y%%m%%d'),
                        STR_TO_DATE(LEFT(BUSINESSDATE, 10), '%%Y-%%m-%%d')
                    ) AS date_value,
                    COALESCE(NET_PAYOUT, 0) AS total_payout
                FROM GRATLYDB.PAYOUT_FINAL
                WHERE RESTAURANTID = %s
                  AND BUSINESSDATE IS NOT NULL
        """
        params: List[object] = [restaurant_id]
        if employee_guid:
            query += " AND EMPLOYEEGUID = %s"
            params.append(employee_guid)
        query += """
            ) totals
            WHERE date_value >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
            GROUP BY date_value
            ORDER BY date_value
        """
        cursor.execute(query, params)
        rows = cursor.fetchall()
        totals_by_date = {
            row["date_value"].strftime("%Y-%m-%d"): float(row.get("total_payout") or 0)
            for row in rows
            if row.get("date_value")
        }

        from datetime import date, timedelta

        days = []
        for offset in range(6, -1, -1):
            day_value = date.today() - timedelta(days=offset)
            key = day_value.strftime("%Y-%m-%d")
            total_payout = totals_by_date.get(key, 0.0)
            days.append(
                {
                    "date": key,
                    "tips": total_payout,
                    "gratuity": 0.0,
                }
            )
        return {"days": days}
    except pymysql.MySQLError as err:
        raise HTTPException(status_code=500, detail=f"Error fetching weekly tips/gratuities: {err}")
    finally:
        cursor.close()


@router.get("/reports/pending-payouts")
def get_pending_payouts(user_id: int):
    permission_names = _fetch_user_permission_names(user_id)
    permissions = _serialize_permissions(permission_names)
    if permissions is None:
        raise HTTPException(status_code=404, detail="User permissions not found")
    restaurant_id = _fetch_restaurant_key(user_id)
    if not restaurant_id:
        raise HTTPException(status_code=404, detail="Restaurant not found")
    restaurant_guid = _fetch_restaurant_guid(user_id)
    if not restaurant_guid:
        raise HTTPException(status_code=404, detail="Restaurant not found")

    is_admin_view = bool(permissions.get("adminAccess") or permissions.get("managerAccess"))
    employee_guid = None
    if not is_admin_view:
        employee_guid = _fetch_employee_guid_for_user(user_id)
        if not employee_guid:
            return {"pendingPayouts": 0.0}

    cursor = _get_cursor(dictionary=True)
    try:
        order_query = """
            SELECT
                COALESCE(SUM(COALESCE(TIPAMOUNT, 0) + COALESCE(GRATUITYAMOUNT, 0)), 0) AS total_tips_gratuity
            FROM GRATLYDB.SRC_ALLORDERS
            WHERE RESTAURANTGUID = %s
              AND (VOIDED IS NULL OR VOIDED <> '1')
        """
        order_params: List[object] = [restaurant_guid]
        if employee_guid:
            order_query += " AND EMPLOYEEGUID = %s"
            order_params.append(employee_guid)
        cursor.execute(order_query, order_params)
        order_row = cursor.fetchone()
        total_orders = float(order_row["total_tips_gratuity"] or 0)

        payout_query = """
            SELECT
                COALESCE(SUM(COALESCE(NET_PAYOUT, 0) + COALESCE(PREPAYOUT_DEDUCTION, 0)), 0) AS total_paid
            FROM GRATLYDB.PAYOUT_FINAL
            WHERE RESTAURANTID = %s
        """
        payout_params: List[object] = [restaurant_id]
        if employee_guid:
            payout_query += " AND EMPLOYEEGUID = %s"
            payout_params.append(employee_guid)
        cursor.execute(payout_query, payout_params)
        payout_row = cursor.fetchone()
        total_paid = float(payout_row["total_paid"] or 0)

        pending = max(0.0, round(total_orders - total_paid, 2))
        return {"pendingPayouts": pending}
    except pymysql.MySQLError as err:
        raise HTTPException(status_code=500, detail=f"Error fetching pending payouts: {err}")
    finally:
        cursor.close()


@router.get("/reports/payroll")
def get_payroll_report(user_id: int, start_date: str, end_date: str):
    permission_names = _fetch_user_permission_names(user_id)
    permissions = _serialize_permissions(permission_names)
    if permissions is None:
        raise HTTPException(status_code=404, detail="User permissions not found")
    restaurant_id = _fetch_restaurant_key(user_id)
    if not restaurant_id:
        raise HTTPException(status_code=404, detail="Restaurant not found")

    from datetime import datetime

    try:
        start_value = datetime.strptime(start_date, "%Y-%m-%d").date()
        end_value = datetime.strptime(end_date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format; use YYYY-MM-DD")
    if end_value < start_value:
        raise HTTPException(status_code=400, detail="End date must be on or after start date")

    is_admin_view = bool(permissions.get("adminAccess") or permissions.get("managerAccess"))
    employee_guid = None
    if not is_admin_view:
        employee_guid = _fetch_employee_guid_for_user(user_id)
        if not employee_guid:
            return {"employees": []}

    cursor = _get_cursor(dictionary=True)
    try:
        query = """
            SELECT
                pf.EMPLOYEEGUID AS employee_guid,
                CONCAT_WS(' ', se.EMPLOYEEFNAME, se.EMPLOYEELNAME) AS employee_name,
                COALESCE(SUM(pf.NET_PAYOUT), 0) AS amount_total
            FROM GRATLYDB.PAYOUT_FINAL pf
            LEFT JOIN GRATLYDB.SRC_EMPLOYEES se
                ON se.EMPLOYEEGUID = pf.EMPLOYEEGUID
            WHERE pf.RESTAURANTID = %s
              AND STR_TO_DATE(pf.BUSINESSDATE, '%%Y-%%m-%%d') BETWEEN %s AND %s
        """
        params: List[object] = [restaurant_id, start_value, end_value]
        if employee_guid:
            query += " AND pf.EMPLOYEEGUID = %s"
            params.append(employee_guid)
        query += """
            GROUP BY pf.EMPLOYEEGUID, employee_name
            ORDER BY employee_name
        """
        cursor.execute(query, params)
        rows = cursor.fetchall()
        employees = [
            {
                "employeeGuid": row.get("employee_guid"),
                "employeeName": (row.get("employee_name") or "").strip() or "Unknown",
                "totalPayout": round(float(row.get("amount_total") or 0), 2),
            }
            for row in rows
        ]
        return {"employees": employees}
    except pymysql.MySQLError as err:
        raise HTTPException(status_code=500, detail=f"Error fetching payroll report: {err}")
    finally:
        cursor.close()


def _fetch_settlement_totals(
    cursor,
    restaurant_id: int,
    employee_guid: Optional[str],
    start_value,
    end_value,
):
    query = """
        SELECT
            pf.EMPLOYEEGUID AS employee_guid,
            CONCAT_WS(' ', se.EMPLOYEEFNAME, se.EMPLOYEELNAME) AS employee_name,
            COALESCE(SUM(pf.NET_PAYOUT), 0) AS amount_total
        FROM GRATLYDB.PAYOUT_FINAL pf
        LEFT JOIN GRATLYDB.SRC_EMPLOYEES se
            ON se.EMPLOYEEGUID = pf.EMPLOYEEGUID
        WHERE pf.RESTAURANTID = %s
          AND STR_TO_DATE(pf.BUSINESSDATE, '%%Y-%%m-%%d') BETWEEN %s AND %s
    """
    params: List[object] = [restaurant_id, start_value, end_value]
    if employee_guid:
        query += " AND pf.EMPLOYEEGUID = %s"
        params.append(employee_guid)
    query += """
        GROUP BY pf.EMPLOYEEGUID, employee_name
        ORDER BY employee_name
    """
    cursor.execute(query, params)
    rows = cursor.fetchall()
    return [
        {
            "employeeGuid": row.get("employee_guid"),
            "employeeName": (row.get("employee_name") or "").strip() or "Unknown",
            "totalPayout": round(float(row.get("amount_total") or 0), 2),
        }
        for row in rows
    ]


@router.get("/reports/this-week")
def get_this_week_report(user_id: int):
    permission_names = _fetch_user_permission_names(user_id)
    permissions = _serialize_permissions(permission_names)
    if permissions is None:
        raise HTTPException(status_code=404, detail="User permissions not found")
    restaurant_id = _fetch_restaurant_key(user_id)
    if not restaurant_id:
        raise HTTPException(status_code=404, detail="Restaurant not found")

    is_admin_view = bool(permissions.get("adminAccess") or permissions.get("managerAccess"))
    employee_guid = None
    if not is_admin_view:
        employee_guid = _fetch_employee_guid_for_user(user_id)
        if not employee_guid:
            return {"employees": [], "startDate": None, "endDate": None}

    from datetime import date, timedelta

    today = date.today()
    start_value = today - timedelta(days=today.weekday())
    end_value = today

    cursor = _get_cursor(dictionary=True)
    try:
        employees = _fetch_settlement_totals(
            cursor, restaurant_id, employee_guid, start_value, end_value
        )
        return {
            "employees": employees,
            "startDate": start_value.strftime("%Y-%m-%d"),
            "endDate": end_value.strftime("%Y-%m-%d"),
        }
    except pymysql.MySQLError as err:
        raise HTTPException(status_code=500, detail=f"Error fetching weekly report: {err}")
    finally:
        cursor.close()


@router.get("/reports/this-month")
def get_this_month_report(user_id: int):
    permission_names = _fetch_user_permission_names(user_id)
    permissions = _serialize_permissions(permission_names)
    if permissions is None:
        raise HTTPException(status_code=404, detail="User permissions not found")
    restaurant_id = _fetch_restaurant_key(user_id)
    if not restaurant_id:
        raise HTTPException(status_code=404, detail="Restaurant not found")

    is_admin_view = bool(permissions.get("adminAccess") or permissions.get("managerAccess"))
    employee_guid = None
    if not is_admin_view:
        employee_guid = _fetch_employee_guid_for_user(user_id)
        if not employee_guid:
            return {"employees": [], "startDate": None, "endDate": None}

    from datetime import date

    today = date.today()
    start_value = date(today.year, today.month, 1)
    end_value = today

    cursor = _get_cursor(dictionary=True)
    try:
        employees = _fetch_settlement_totals(
            cursor, restaurant_id, employee_guid, start_value, end_value
        )
        return {
            "employees": employees,
            "startDate": start_value.strftime("%Y-%m-%d"),
            "endDate": end_value.strftime("%Y-%m-%d"),
        }
    except pymysql.MySQLError as err:
        raise HTTPException(status_code=500, detail=f"Error fetching monthly report: {err}")
    finally:
        cursor.close()


@router.get("/reports/yesterday")
def get_yesterday_report(
    restaurant_id: Optional[int] = None,
    restaurant_guid: Optional[str] = None,
    user_id: Optional[int] = None,
):
    employee_guid = None
    if user_id is not None:
        permission_names = _fetch_user_permission_names(user_id)
        permissions = _serialize_permissions(permission_names)
        if permissions is None:
            raise HTTPException(status_code=404, detail="User permissions not found")
        is_admin_view = bool(permissions.get("adminAccess") or permissions.get("managerAccess"))
        if not is_admin_view:
            employee_guid = _fetch_employee_guid_for_user(user_id)
            if not employee_guid:
                return {"schedules": []}
        if restaurant_id is None:
            restaurant_id = _fetch_restaurant_key(user_id)
        if restaurant_guid is None:
            restaurant_guid = _fetch_restaurant_guid(user_id)

    if restaurant_id is None and restaurant_guid is None and user_id is None:
        raise HTTPException(status_code=400, detail="restaurant_id, restaurant_guid, or user_id is required")

    cursor = _get_cursor(dictionary=True)
    try:
        date_compact, date_dash = _get_yesterday_date_strings()
        query = """
            SELECT
                pa.PAYOUT_SCHEDULEID AS payout_schedule_id,
                pa.BUSINESSDATE AS business_date,
                ps.NAME AS payout_schedule_name,
                pai.EMPLOYEEGUID AS employee_guid,
                pai.EMPLOYEE_NAME AS employee_name,
                pai.JOBTITLE AS job_title,
                pai.IS_CONTRIBUTOR AS is_contributor,
                pai.PAYOUT_RECEIVER_ID AS payout_receiver_id,
                pai.PAYOUT_PERCENTAGE AS payout_percentage,
                pai.TOTAL_SALES AS total_sales,
                pai.NET_SALES AS net_sales,
                pai.TOTAL_TIPS AS total_tips,
                pai.TOTAL_GRATUITY AS total_gratuity,
                pai.OVERALL_TIPS AS overall_tips,
                pai.OVERALL_GRATUITY AS overall_gratuity,
                pai.PAYOUT_TIPS AS payout_tips,
                pai.PAYOUT_GRATUITY AS payout_gratuity,
                pai.NET_PAYOUT AS net_payout
            FROM GRATLYDB.PAYOUT_APPROVAL_ITEMS pai
            JOIN GRATLYDB.PAYOUT_APPROVAL pa
                ON pa.PAYOUT_APPROVALID = pai.PAYOUT_APPROVALID
            LEFT JOIN GRATLYDB.PAYOUT_SCHEDULE ps
                ON ps.PAYOUT_SCHEDULEID = pa.PAYOUT_SCHEDULEID
            WHERE pa.RESTAURANTID = %s
              AND pa.BUSINESSDATE IN (%s, %s)
              AND pa.IS_APPROVED = 1
        """
        params: List[object] = [restaurant_id, date_compact, date_dash]
        if employee_guid:
            query += " AND pai.EMPLOYEEGUID = %s"
            params.append(employee_guid)
        query += " ORDER BY pa.PAYOUT_SCHEDULEID, pa.BUSINESSDATE, pai.EMPLOYEE_NAME"
        cursor.execute(query, params)
        rows = cursor.fetchall()
        if not rows:
            return {"schedules": []}

        schedule_map: Dict[str, dict] = {}
        for row in rows:
            schedule_key = f"{row['payout_schedule_id']}-{row['business_date']}"
            schedule_entry = schedule_map.setdefault(
                schedule_key,
                {
                    "payoutScheduleId": row["payout_schedule_id"],
                    "name": row["payout_schedule_name"],
                    "payoutRuleId": None,
                    "payoutRuleLabel": None,
                    "businessDate": row["business_date"],
                    "startDay": None,
                    "endDay": None,
                    "startTime": None,
                    "endTime": None,
                    "startDateTime": None,
                    "endDateTime": None,
                    "prepayoutFlag": False,
                    "totalSales": 0.0,
                    "netSales": 0.0,
                    "totalTips": 0.0,
                    "totalGratuity": 0.0,
                    "contributorCount": 0,
                    "receiverCount": 0,
                    "receiverRoles": [],
                    "contributors": [],
                },
            )

            schedule_entry["totalSales"] += float(row["total_sales"] or 0)
            schedule_entry["netSales"] += float(row["net_sales"] or 0)
            schedule_entry["totalTips"] += float(row["total_tips"] or 0)
            schedule_entry["totalGratuity"] += float(row["total_gratuity"] or 0)

            contributor_entry = {
                "employeeGuid": row["employee_guid"],
                "employeeName": row["employee_name"],
                "jobTitle": row["job_title"],
                "businessDate": row["business_date"],
                "inTime": None,
                "outTime": None,
                "hoursWorked": 0,
                "isContributor": row["is_contributor"],
                "payoutReceiverId": row["payout_receiver_id"],
                "payoutPercentage": float(row["payout_percentage"] or 0),
                "totalSales": float(row["total_sales"] or 0),
                "netSales": float(row["net_sales"] or 0),
                "totalTips": float(row["total_tips"] or 0),
                "totalGratuity": float(row["total_gratuity"] or 0),
                "overallTips": float(row["overall_tips"] or 0),
                "overallGratuity": float(row["overall_gratuity"] or 0),
                "payoutTips": float(row["payout_tips"] or 0),
                "payoutGratuity": float(row["payout_gratuity"] or 0),
                "netPayout": float(row["net_payout"] or 0),
            }
            schedule_entry["contributors"].append(contributor_entry)

            if (row["is_contributor"] or "").lower() == "yes":
                schedule_entry["contributorCount"] += 1
            else:
                schedule_entry["receiverCount"] += 1

        return {"schedules": list(schedule_map.values())}
    except pymysql.MySQLError as err:
        raise HTTPException(status_code=500, detail=f"Error fetching yesterday report: {err}")
    finally:
        cursor.close()
