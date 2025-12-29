from fastapi import APIRouter, HTTPException
from typing import Dict, Optional
import pymysql

try:
    from Backend.db import _get_cursor
except ImportError:
    from db import _get_cursor

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


@router.get("/reports/yesterday")
def get_yesterday_report(
    restaurant_id: Optional[int] = None,
    restaurant_guid: Optional[str] = None,
    user_id: Optional[int] = None,
):
    if restaurant_id is None and restaurant_guid is None and user_id is None:
        raise HTTPException(status_code=400, detail="restaurant_id, restaurant_guid, or user_id is required")

    cursor = _get_cursor(dictionary=True)
    try:
        date_compact, date_dash = _get_yesterday_date_strings()
        cursor.execute(
            """
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
            ORDER BY pa.PAYOUT_SCHEDULEID, pa.BUSINESSDATE, pai.EMPLOYEE_NAME
            """,
            (restaurant_id, date_compact, date_dash),
        )
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
