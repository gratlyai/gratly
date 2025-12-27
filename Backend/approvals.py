from fastapi import APIRouter, HTTPException
from typing import Dict, Optional
import pymysql

try:
    from Backend.db import _get_cursor, _fetch_restaurant_guid, _fetch_restaurant_key
except ImportError:
    from db import _get_cursor, _fetch_restaurant_guid, _fetch_restaurant_key

router = APIRouter()

PAYOUT_RULE_LABELS = {
    "1": "Custom Payout",
    "2": "Equal Payout",
    "3": "Hour Based Payout",
    "4": "Job Weighted Payout",
}

def _get_contributor_column(cursor) -> Optional[str]:
    cursor.execute(
        """
        SELECT COLUMN_NAME AS column_name
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = 'GRATLYDB'
          AND TABLE_NAME = 'PAYOUTRECEIVERS'
          AND COLUMN_NAME IN ('CONTRIBUTOR_RECEIVER', 'CONTRIBUTOR_RECIEVER')
        LIMIT 1
        """
    )
    row = cursor.fetchone()
    return row["column_name"] if row else None

@router.get("/approvals")
def get_approvals(
    restaurant_id: Optional[int] = None,
    restaurant_guid: Optional[str] = None,
    user_id: Optional[int] = None,
):
    if restaurant_id is None and restaurant_guid is None:
        if user_id is None:
            raise HTTPException(status_code=400, detail="restaurant_id or restaurant_guid is required")
        restaurant_guid = _fetch_restaurant_guid(user_id)
        restaurant_id = _fetch_restaurant_key(user_id)
    if restaurant_id is None and restaurant_guid:
        cursor_lookup = _get_cursor(dictionary=True)
        try:
            cursor_lookup.execute(
                """
                SELECT RESTAURANTID AS restaurant_id
                FROM GRATLYDB.SRC_ONBOARDING
                WHERE RESTAURANTGUID = %s
                LIMIT 1
                """,
                (restaurant_guid,),
            )
            row = cursor_lookup.fetchone()
            restaurant_id = row["restaurant_id"] if row else None
        finally:
            cursor_lookup.close()
    if restaurant_guid is None and restaurant_id is not None:
        cursor_lookup = _get_cursor(dictionary=True)
        try:
            cursor_lookup.execute(
                """
                SELECT RESTAURANTGUID AS restaurant_guid
                FROM GRATLYDB.SRC_ONBOARDING
                WHERE RESTAURANTID = %s
                LIMIT 1
                """,
                (restaurant_id,),
            )
            row = cursor_lookup.fetchone()
            restaurant_guid = row["restaurant_guid"] if row else None
        finally:
            cursor_lookup.close()
    if not restaurant_guid or restaurant_id is None:
        raise HTTPException(status_code=404, detail="Restaurant not found")

    cursor = _get_cursor(dictionary=True)
    try:
        contributor_column = _get_contributor_column(cursor)
        if not contributor_column:
            return {"schedules": []}

        cursor.execute(
            f"""
            SELECT
                ps.PAYOUT_SCHEDULEID AS payout_schedule_id,
                SUM(CASE WHEN pr.{contributor_column} = 0 THEN 1 ELSE 0 END) AS contributor_count,
                SUM(CASE WHEN pr.{contributor_column} = 1 THEN 1 ELSE 0 END) AS receiver_count
            FROM GRATLYDB.PAYOUT_SCHEDULE ps
            JOIN GRATLYDB.PAYOUTRECEIVERS pr
                ON pr.PAYOUT_SCHEDULEID = ps.PAYOUT_SCHEDULEID
            WHERE ps.RESTAURANTID = %s
            GROUP BY ps.PAYOUT_SCHEDULEID
            """,
            (restaurant_id,),
        )
        schedule_count_rows = cursor.fetchall()
        schedule_counts = {
            row["payout_schedule_id"]: {
                "contributorCount": int(row["contributor_count"] or 0),
                "receiverCount": int(row["receiver_count"] or 0),
            }
            for row in schedule_count_rows
        }

        contributor_flag = 0
        cursor.execute(
            f"""
            WITH GETALLPAYOUT_SCHEDULE AS (
                SELECT
                    PS.PAYOUT_SCHEDULEID,
                    PS.RESTAURANTID,
                    PS.NAME AS payout_schedule_name,
                    PS.START_DAY,
                    PS.END_DAY,
                    PS.START_TIME,
                    PS.END_TIME,
                    PS.PAYOUT_RULE_ID,
                    PS.PREPAYOUT_FLAG,
                    PS.PAYOUTTRIGGER_GRATUITY,
                    PS.PAYOUTTRIGGER_TIPS
                FROM GRATLYDB.PAYOUT_SCHEDULE PS
                JOIN GRATLYDB.PAYOUTRECEIVERS PR
                    ON PR.PAYOUT_SCHEDULEID = PS.PAYOUT_SCHEDULEID
                WHERE PS.RESTAURANTID = %s
                  AND PS.PAYOUT_RULE_ID = '4'
                  AND PR.{contributor_column} = %s
                GROUP BY PS.PAYOUT_SCHEDULEID
            ),
            GETPAYOUT_EMPLOYEES_DATA AS (
                SELECT DISTINCT
                    GPS.PAYOUT_SCHEDULEID,
                    GPS.RESTAURANTID,
                    GPS.payout_schedule_name,
                    GPS.START_DAY,
                    GPS.END_DAY,
                    GPS.START_TIME,
                    GPS.END_TIME,
                    GPS.PAYOUT_RULE_ID,
                    GPS.PREPAYOUT_FLAG,
                    ST.BUSINESSDATE,
                    STR_TO_DATE(REPLACE(ST.BUSINESSDATE, '-', ''), '%%Y%%m%%d') AS BUSINESS_DATE_VALUE,
                    CAST(TIMESTAMP(STR_TO_DATE(REPLACE(ST.BUSINESSDATE, '-', ''), '%%Y%%m%%d'), GPS.START_TIME) AS DATETIME(6))
                        AS START_DATETIME,
                    CAST(TIMESTAMP(STR_TO_DATE(REPLACE(ST.BUSINESSDATE, '-', ''), '%%Y%%m%%d'), GPS.END_TIME) AS DATETIME(6))
                        AS END_DATETIME,
                    ST.RESTAURANTGUID,
                    ST.EMPLOYEEGUID,
                    CONCAT(SE.EMPLOYEEFNAME, ' ', SE.EMPLOYEELNAME) AS EMPLOYEE_NAME,
                    ST.JOBID,
                    SJ.JOBTITLE,
                    PR.PAYOUT_RECEIVERID,
                    PR.PAYOUT_PERCENTAGE,
                    DATE_FORMAT(ST.INDATE, '%%l:%%i %%p') AS INDATE,
                    DATE_FORMAT(ST.OUTDATE, '%%l:%%i %%p') AS OUTDATE,
                    CASE WHEN PRC.PAYOUT_RECEIVERID IS NOT NULL THEN 'Yes' ELSE 'No' END AS IS_CONTRIBUTOR,
                    (ST.REGULARHOURS + ST.OVERTIMEHOURS) AS HOURS_WORKED
                FROM GRATLYDB.SRC_TIMEENTRIES ST
                JOIN GRATLYDB.SRC_ONBOARDING SO
                    ON SO.RESTAURANTGUID = ST.RESTAURANTGUID
                JOIN GETALLPAYOUT_SCHEDULE GPS
                    ON GPS.RESTAURANTID = SO.RESTAURANTID
                    AND FIELD(
                        LEFT(DAYNAME(STR_TO_DATE(REPLACE(ST.BUSINESSDATE, '-', ''), '%%Y%%m%%d')), 3),
                        'Mon','Tue','Wed','Thu','Fri','Sat','Sun'
                    ) BETWEEN
                    FIELD(LEFT(GPS.START_DAY, 3), 'Mon','Tue','Wed','Thu','Fri','Sat','Sun')
                    AND
                    FIELD(LEFT(GPS.END_DAY, 3), 'Mon','Tue','Wed','Thu','Fri','Sat','Sun')
                    AND ST.INDATE BETWEEN
                        CAST(TIMESTAMP(STR_TO_DATE(REPLACE(ST.BUSINESSDATE, '-', ''), '%%Y%%m%%d'), GPS.START_TIME) AS DATETIME(6))
                        AND
                        CAST(TIMESTAMP(STR_TO_DATE(REPLACE(ST.BUSINESSDATE, '-', ''), '%%Y%%m%%d'), GPS.END_TIME) AS DATETIME(6))
                JOIN GRATLYDB.SRC_EMPLOYEES SE
                    ON SE.EMPLOYEEGUID = ST.EMPLOYEEGUID
                JOIN GRATLYDB.SRC_JOBS SJ
                    ON SJ.JOBGUID = ST.JOBID
                JOIN GRATLYDB.PAYOUTRECEIVERS PR
                    ON PR.PAYOUT_SCHEDULEID = GPS.PAYOUT_SCHEDULEID
                    AND PR.PAYOUT_RECEIVERID = SJ.JOBTITLE
                LEFT JOIN GRATLYDB.PAYOUTRECEIVERS PRC
                    ON PRC.PAYOUT_SCHEDULEID = GPS.PAYOUT_SCHEDULEID
                    AND PRC.PAYOUT_RECEIVERID = SJ.JOBTITLE
                    AND PRC.{contributor_column} = %s
            ),
            GET_ALL_SALES AS (
                SELECT
                    GED.*,
                    SUM(COALESCE(SAO.TOTALAMOUNT, 0)) AS TOTAL_SALES,
                    SUM(COALESCE(SAO.TOTALAMOUNT, 0)) - (
                        SUM(COALESCE(SAO.TAXAMOUNT, 0))
                        + SUM(COALESCE(SAO.TIPAMOUNT, 0))
                        + SUM(COALESCE(SAO.GRATUITYAMOUNT, 0))
                    ) AS NET_SALES,
                    SUM(COALESCE(SAO.TIPAMOUNT, 0)) AS TOTAL_TIPS,
                    SUM(COALESCE(SAO.GRATUITYAMOUNT, 0)) AS TOTAL_GRATUITY
                FROM GETPAYOUT_EMPLOYEES_DATA GED
                LEFT JOIN GRATLYDB.SRC_ALLORDERS SAO
                    ON SAO.RESTAURANTGUID = GED.RESTAURANTGUID
                    AND SAO.EMPLOYEEGUID = GED.EMPLOYEEGUID
                    AND STR_TO_DATE(REPLACE(SAO.BUSINESSDATE, '-', ''), '%%Y%%m%%d')
                        = STR_TO_DATE(REPLACE(GED.BUSINESSDATE, '-', ''), '%%Y%%m%%d')
                    AND SAO.OPENEDDATE BETWEEN GED.START_DATETIME AND GED.END_DATETIME
                GROUP BY
                    GED.PAYOUT_SCHEDULEID,
                    GED.RESTAURANTID,
                    GED.payout_schedule_name,
                    GED.START_DAY,
                    GED.END_DAY,
                    GED.START_TIME,
                    GED.END_TIME,
                    GED.START_DATETIME,
                    GED.END_DATETIME,
                    GED.PAYOUT_RULE_ID,
                    GED.PREPAYOUT_FLAG,
                    GED.BUSINESSDATE,
                    GED.BUSINESS_DATE_VALUE,
                    GED.RESTAURANTGUID,
                    GED.EMPLOYEEGUID,
                    GED.EMPLOYEE_NAME,
                    GED.JOBID,
                    GED.JOBTITLE,
                    GED.PAYOUT_RECEIVERID,
                    GED.PAYOUT_PERCENTAGE,
                    GED.INDATE,
                    GED.OUTDATE,
                    GED.IS_CONTRIBUTOR,
                    GED.HOURS_WORKED
            ),
            GETPREPAYOUT_PER_PERSON AS (
                SELECT
                    GAS.*,
                    GAS_ALL.OVERALL_TIPS,
                    GAS_ALL.OVERALL_GRATUITY,
                    ROUND(
                        CASE
                            WHEN GAS.IS_CONTRIBUTOR = 'No' THEN ((GAS.PAYOUT_PERCENTAGE / 100) * GAS_ALL.OVERALL_TIPS)
                        END,
                        2
                    ) AS PAYOUT_TIPS,
                    ROUND(
                        CASE
                            WHEN GAS.IS_CONTRIBUTOR = 'No' THEN ((GAS.PAYOUT_PERCENTAGE / 100) * GAS_ALL.OVERALL_GRATUITY)
                        END,
                        2
                    ) AS PAYOUT_GRATUITY
                FROM GET_ALL_SALES GAS
                JOIN (
                    SELECT
                        PAYOUT_SCHEDULEID,
                        RESTAURANTID,
                        BUSINESSDATE,
                        SUM(TOTAL_TIPS) AS OVERALL_TIPS,
                        SUM(TOTAL_GRATUITY) AS OVERALL_GRATUITY
                    FROM GET_ALL_SALES
                    WHERE IS_CONTRIBUTOR = 'Yes'
                    GROUP BY PAYOUT_SCHEDULEID, RESTAURANTID, BUSINESSDATE
                ) GAS_ALL
                    ON GAS_ALL.PAYOUT_SCHEDULEID = GAS.PAYOUT_SCHEDULEID
                    AND GAS_ALL.RESTAURANTID = GAS.RESTAURANTID
                    AND GAS_ALL.BUSINESSDATE = GAS.BUSINESSDATE
            )
            SELECT
                GPP.*
            FROM GETPREPAYOUT_PER_PERSON GPP
            ORDER BY GPP.PAYOUT_SCHEDULEID, GPP.EMPLOYEE_NAME
            """,
            (restaurant_id, contributor_flag, contributor_flag),
        )
        rows = cursor.fetchall()
        if not rows:
            return {"schedules": []}

        schedule_ids = sorted({row["PAYOUT_SCHEDULEID"] for row in rows})
        cursor.execute(
            f"""
            SELECT
                PAYOUT_SCHEDULEID AS payout_schedule_id,
                PAYOUT_RECEIVERID AS receiver_id,
                PAYOUT_PERCENTAGE AS payout_percentage,
                {contributor_column} AS contributor_flag
            FROM GRATLYDB.PAYOUTRECEIVERS
            WHERE PAYOUT_SCHEDULEID IN ({", ".join(["%s"] * len(schedule_ids))})
            """,
            schedule_ids,
        )
        receiver_rows = cursor.fetchall()
        receiver_roles: Dict[int, list] = {}
        for row in receiver_rows:
            receiver_roles.setdefault(row["payout_schedule_id"], []).append(
                {
                    "receiverId": row["receiver_id"],
                    "payoutPercentage": float(row["payout_percentage"] or 0),
                    "isContributor": bool(row["contributor_flag"]),
                }
            )

        schedule_map: Dict[str, dict] = {}
        for row in rows:
            schedule_id = row["PAYOUT_SCHEDULEID"]
            business_date = row["BUSINESSDATE"]
            schedule_key = f"{schedule_id}-{business_date}"
            schedule_entry = schedule_map.setdefault(
                schedule_key,
                {
                    "payoutScheduleId": schedule_id,
                    "name": row["payout_schedule_name"],
                    "payoutRuleId": row["PAYOUT_RULE_ID"],
                    "payoutRuleLabel": PAYOUT_RULE_LABELS.get(str(row["PAYOUT_RULE_ID"] or ""), "Unknown"),
                    "businessDate": business_date,
                    "startDay": row["START_DAY"],
                    "endDay": row["END_DAY"],
                    "startTime": row["START_TIME"],
                    "endTime": row["END_TIME"],
                    "startDateTime": row["START_DATETIME"],
                    "endDateTime": row["END_DATETIME"],
                    "prepayoutFlag": bool(row["PREPAYOUT_FLAG"]),
                    "totalSales": 0.0,
                    "netSales": 0.0,
                    "totalTips": 0.0,
                    "totalGratuity": 0.0,
                    "contributorCount": schedule_counts.get(schedule_id, {}).get("contributorCount", 0),
                    "receiverCount": schedule_counts.get(schedule_id, {}).get("receiverCount", 0),
                    "receiverRoles": receiver_roles.get(schedule_id, []),
                    "contributors": [],
                },
            )
            is_contributor = (row["IS_CONTRIBUTOR"] or "").strip().lower() == "yes"
            schedule_entry["totalSales"] += float(row["TOTAL_SALES"] or 0)
            schedule_entry["netSales"] += float(row["NET_SALES"] or 0)
            schedule_entry["totalTips"] += float(row["TOTAL_TIPS"] or 0)
            schedule_entry["totalGratuity"] += float(row["TOTAL_GRATUITY"] or 0)

            schedule_entry["contributors"].append(
                {
                    "employeeGuid": row["EMPLOYEEGUID"],
                    "employeeName": row["EMPLOYEE_NAME"],
                    "jobTitle": row["JOBTITLE"],
                    "businessDate": row["BUSINESSDATE"],
                    "inTime": row["INDATE"],
                    "outTime": row["OUTDATE"],
                    "hoursWorked": float(row["HOURS_WORKED"] or 0),
                    "isContributor": row["IS_CONTRIBUTOR"],
                    "payoutReceiverId": row["PAYOUT_RECEIVERID"],
                    "payoutPercentage": float(row["PAYOUT_PERCENTAGE"] or 0),
                    "totalSales": float(row["TOTAL_SALES"] or 0),
                    "netSales": float(row["NET_SALES"] or 0),
                    "totalTips": float(row["TOTAL_TIPS"] or 0),
                    "totalGratuity": float(row["TOTAL_GRATUITY"] or 0),
                    "overallTips": float(row["OVERALL_TIPS"] or 0),
                    "overallGratuity": float(row["OVERALL_GRATUITY"] or 0),
                    "payoutTips": float(row["PAYOUT_TIPS"] or 0),
                    "payoutGratuity": float(row["PAYOUT_GRATUITY"] or 0),
                }
            )

        for schedule in schedule_map.values():
            schedule["totalSales"] = round(schedule["totalSales"], 2)
            schedule["netSales"] = round(schedule["netSales"], 2)
            schedule["totalTips"] = round(schedule["totalTips"], 2)
            schedule["totalGratuity"] = round(schedule["totalGratuity"], 2)

        return {"schedules": list(schedule_map.values())}
    except pymysql.MySQLError as err:
        raise HTTPException(status_code=500, detail=f"Error fetching approvals data: {err}")
    finally:
        cursor.close()
