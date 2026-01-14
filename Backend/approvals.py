from fastapi import APIRouter, HTTPException
from typing import Dict, List, Optional
import pymysql
from pydantic import BaseModel

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

class ApprovalOverrideItem(BaseModel):
    employeeGuid: Optional[str] = None
    employeeName: Optional[str] = None
    jobTitle: Optional[str] = None
    isContributor: Optional[str] = None
    payoutReceiverId: Optional[str] = None
    payoutPercentage: Optional[float] = None
    totalSales: Optional[float] = None
    netSales: Optional[float] = None
    totalTips: Optional[float] = None
    totalGratuity: Optional[float] = None
    overallTips: Optional[float] = None
    overallGratuity: Optional[float] = None
    payoutTips: Optional[float] = None
    payoutGratuity: Optional[float] = None
    netPayout: Optional[float] = None

class ApprovalOverridePayload(BaseModel):
    restaurantId: int
    payoutScheduleId: int
    businessDate: str
    items: List[ApprovalOverrideItem]

class ApprovalFinalizePayload(BaseModel):
    restaurantId: int
    payoutScheduleId: int
    businessDate: str
    userId: int

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
                SELECT
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
                    DATE_FORMAT(
                        MIN(
                            STR_TO_DATE(
                                SUBSTRING(REPLACE(ST.INDATE, 'T', ' '), 1, 19),
                                '%%Y-%%m-%%d %%H:%%i:%%s'
                            )
                        ),
                        '%%l:%%i %%p'
                    ) AS INDATE,
                    DATE_FORMAT(
                        MAX(
                            STR_TO_DATE(
                                SUBSTRING(REPLACE(ST.OUTDATE, 'T', ' '), 1, 19),
                                '%%Y-%%m-%%d %%H:%%i:%%s'
                            )
                        ),
                        '%%l:%%i %%p'
                    ) AS OUTDATE,
                    CASE WHEN PRC.PAYOUT_RECEIVERID IS NOT NULL THEN 'Yes' ELSE 'No' END AS IS_CONTRIBUTOR,
                    SUM(ST.REGULARHOURS + ST.OVERTIMEHOURS) AS HOURS_WORKED
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
                    AND STR_TO_DATE(
                        SUBSTRING(REPLACE(ST.INDATE, 'T', ' '), 1, 19),
                        '%%Y-%%m-%%d %%H:%%i:%%s'
                    ) BETWEEN
                        CAST(
                            TIMESTAMP(
                                STR_TO_DATE(REPLACE(ST.BUSINESSDATE, '-', ''), '%%Y%%m%%d'),
                                GPS.START_TIME
                            ) AS DATETIME(6)
                        )
                        AND
                        CAST(
                            TIMESTAMP(
                                STR_TO_DATE(REPLACE(ST.BUSINESSDATE, '-', ''), '%%Y%%m%%d'),
                                GPS.END_TIME
                            ) AS DATETIME(6)
                        )
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
                GROUP BY
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
                    ST.RESTAURANTGUID,
                    ST.EMPLOYEEGUID,
                    EMPLOYEE_NAME,
                    ST.JOBID,
                    SJ.JOBTITLE,
                    PR.PAYOUT_RECEIVERID,
                    PR.PAYOUT_PERCENTAGE,
                    PRC.PAYOUT_RECEIVERID
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
                    SUM(COALESCE(SAO.GRATUITYAMOUNT, 0)) AS TOTAL_GRATUITY,
                    COUNT(DISTINCT SAO.ORDERGUID) AS ORDER_COUNT
                FROM GETPAYOUT_EMPLOYEES_DATA GED
                LEFT JOIN GRATLYDB.SRC_ALLORDERS SAO
                    ON SAO.RESTAURANTGUID = GED.RESTAURANTGUID
                    AND SAO.EMPLOYEEGUID = GED.EMPLOYEEGUID
                    AND (
                        SAO.VOIDED IS NULL
                        OR SAO.VOIDED <> '1'
                    )
                    AND STR_TO_DATE(
                        SUBSTRING(REPLACE(SAO.OPENEDDATE, 'T', ' '), 1, 19),
                        '%%Y-%%m-%%d %%H:%%i:%%s'
                    ) BETWEEN GED.START_DATETIME AND GED.END_DATETIME
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
        job_weighted_rows = list(cursor.fetchall())

        cursor.execute(
            """
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
                WHERE PS.RESTAURANTID = %s
                  AND PS.PAYOUT_RULE_ID = '2'
            ),
            GETPAYOUT_EMPLOYEES_DATA AS (
                SELECT
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
                    MIN(ST.JOBID) AS JOBID,
                    MIN(SJ.JOBTITLE) AS JOBTITLE,
                    DATE_FORMAT(
                        MIN(
                            STR_TO_DATE(
                                SUBSTRING(REPLACE(ST.INDATE, 'T', ' '), 1, 19),
                                '%%Y-%%m-%%d %%H:%%i:%%s'
                            )
                        ),
                        '%%l:%%i %%p'
                    ) AS INDATE,
                    DATE_FORMAT(
                        MAX(
                            STR_TO_DATE(
                                SUBSTRING(REPLACE(ST.OUTDATE, 'T', ' '), 1, 19),
                                '%%Y-%%m-%%d %%H:%%i:%%s'
                            )
                        ),
                        '%%l:%%i %%p'
                    ) AS OUTDATE,
                    SUM(ST.REGULARHOURS + ST.OVERTIMEHOURS) AS HOURS_WORKED
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
                    AND STR_TO_DATE(
                        SUBSTRING(REPLACE(ST.INDATE, 'T', ' '), 1, 19),
                        '%%Y-%%m-%%d %%H:%%i:%%s'
                    ) BETWEEN
                        CAST(
                            TIMESTAMP(
                                STR_TO_DATE(REPLACE(ST.BUSINESSDATE, '-', ''), '%%Y%%m%%d'),
                                GPS.START_TIME
                            ) AS DATETIME(6)
                        )
                        AND
                        CAST(
                            TIMESTAMP(
                                STR_TO_DATE(REPLACE(ST.BUSINESSDATE, '-', ''), '%%Y%%m%%d'),
                                GPS.END_TIME
                            ) AS DATETIME(6)
                        )
                JOIN GRATLYDB.SRC_EMPLOYEES SE
                    ON SE.EMPLOYEEGUID = ST.EMPLOYEEGUID
                LEFT JOIN GRATLYDB.SRC_JOBS SJ
                    ON SJ.JOBGUID = ST.JOBID
                GROUP BY
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
                    ST.RESTAURANTGUID,
                    ST.EMPLOYEEGUID,
                    EMPLOYEE_NAME
            ),
            GET_ALL_SALES AS (
                SELECT
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
                    GED.INDATE,
                    GED.OUTDATE,
                    GED.HOURS_WORKED,
                    SUM(COALESCE(SAO.TOTALAMOUNT, 0)) AS TOTAL_SALES,
                    SUM(COALESCE(SAO.TOTALAMOUNT, 0)) - (
                        SUM(COALESCE(SAO.TAXAMOUNT, 0))
                        + SUM(COALESCE(SAO.TIPAMOUNT, 0))
                        + SUM(COALESCE(SAO.GRATUITYAMOUNT, 0))
                    ) AS NET_SALES,
                    SUM(COALESCE(SAO.TIPAMOUNT, 0)) AS TOTAL_TIPS,
                    SUM(COALESCE(SAO.GRATUITYAMOUNT, 0)) AS TOTAL_GRATUITY,
                    COUNT(DISTINCT SAO.ORDERGUID) AS ORDER_COUNT
                FROM GETPAYOUT_EMPLOYEES_DATA GED
                LEFT JOIN GRATLYDB.SRC_ALLORDERS SAO
                    ON SAO.RESTAURANTGUID = GED.RESTAURANTGUID
                    AND SAO.EMPLOYEEGUID = GED.EMPLOYEEGUID
                    AND (
                        SAO.VOIDED IS NULL
                        OR SAO.VOIDED <> '1'
                    )
                    AND STR_TO_DATE(
                        SUBSTRING(REPLACE(SAO.OPENEDDATE, 'T', ' '), 1, 19),
                        '%%Y-%%m-%%d %%H:%%i:%%s'
                    ) BETWEEN GED.START_DATETIME AND GED.END_DATETIME
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
                    GED.INDATE,
                    GED.OUTDATE,
                    GED.HOURS_WORKED
            ),
            GET_TOTALS AS (
                SELECT
                    PAYOUT_SCHEDULEID,
                    RESTAURANTID,
                    BUSINESSDATE,
                    SUM(TOTAL_TIPS) AS OVERALL_TIPS,
                    SUM(TOTAL_GRATUITY) AS OVERALL_GRATUITY
                FROM GET_ALL_SALES
                GROUP BY PAYOUT_SCHEDULEID, RESTAURANTID, BUSINESSDATE
            ),
            EMPLOYEE_COUNTS AS (
                SELECT
                    PAYOUT_SCHEDULEID,
                    RESTAURANTID,
                    BUSINESSDATE,
                    COUNT(DISTINCT EMPLOYEEGUID) AS employee_count
                FROM GET_ALL_SALES
                GROUP BY PAYOUT_SCHEDULEID, RESTAURANTID, BUSINESSDATE
            )
            SELECT
                GAS.PAYOUT_SCHEDULEID,
                GAS.RESTAURANTID,
                GAS.payout_schedule_name,
                GAS.START_DAY,
                GAS.END_DAY,
                GAS.START_TIME,
                GAS.END_TIME,
                GAS.START_DATETIME,
                GAS.END_DATETIME,
                GAS.PAYOUT_RULE_ID,
                GAS.PREPAYOUT_FLAG,
                GAS.BUSINESSDATE,
                GAS.BUSINESS_DATE_VALUE,
                GAS.RESTAURANTGUID,
                GAS.EMPLOYEEGUID,
                GAS.EMPLOYEE_NAME,
                GAS.JOBID,
                GAS.JOBTITLE,
                GAS.JOBTITLE AS PAYOUT_RECEIVERID,
                0 AS PAYOUT_PERCENTAGE,
                GAS.INDATE,
                GAS.OUTDATE,
                'No' AS IS_CONTRIBUTOR,
                GAS.HOURS_WORKED,
                GAS.TOTAL_SALES,
                GAS.NET_SALES,
                GAS.TOTAL_TIPS,
                GAS.TOTAL_GRATUITY,
                GAS.ORDER_COUNT,
                GT.OVERALL_TIPS,
                GT.OVERALL_GRATUITY,
                ROUND(
                    CASE
                        WHEN EC.employee_count > 0 THEN (GT.OVERALL_TIPS / EC.employee_count)
                        ELSE 0
                    END,
                    2
                ) AS PAYOUT_TIPS,
                ROUND(
                    CASE
                        WHEN EC.employee_count > 0 THEN (GT.OVERALL_GRATUITY / EC.employee_count)
                        ELSE 0
                    END,
                    2
                ) AS PAYOUT_GRATUITY
            FROM GET_ALL_SALES GAS
            JOIN GET_TOTALS GT
                ON GT.PAYOUT_SCHEDULEID = GAS.PAYOUT_SCHEDULEID
                AND GT.RESTAURANTID = GAS.RESTAURANTID
                AND GT.BUSINESSDATE = GAS.BUSINESSDATE
            JOIN EMPLOYEE_COUNTS EC
                ON EC.PAYOUT_SCHEDULEID = GAS.PAYOUT_SCHEDULEID
                AND EC.RESTAURANTID = GAS.RESTAURANTID
                AND EC.BUSINESSDATE = GAS.BUSINESSDATE
            ORDER BY GAS.PAYOUT_SCHEDULEID, GAS.EMPLOYEE_NAME
            """,
            (restaurant_id,),
        )
        equal_payout_rows = list(cursor.fetchall())

        cursor.execute(
            """
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
                WHERE PS.RESTAURANTID = %s
                  AND PS.PAYOUT_RULE_ID = '3'
            ),
            GETPAYOUT_EMPLOYEES_DATA AS (
                SELECT
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
                    MIN(ST.JOBID) AS JOBID,
                    MIN(SJ.JOBTITLE) AS JOBTITLE,
                    DATE_FORMAT(
                        MIN(
                            STR_TO_DATE(
                                SUBSTRING(REPLACE(ST.INDATE, 'T', ' '), 1, 19),
                                '%%Y-%%m-%%d %%H:%%i:%%s'
                            )
                        ),
                        '%%l:%%i %%p'
                    ) AS INDATE,
                    DATE_FORMAT(
                        MAX(
                            STR_TO_DATE(
                                SUBSTRING(REPLACE(ST.OUTDATE, 'T', ' '), 1, 19),
                                '%%Y-%%m-%%d %%H:%%i:%%s'
                            )
                        ),
                        '%%l:%%i %%p'
                    ) AS OUTDATE,
                    SUM(ST.REGULARHOURS + ST.OVERTIMEHOURS) AS HOURS_WORKED
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
                    AND STR_TO_DATE(
                        SUBSTRING(REPLACE(ST.INDATE, 'T', ' '), 1, 19),
                        '%%Y-%%m-%%d %%H:%%i:%%s'
                    ) BETWEEN
                        CAST(
                            TIMESTAMP(
                                STR_TO_DATE(REPLACE(ST.BUSINESSDATE, '-', ''), '%%Y%%m%%d'),
                                GPS.START_TIME
                            ) AS DATETIME(6)
                        )
                        AND
                        CAST(
                            TIMESTAMP(
                                STR_TO_DATE(REPLACE(ST.BUSINESSDATE, '-', ''), '%%Y%%m%%d'),
                                GPS.END_TIME
                            ) AS DATETIME(6)
                        )
                JOIN GRATLYDB.SRC_EMPLOYEES SE
                    ON SE.EMPLOYEEGUID = ST.EMPLOYEEGUID
                LEFT JOIN GRATLYDB.SRC_JOBS SJ
                    ON SJ.JOBGUID = ST.JOBID
                GROUP BY
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
                    ST.RESTAURANTGUID,
                    ST.EMPLOYEEGUID,
                    EMPLOYEE_NAME
            ),
            GET_ALL_SALES AS (
                SELECT
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
                    GED.INDATE,
                    GED.OUTDATE,
                    GED.HOURS_WORKED,
                    SUM(COALESCE(SAO.TOTALAMOUNT, 0)) AS TOTAL_SALES,
                    SUM(COALESCE(SAO.TOTALAMOUNT, 0)) - (
                        SUM(COALESCE(SAO.TAXAMOUNT, 0))
                        + SUM(COALESCE(SAO.TIPAMOUNT, 0))
                        + SUM(COALESCE(SAO.GRATUITYAMOUNT, 0))
                    ) AS NET_SALES,
                    SUM(COALESCE(SAO.TIPAMOUNT, 0)) AS TOTAL_TIPS,
                    SUM(COALESCE(SAO.GRATUITYAMOUNT, 0)) AS TOTAL_GRATUITY,
                    COUNT(DISTINCT SAO.ORDERGUID) AS ORDER_COUNT
                FROM GETPAYOUT_EMPLOYEES_DATA GED
                LEFT JOIN GRATLYDB.SRC_ALLORDERS SAO
                    ON SAO.RESTAURANTGUID = GED.RESTAURANTGUID
                    AND SAO.EMPLOYEEGUID = GED.EMPLOYEEGUID
                    AND (
                        SAO.VOIDED IS NULL
                        OR SAO.VOIDED <> '1'
                    )
                    AND STR_TO_DATE(
                        SUBSTRING(REPLACE(SAO.OPENEDDATE, 'T', ' '), 1, 19),
                        '%%Y-%%m-%%d %%H:%%i:%%s'
                    ) BETWEEN GED.START_DATETIME AND GED.END_DATETIME
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
                    GED.INDATE,
                    GED.OUTDATE,
                    GED.HOURS_WORKED
            ),
            GET_TOTALS AS (
                SELECT
                    PAYOUT_SCHEDULEID,
                    RESTAURANTID,
                    BUSINESSDATE,
                    SUM(TOTAL_TIPS) AS OVERALL_TIPS,
                    SUM(TOTAL_GRATUITY) AS OVERALL_GRATUITY
                FROM GET_ALL_SALES
                GROUP BY PAYOUT_SCHEDULEID, RESTAURANTID, BUSINESSDATE
            ),
            HOUR_TOTALS AS (
                SELECT
                    PAYOUT_SCHEDULEID,
                    RESTAURANTID,
                    BUSINESSDATE,
                    SUM(HOURS_WORKED) AS total_hours
                FROM GET_ALL_SALES
                GROUP BY PAYOUT_SCHEDULEID, RESTAURANTID, BUSINESSDATE
            )
            SELECT
                GAS.PAYOUT_SCHEDULEID,
                GAS.RESTAURANTID,
                GAS.payout_schedule_name,
                GAS.START_DAY,
                GAS.END_DAY,
                GAS.START_TIME,
                GAS.END_TIME,
                GAS.START_DATETIME,
                GAS.END_DATETIME,
                GAS.PAYOUT_RULE_ID,
                GAS.PREPAYOUT_FLAG,
                GAS.BUSINESSDATE,
                GAS.BUSINESS_DATE_VALUE,
                GAS.RESTAURANTGUID,
                GAS.EMPLOYEEGUID,
                GAS.EMPLOYEE_NAME,
                GAS.JOBID,
                GAS.JOBTITLE,
                GAS.JOBTITLE AS PAYOUT_RECEIVERID,
                0 AS PAYOUT_PERCENTAGE,
                GAS.INDATE,
                GAS.OUTDATE,
                'No' AS IS_CONTRIBUTOR,
                GAS.HOURS_WORKED,
                GAS.TOTAL_SALES,
                GAS.NET_SALES,
                GAS.TOTAL_TIPS,
                GAS.TOTAL_GRATUITY,
                GAS.ORDER_COUNT,
                GT.OVERALL_TIPS,
                GT.OVERALL_GRATUITY,
                ROUND(
                    CASE
                        WHEN HT.total_hours > 0 THEN (GT.OVERALL_TIPS * (GAS.HOURS_WORKED / HT.total_hours))
                        ELSE 0
                    END,
                    2
                ) AS PAYOUT_TIPS,
                ROUND(
                    CASE
                        WHEN HT.total_hours > 0 THEN (GT.OVERALL_GRATUITY * (GAS.HOURS_WORKED / HT.total_hours))
                        ELSE 0
                    END,
                    2
                ) AS PAYOUT_GRATUITY
            FROM GET_ALL_SALES GAS
            JOIN GET_TOTALS GT
                ON GT.PAYOUT_SCHEDULEID = GAS.PAYOUT_SCHEDULEID
                AND GT.RESTAURANTID = GAS.RESTAURANTID
                AND GT.BUSINESSDATE = GAS.BUSINESSDATE
            JOIN HOUR_TOTALS HT
                ON HT.PAYOUT_SCHEDULEID = GAS.PAYOUT_SCHEDULEID
                AND HT.RESTAURANTID = GAS.RESTAURANTID
                AND HT.BUSINESSDATE = GAS.BUSINESSDATE
            ORDER BY GAS.PAYOUT_SCHEDULEID, GAS.EMPLOYEE_NAME
            """,
            (restaurant_id,),
        )
        hour_based_rows = list(cursor.fetchall())

        rows = job_weighted_rows + equal_payout_rows + hour_based_rows
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
        schedule_contributors: Dict[str, Dict[str, dict]] = {}
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
                    "restaurantGuid": row["RESTAURANTGUID"],
                    "prepayoutFlag": bool(row["PREPAYOUT_FLAG"]),
                    "totalSales": 0.0,
                    "netSales": 0.0,
                    "totalTips": 0.0,
                    "totalGratuity": 0.0,
                    "orderCount": 0,
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
            schedule_entry["orderCount"] += int(row["ORDER_COUNT"] or 0)
            contributor_key = "|".join(
                [
                    str(row["EMPLOYEEGUID"] or ""),
                    str(row["JOBTITLE"] or ""),
                    str(row["IS_CONTRIBUTOR"] or ""),
                    str(row["PAYOUT_RECEIVERID"] or ""),
                ]
            )
            schedule_contributors.setdefault(schedule_key, {})
            existing = schedule_contributors[schedule_key].get(contributor_key)
            if not existing:
                schedule_contributors[schedule_key][contributor_key] = {
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
                    "orderCount": int(row["ORDER_COUNT"] or 0),
                }
            else:
                existing["hoursWorked"] += float(row["HOURS_WORKED"] or 0)
                existing["totalSales"] += float(row["TOTAL_SALES"] or 0)
                existing["netSales"] += float(row["NET_SALES"] or 0)
                existing["totalTips"] += float(row["TOTAL_TIPS"] or 0)
                existing["totalGratuity"] += float(row["TOTAL_GRATUITY"] or 0)
                existing["overallTips"] += float(row["OVERALL_TIPS"] or 0)
                existing["overallGratuity"] += float(row["OVERALL_GRATUITY"] or 0)
                existing["payoutTips"] += float(row["PAYOUT_TIPS"] or 0)
                existing["payoutGratuity"] += float(row["PAYOUT_GRATUITY"] or 0)
                existing["orderCount"] += int(row["ORDER_COUNT"] or 0)

        for schedule_key, schedule in schedule_map.items():
            contributors = schedule_contributors.get(schedule_key, {})
            if not contributors:
                continue
            restaurant_guid = schedule.get("restaurantGuid")
            business_date = schedule.get("businessDate")
            start_time = schedule.get("startTime")
            end_time = schedule.get("endTime")
            if not restaurant_guid or not business_date or not start_time or not end_time:
                continue
            employee_guids = [
                entry["employeeGuid"]
                for entry in contributors.values()
                if entry.get("employeeGuid")
            ]
            if not employee_guids:
                continue
            placeholders = ", ".join(["%s"] * len(employee_guids))
            cursor.execute(
                f"""
                SELECT
                    EMPLOYEEGUID AS employee_guid,
                    COUNT(*) AS order_count
                FROM GRATLYDB.SRC_ALLORDERS
                WHERE RESTAURANTGUID = %s
                  AND EMPLOYEEGUID IN ({placeholders})
                  AND (VOIDED IS NULL OR VOIDED <> '1')
                  AND STR_TO_DATE(
                        SUBSTRING(REPLACE(OPENEDDATE, 'T', ' '), 1, 19),
                        '%%Y-%%m-%%d %%H:%%i:%%s'
                      )
                      BETWEEN CAST(
                          TIMESTAMP(
                              STR_TO_DATE(REPLACE(%s, '-', ''), '%%Y%%m%%d'),
                              %s
                          ) AS DATETIME(6)
                      )
                      AND CAST(
                          TIMESTAMP(
                              STR_TO_DATE(REPLACE(%s, '-', ''), '%%Y%%m%%d'),
                              %s
                          ) AS DATETIME(6)
                      )
                GROUP BY EMPLOYEEGUID
                """,
                (
                    restaurant_guid,
                    *employee_guids,
                    business_date,
                    start_time,
                    business_date,
                    end_time,
                ),
            )
            order_map = {row["employee_guid"]: int(row["order_count"] or 0) for row in cursor.fetchall()}
            for entry in contributors.values():
                employee_guid = entry.get("employeeGuid")
                if employee_guid:
                    entry["orderCount"] = order_map.get(employee_guid, 0)

            cursor.execute(
                f"""
                SELECT
                    EMPLOYEEGUID AS employee_guid,
                    SUM(REGULARHOURS + OVERTIMEHOURS) AS hours_worked
                FROM GRATLYDB.SRC_TIMEENTRIES
                WHERE RESTAURANTGUID = %s
                  AND EMPLOYEEGUID IN ({placeholders})
                  AND STR_TO_DATE(
                        SUBSTRING(REPLACE(INDATE, 'T', ' '), 1, 19),
                        '%%Y-%%m-%%d %%H:%%i:%%s'
                      )
                      BETWEEN CAST(
                          TIMESTAMP(
                              STR_TO_DATE(REPLACE(%s, '-', ''), '%%Y%%m%%d'),
                              %s
                          ) AS DATETIME(6)
                      )
                      AND CAST(
                          TIMESTAMP(
                              STR_TO_DATE(REPLACE(%s, '-', ''), '%%Y%%m%%d'),
                              %s
                          ) AS DATETIME(6)
                      )
                GROUP BY EMPLOYEEGUID
                """,
                (
                    restaurant_guid,
                    *employee_guids,
                    business_date,
                    start_time,
                    business_date,
                    end_time,
                ),
            )
            hours_map = {row["employee_guid"]: float(row["hours_worked"] or 0) for row in cursor.fetchall()}
            for entry in contributors.values():
                employee_guid = entry.get("employeeGuid")
                if employee_guid:
                    entry["hoursWorked"] = hours_map.get(employee_guid, 0)

        overrides_map: Dict[str, list] = {}
        approved_map: Dict[str, bool] = {}
        schedule_keys = [
            (item["payoutScheduleId"], item["businessDate"])
            for item in schedule_map.values()
            if item.get("businessDate")
        ]
        if schedule_keys:
            schedule_ids_for_override = list({item[0] for item in schedule_keys})
            business_dates_for_override = list({item[1] for item in schedule_keys})
            cursor.execute(
                f"""
                SELECT
                    PAYOUT_APPROVALID AS approval_id,
                    PAYOUT_SCHEDULEID AS payout_schedule_id,
                    BUSINESSDATE AS business_date,
                    IS_APPROVED AS is_approved
                FROM GRATLYDB.PAYOUT_APPROVAL
                WHERE RESTAURANTID = %s
                  AND PAYOUT_SCHEDULEID IN ({", ".join(["%s"] * len(schedule_ids_for_override))})
                  AND BUSINESSDATE IN ({", ".join(["%s"] * len(business_dates_for_override))})
                  AND IS_APPROVED = 0
                """,
                (restaurant_id, *schedule_ids_for_override, *business_dates_for_override),
            )
            approval_rows = cursor.fetchall()
            approval_ids = []
            for row in approval_rows:
                key = f"{row['payout_schedule_id']}-{row['business_date']}"
                approved_map[key] = bool(int(row["is_approved"] or 0))
                approval_ids.append(row["approval_id"])

            if approval_ids:
                cursor.execute(
                    f"""
                    SELECT
                        pa.PAYOUT_SCHEDULEID AS payout_schedule_id,
                        pa.BUSINESSDATE AS business_date,
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
                    WHERE pai.PAYOUT_APPROVALID IN ({", ".join(["%s"] * len(approval_ids))})
                    """,
                    tuple(approval_ids),
                )
                for row in cursor.fetchall():
                    key = f"{row['payout_schedule_id']}-{row['business_date']}"
                    overrides_map.setdefault(key, []).append(row)

        for schedule in schedule_map.values():
            schedule_key = f"{schedule['payoutScheduleId']}-{schedule['businessDate']}"
            schedule["isApproved"] = approved_map.get(schedule_key, False)
            if schedule_key in overrides_map:
                items = overrides_map[schedule_key]
                contributor_lookup = schedule_contributors.get(schedule_key, {})
                schedule["contributors"] = [
                    {
                        "employeeGuid": item["employee_guid"],
                        "employeeName": item["employee_name"],
                        "jobTitle": item["job_title"],
                        "businessDate": schedule["businessDate"],
                        "inTime": contributor_lookup.get(
                            "|".join(
                                [
                                    str(item["employee_guid"] or ""),
                                    str(item["job_title"] or ""),
                                    str(item["is_contributor"] or ""),
                                    str(item["payout_receiver_id"] or ""),
                                ]
                            ),
                            {},
                        ).get("inTime"),
                        "outTime": contributor_lookup.get(
                            "|".join(
                                [
                                    str(item["employee_guid"] or ""),
                                    str(item["job_title"] or ""),
                                    str(item["is_contributor"] or ""),
                                    str(item["payout_receiver_id"] or ""),
                                ]
                            ),
                            {},
                        ).get("outTime"),
                        "hoursWorked": contributor_lookup.get(
                            "|".join(
                                [
                                    str(item["employee_guid"] or ""),
                                    str(item["job_title"] or ""),
                                    str(item["is_contributor"] or ""),
                                    str(item["payout_receiver_id"] or ""),
                                ]
                            ),
                            {},
                        ).get("hoursWorked", 0),
                        "orderCount": contributor_lookup.get(
                            "|".join(
                                [
                                    str(item["employee_guid"] or ""),
                                    str(item["job_title"] or ""),
                                    str(item["is_contributor"] or ""),
                                    str(item["payout_receiver_id"] or ""),
                                ]
                            ),
                            {},
                        ).get("orderCount", 0),
                        "orderCount": contributor_lookup.get(
                            "|".join(
                                [
                                    str(item["employee_guid"] or ""),
                                    str(item["job_title"] or ""),
                                    str(item["is_contributor"] or ""),
                                    str(item["payout_receiver_id"] or ""),
                                ]
                            ),
                            {},
                        ).get("orderCount", 0),
                        "isContributor": item["is_contributor"],
                        "payoutReceiverId": item["payout_receiver_id"],
                        "payoutPercentage": float(item["payout_percentage"] or 0),
                        "totalSales": float(item["total_sales"] or 0),
                        "netSales": float(item["net_sales"] or 0),
                        "totalTips": float(item["total_tips"] or 0),
                        "totalGratuity": float(item["total_gratuity"] or 0),
                        "overallTips": float(item["overall_tips"] or 0),
                        "overallGratuity": float(item["overall_gratuity"] or 0),
                        "payoutTips": float(item["payout_tips"] or 0),
                        "payoutGratuity": float(item["payout_gratuity"] or 0),
                    }
                    for item in items
                ]
                schedule["totalSales"] = round(sum(item["total_sales"] or 0 for item in items), 2)
                schedule["netSales"] = round(sum(item["net_sales"] or 0 for item in items), 2)
                schedule["totalTips"] = round(sum(item["total_tips"] or 0 for item in items), 2)
                schedule["totalGratuity"] = round(sum(item["total_gratuity"] or 0 for item in items), 2)
                schedule["contributorCount"] = sum(
                    1 for item in items if (item["is_contributor"] or "").lower() == "yes"
                )
                schedule["receiverCount"] = sum(
                    1 for item in items if (item["is_contributor"] or "").lower() == "no"
                )
            else:
                schedule["totalSales"] = round(schedule["totalSales"], 2)
                schedule["netSales"] = round(schedule["netSales"], 2)
                schedule["totalTips"] = round(schedule["totalTips"], 2)
                schedule["totalGratuity"] = round(schedule["totalGratuity"], 2)
                schedule["contributors"] = list(
                    schedule_contributors.get(schedule_key, {}).values()
                )
                if str(schedule.get("payoutRuleId")) == "2":
                    schedule["contributorCount"] = 0
                    schedule["receiverCount"] = len(schedule["contributors"])

        schedules = list(schedule_map.values())
        schedules = [schedule for schedule in schedules if not schedule.get("isApproved")]
        return {"schedules": schedules}
    except pymysql.MySQLError as err:
        raise HTTPException(status_code=500, detail=f"Error fetching approvals data: {err}")
    finally:
        cursor.close()

@router.post("/approvals/approve")
def approve_payout_schedule(payload: ApprovalFinalizePayload):
    cursor = _get_cursor(dictionary=True)
    conn = cursor.connection
    try:
        cursor.execute(
            """
            SELECT PAYOUT_APPROVALID AS approval_id, IS_APPROVED AS is_approved
            FROM GRATLYDB.PAYOUT_APPROVAL
            WHERE RESTAURANTID = %s
              AND PAYOUT_SCHEDULEID = %s
              AND BUSINESSDATE = %s
            LIMIT 1
            """,
            (payload.restaurantId, payload.payoutScheduleId, payload.businessDate),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Approval record not found")
        if int(row.get("is_approved") or 0) == 1:
            return {
                "success": True,
                "approval_id": row["approval_id"],
                "is_approved": True,
                "already_approved": True,
            }

        cursor.execute(
            """
            UPDATE GRATLYDB.PAYOUT_APPROVAL
            SET IS_APPROVED = 1,
                APPROVED_AT = NOW()
            WHERE PAYOUT_APPROVALID = %s
            """,
            (row["approval_id"],),
        )
        cursor.execute(
            """
            SELECT
                COALESCE(SUM(CASE WHEN PREPAYOUTOPTION = 0 THEN PREPAYOUT_VALUE ELSE 0 END), 0) AS percentage_total,
                COALESCE(SUM(CASE WHEN PREPAYOUTOPTION = 1 THEN PREPAYOUT_VALUE ELSE 0 END), 0) AS fixed_total
            FROM GRATLYDB.PREPAYOUT
            WHERE PAYOUT_SCHEDULEID = %s
            """,
            (payload.payoutScheduleId,),
        )
        prepayout_row = cursor.fetchone()
        prepayout_percentage = float(prepayout_row["percentage_total"] or 0)
        prepayout_fixed = float(prepayout_row["fixed_total"] or 0)
        prepayout_rate = prepayout_percentage / 100 if prepayout_percentage else 0.0

        cursor.execute(
            """
            INSERT INTO GRATLYDB.PAYOUT_FINAL (
                PAYOUT_APPROVALID,
                RESTAURANTID,
                PAYOUT_SCHEDULEID,
                BUSINESSDATE,
                EMPLOYEEGUID,
                EMPLOYEE_NAME,
                JOBTITLE,
                IS_CONTRIBUTOR,
                PAYOUT_RECEIVER_ID,
                PAYOUT_PERCENTAGE,
                TOTAL_SALES,
                NET_SALES,
                TOTAL_TIPS,
                TOTAL_GRATUITY,
                OVERALL_TIPS,
                OVERALL_GRATUITY,
                PAYOUT_TIPS,
                PAYOUT_GRATUITY,
                NET_PAYOUT,
                PREPAYOUT_DEDUCTION,
                APPROVED_AT,
                DEBIT_STATUS,
                PAYOUT_STATUS,
                APPROVED_USERID
            )
            SELECT
                PAYOUT_APPROVALID,
                RESTAURANTID,
                PAYOUT_SCHEDULEID,
                BUSINESSDATE,
                EMPLOYEEGUID,
                EMPLOYEE_NAME,
                JOBTITLE,
                IS_CONTRIBUTOR,
                PAYOUT_RECEIVER_ID,
                PAYOUT_PERCENTAGE,
                TOTAL_SALES,
                NET_SALES,
                TOTAL_TIPS,
                TOTAL_GRATUITY,
                OVERALL_TIPS,
                OVERALL_GRATUITY,
                PAYOUT_TIPS,
                PAYOUT_GRATUITY,
                CASE
                    WHEN NET_PAYOUT > 0 THEN ROUND(GREATEST(0, NET_PAYOUT - (NET_PAYOUT * %s) - %s), 2)
                    ELSE NET_PAYOUT
                END AS NET_PAYOUT,
                CASE
                    WHEN NET_PAYOUT > 0 THEN ROUND(LEAST(NET_PAYOUT, (NET_PAYOUT * %s) + %s), 2)
                    ELSE 0
                END AS PREPAYOUT_DEDUCTION,
                NOW() AS APPROVED_AT,
                'not_debited' AS DEBIT_STATUS,
                'not_paid' AS PAYOUT_STATUS,
                %s
            FROM GRATLYDB.PAYOUT_APPROVAL_ITEMS
            WHERE PAYOUT_APPROVALID = %s
            """,
            (
                prepayout_rate,
                prepayout_fixed,
                prepayout_rate,
                prepayout_fixed,
                payload.userId,
                row["approval_id"],
            ),
        )
        conn.commit()
        return {
            "success": True,
            "approval_id": row["approval_id"],
            "is_approved": True,
            "already_approved": False,
        }
    except pymysql.MySQLError as err:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Error approving payout: {err}")
    finally:
        cursor.close()

@router.post("/approvals/overrides")
def save_approval_overrides(payload: ApprovalOverridePayload):
    cursor = _get_cursor(dictionary=True)
    conn = cursor.connection
    try:
        cursor.execute(
            """
            SELECT PAYOUT_APPROVALID AS approval_id, IS_APPROVED AS is_approved
            FROM GRATLYDB.PAYOUT_APPROVAL
            WHERE RESTAURANTID = %s
              AND PAYOUT_SCHEDULEID = %s
              AND BUSINESSDATE = %s
            LIMIT 1
            """,
            (payload.restaurantId, payload.payoutScheduleId, payload.businessDate),
        )
        row = cursor.fetchone()
        approval_id = None
        if row:
            if int(row.get("is_approved") or 0) == 1:
                raise HTTPException(status_code=400, detail="Payout schedule already approved")
            approval_id = row["approval_id"]
            cursor.execute(
                """
                UPDATE GRATLYDB.PAYOUT_APPROVAL
                SET IS_APPROVED = 0
                WHERE PAYOUT_APPROVALID = %s
                """,
                (approval_id,),
            )
        else:
            cursor.execute(
                """
                INSERT INTO GRATLYDB.PAYOUT_APPROVAL (
                    RESTAURANTID,
                    PAYOUT_SCHEDULEID,
                    BUSINESSDATE,
                    IS_APPROVED
                )
                VALUES (%s, %s, %s, 0)
                """,
                (payload.restaurantId, payload.payoutScheduleId, payload.businessDate),
            )
            approval_id = cursor.lastrowid

        cursor.execute(
            """
            DELETE FROM GRATLYDB.PAYOUT_APPROVAL_ITEMS
            WHERE PAYOUT_APPROVALID = %s
            """,
            (approval_id,),
        )

        if payload.items:
            rows = [
                (
                    approval_id,
                    payload.restaurantId,
                    payload.payoutScheduleId,
                    payload.businessDate,
                    item.employeeGuid,
                    item.employeeName,
                    item.jobTitle,
                    item.isContributor,
                    item.payoutReceiverId,
                    item.payoutPercentage,
                    item.totalSales,
                    item.netSales,
                    item.totalTips,
                    item.totalGratuity,
                    item.overallTips,
                    item.overallGratuity,
                    item.payoutTips,
                    item.payoutGratuity,
                    item.netPayout,
                )
                for item in payload.items
            ]
            cursor.executemany(
                """
                INSERT INTO GRATLYDB.PAYOUT_APPROVAL_ITEMS (
                    PAYOUT_APPROVALID,
                    RESTAURANTID,
                    PAYOUT_SCHEDULEID,
                    BUSINESSDATE,
                    EMPLOYEEGUID,
                    EMPLOYEE_NAME,
                    JOBTITLE,
                    IS_CONTRIBUTOR,
                    PAYOUT_RECEIVER_ID,
                    PAYOUT_PERCENTAGE,
                    TOTAL_SALES,
                    NET_SALES,
                    TOTAL_TIPS,
                    TOTAL_GRATUITY,
                    OVERALL_TIPS,
                    OVERALL_GRATUITY,
                    PAYOUT_TIPS,
                    PAYOUT_GRATUITY,
                    NET_PAYOUT
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                rows,
            )

        conn.commit()
        return {"success": True, "approval_id": approval_id}
    except pymysql.MySQLError as err:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Error saving approval overrides: {err}")
    finally:
        cursor.close()
