from fastapi import APIRouter, HTTPException
from typing import Dict, List, Optional
import pymysql
from pydantic import BaseModel
import logging

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

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
    prepayoutDeduction: Optional[float] = None
    payoutFee: Optional[float] = None

class ApprovalOverridePayload(BaseModel):
    restaurantId: int
    payoutScheduleId: int
    businessDate: str
    userId: int
    items: List[ApprovalOverrideItem]

class ApprovalFinalizePayload(BaseModel):
    restaurantId: int
    payoutScheduleId: int
    businessDate: str
    userId: int


class ApprovalSnapshotItem(BaseModel):
    employeeGuid: Optional[str] = None
    employeeName: Optional[str] = None
    jobTitle: Optional[str] = None
    fieldName: str
    currentValue: Optional[str] = None


class ApprovalSnapshotPayload(BaseModel):
    restaurantId: int
    payoutScheduleId: int
    businessDate: str
    userId: int
    items: List[ApprovalSnapshotItem]


# ============================================================================
# CALCULATION HELPER FUNCTIONS
# ============================================================================

def _calculate_contribution_pool(
    total_tips: float,
    total_gratuity: float,
    tip_trigger_pct: Optional[float],
    gratuity_trigger_pct: Optional[float]
) -> dict:
    """
    Step 1: Calculate contribution pool based on PAYOUTTRIGGER percentages.

    If PAYOUTTRIGGER_TIPS = 90% and PAYOUTTRIGGER_GRATUITY = 50%,
    then only 90% of tips and 50% of gratuity go into the pool.
    """
    tip_pct = tip_trigger_pct if tip_trigger_pct is not None else 100.0
    gratuity_pct = gratuity_trigger_pct if gratuity_trigger_pct is not None else 100.0

    contributed_tips = total_tips * (tip_pct / 100.0)
    contributed_gratuity = total_gratuity * (gratuity_pct / 100.0)

    return {
        "contributed_tips": round(contributed_tips, 2),
        "contributed_gratuity": round(contributed_gratuity, 2),
        "contribution_pool": round(contributed_tips + contributed_gratuity, 2),
        "tip_contribution_pct": tip_pct,
        "gratuity_contribution_pct": gratuity_pct,
    }


def _get_missing_role_percentage(receiver_roles: list, active_receivers: list) -> dict:
    """
    Step 2 (Rule 4 only): Find roles with no employees logged in and sum their percentages.
    These percentages go back to contributors proportionally.
    """
    # Get job titles of receivers who actually worked (have hours > 0)
    active_job_titles = set()
    for receiver in active_receivers:
        if receiver.get("hoursWorked", 0) > 0 or receiver.get("HOURS_WORKED", 0) > 0:
            job_title = receiver.get("jobTitle") or receiver.get("JOBTITLE")
            if job_title:
                active_job_titles.add(job_title.strip().lower())

    # Find missing roles and sum their percentages
    missing_roles = []
    missing_pct_total = 0.0
    for role in receiver_roles:
        receiver_id = role.get("receiverId") or role.get("PAYOUT_RECEIVERID")
        if not receiver_id:
            continue
        if receiver_id.strip().lower() not in active_job_titles:
            pct = float(role.get("payoutPercentage") or role.get("PAYOUT_PERCENTAGE") or 0)
            missing_roles.append({"receiverId": receiver_id, "percentage": pct})
            missing_pct_total += pct

    return {
        "missing_roles": missing_roles,
        "missing_percentage_total": round(missing_pct_total, 2),
    }


def _calculate_prepayout_per_person(cursor, payout_schedule_id: int, total_employees: int, contribution_pool: float) -> float:
    """
    Step 3: Pre-payout divided equally among ALL employees (contributors + receivers).

    PREPAYOUTOPTION: 0 = percentage of pool, 1 = fixed amount
    """
    if total_employees <= 0:
        return 0.0

    cursor.execute(
        """
        SELECT
            COALESCE(SUM(CASE WHEN PREPAYOUTOPTION = 0 THEN PREPAYOUT_VALUE ELSE 0 END), 0) AS percentage_total,
            COALESCE(SUM(CASE WHEN PREPAYOUTOPTION = 1 THEN PREPAYOUT_VALUE ELSE 0 END), 0) AS fixed_total
        FROM GRATLYDB.PREPAYOUT
        WHERE PAYOUT_SCHEDULEID = %s
        """,
        (payout_schedule_id,),
    )
    row = cursor.fetchone()

    percentage_total = float(row["percentage_total"] or 0)
    fixed_total = float(row["fixed_total"] or 0)

    # Calculate total pre-payout amount
    prepayout_from_percentage = contribution_pool * (percentage_total / 100.0) if percentage_total > 0 else 0.0
    total_prepayout = prepayout_from_percentage + fixed_total

    # Divide equally among all employees
    prepayout_per_person = total_prepayout / total_employees

    return round(prepayout_per_person, 2)


def _get_payout_fee_info(cursor, restaurant_id: int) -> dict:
    """
    Step 4: Get payout fee if PAYOUT_FEE_PAYER = 'employees'.
    """
    cursor.execute(
        """
        SELECT PAYOUT_FEE_PAYER, PAYOUT_FEE
        FROM GRATLYDB.SRC_ONBOARDING
        WHERE RESTAURANTID = %s
        LIMIT 1
        """,
        (restaurant_id,),
    )
    row = cursor.fetchone()

    if not row:
        return {"fee_payer": None, "fee_amount": 0.0, "applies_to_employees": False}

    fee_payer = row.get("PAYOUT_FEE_PAYER") or ""
    fee_amount_str = row.get("PAYOUT_FEE") or "0"

    try:
        fee_amount = float(fee_amount_str)
    except (ValueError, TypeError):
        fee_amount = 0.0

    applies_to_employees = fee_payer.lower().strip() == "employees"

    return {
        "fee_payer": fee_payer,
        "fee_amount": fee_amount,
        "applies_to_employees": applies_to_employees,
    }


def _apply_calculations_to_schedule(
    schedule: dict,
    contributors: list,
    cursor,
    restaurant_id: int,
) -> list:
    """
    Apply all calculation steps to a schedule's contributors/receivers.
    Returns updated contributor list with correct payout amounts.
    """
    payout_rule_id = str(schedule.get("payoutRuleId") or schedule.get("PAYOUT_RULE_ID") or "")
    payout_schedule_id = schedule.get("payoutScheduleId") or schedule.get("PAYOUT_SCHEDULEID")

    # Get trigger percentages
    tip_trigger_pct = schedule.get("payoutTriggerTips") or schedule.get("PAYOUTTRIGGER_TIPS")
    gratuity_trigger_pct = schedule.get("payoutTriggerGratuity") or schedule.get("PAYOUTTRIGGER_GRATUITY")

    # Separate contributors and receivers
    contributor_list = [c for c in contributors if (c.get("isContributor") or c.get("IS_CONTRIBUTOR") or "").lower() == "yes"]
    receiver_list = [c for c in contributors if (c.get("isContributor") or c.get("IS_CONTRIBUTOR") or "").lower() == "no"]

    # Calculate total tips and gratuity from contributors
    total_tips = sum(float(c.get("totalTips") or c.get("TOTAL_TIPS") or 0) for c in contributor_list)
    total_gratuity = sum(float(c.get("totalGratuity") or c.get("TOTAL_GRATUITY") or 0) for c in contributor_list)

    # Step 1: Calculate contribution pool
    pool_info = _calculate_contribution_pool(total_tips, total_gratuity, tip_trigger_pct, gratuity_trigger_pct)
    contribution_pool = pool_info["contribution_pool"]
    contributed_tips = pool_info["contributed_tips"]
    contributed_gratuity = pool_info["contributed_gratuity"]

    # Step 2: Handle missing roles (Rule 4 only)
    missing_role_info = {"missing_percentage_total": 0.0}
    receiver_roles = schedule.get("receiverRoles") or []
    if payout_rule_id == "4" and receiver_roles:
        missing_role_info = _get_missing_role_percentage(receiver_roles, receiver_list)

    # Step 3: Get payout fee info
    payout_fee_info = _get_payout_fee_info(cursor, restaurant_id)
    payout_fee = payout_fee_info["fee_amount"] if payout_fee_info["applies_to_employees"] else 0.0

    # Step 4: Calculate total receiver percentage (sum of active receiver percentages)
    # This matches the frontend's getReceiverPercentSum logic
    receiver_role_percentages = {}
    for role in receiver_roles:
        receiver_id = role.get("receiverId") or role.get("PAYOUT_RECEIVERID")
        if receiver_id:
            role_key = (receiver_id or "").strip().lower()
            receiver_role_percentages[role_key] = float(role.get("payoutPercentage") or role.get("PAYOUT_PERCENTAGE") or 0)

    # Count receivers per role (excluding manual receivers)
    receiver_role_counts = {}
    for receiver in receiver_list:
        hours = float(receiver.get("hoursWorked") or receiver.get("HOURS_WORKED") or 0)
        payout_pct = float(receiver.get("payoutPercentage") or receiver.get("PAYOUT_PERCENTAGE") or 0)
        total_tips_rcv = float(receiver.get("totalTips") or receiver.get("TOTAL_TIPS") or 0)
        total_grat_rcv = float(receiver.get("totalGratuity") or receiver.get("TOTAL_GRATUITY") or 0)
        in_time = receiver.get("inTime") or receiver.get("INDATE")
        out_time = receiver.get("outTime") or receiver.get("OUTDATE")
        # Check if manual receiver
        is_manual = payout_pct > 0 and total_tips_rcv == 0 and total_grat_rcv == 0 and in_time is None and out_time is None
        if is_manual:
            continue
        job_title = receiver.get("jobTitle") or receiver.get("JOBTITLE") or receiver.get("payoutReceiverId") or receiver.get("PAYOUT_RECEIVERID")
        if job_title:
            role_key = job_title.strip().lower()
            receiver_role_counts[role_key] = receiver_role_counts.get(role_key, 0) + 1

    # Calculate total receiver percentage and identify receivers with payout
    total_receiver_percentage = 0.0
    overall_tips = contributed_tips if contributed_tips > 0 else total_tips
    overall_gratuity = contributed_gratuity if contributed_gratuity > 0 else total_gratuity
    receivers_with_payout = []  # Track receivers who will get payout > 0

    for receiver in receiver_list:
        hours = float(receiver.get("hoursWorked") or receiver.get("HOURS_WORKED") or 0)
        payout_pct = float(receiver.get("payoutPercentage") or receiver.get("PAYOUT_PERCENTAGE") or 0)
        total_tips_rcv = float(receiver.get("totalTips") or receiver.get("TOTAL_TIPS") or 0)
        total_grat_rcv = float(receiver.get("totalGratuity") or receiver.get("TOTAL_GRATUITY") or 0)
        in_time = receiver.get("inTime") or receiver.get("INDATE")
        out_time = receiver.get("outTime") or receiver.get("OUTDATE")
        # Check if manual receiver
        is_manual = payout_pct > 0 and total_tips_rcv == 0 and total_grat_rcv == 0 and in_time is None and out_time is None
        has_hours = is_manual or hours > 0
        if not has_hours:
            continue
        job_title = receiver.get("jobTitle") or receiver.get("JOBTITLE") or receiver.get("payoutReceiverId") or receiver.get("PAYOUT_RECEIVERID")
        role_key = (job_title or "").strip().lower()
        role_total_pct = receiver_role_percentages.get(role_key, 0)
        role_count = receiver_role_counts.get(role_key, 0)
        share_pct = role_total_pct / role_count if role_count > 0 else 0
        receiver_pct = payout_pct if is_manual else share_pct
        payout_amount = (receiver_pct / 100.0) * (overall_tips + overall_gratuity)
        if payout_amount > 0:
            total_receiver_percentage += receiver_pct
            receivers_with_payout.append(receiver)

    # Step 5: Count employees with earnings for prepayout calculation
    # Contributors with tips + gratuity > 0
    contributors_with_earnings = [
        c for c in contributor_list
        if (float(c.get("totalTips") or c.get("TOTAL_TIPS") or 0) +
            float(c.get("totalGratuity") or c.get("TOTAL_GRATUITY") or 0)) > 0
    ]
    # Receivers with payout > 0
    employees_with_earnings_count = len(contributors_with_earnings) + len(receivers_with_payout)

    # Step 6: Calculate pre-payout per person (only among employees with earnings)
    prepayout_per_person = _calculate_prepayout_per_person(
        cursor, payout_schedule_id, employees_with_earnings_count, contribution_pool
    )

    # Debug logging
    print(f"=== _apply_calculations_to_schedule ===")
    print(f"total_receiver_percentage: {total_receiver_percentage}")
    print(f"contributors_with_earnings: {len(contributors_with_earnings)}, receivers_with_payout: {len(receivers_with_payout)}")
    print(f"employees_with_earnings_count: {employees_with_earnings_count}")
    print(f"prepayout_per_person: {prepayout_per_person}")
    print(f"payout_fee: {payout_fee}")
    print(f"overall_tips: {overall_tips}, overall_gratuity: {overall_gratuity}")

    # Now apply calculations to each person
    updated_contributors = []

    for person in contributors:
        is_contributor = (person.get("isContributor") or person.get("IS_CONTRIBUTOR") or "").lower() == "yes"
        person_tips = float(person.get("totalTips") or person.get("TOTAL_TIPS") or 0)
        person_gratuity = float(person.get("totalGratuity") or person.get("TOTAL_GRATUITY") or 0)
        hours_worked = float(person.get("hoursWorked") or person.get("HOURS_WORKED") or 0)

        # Check if employee has any tips/gratuity - if zero, no deductions apply
        has_earnings = (person_tips + person_gratuity) > 0

        if is_contributor:
            # Contributors: their payout is based on total receiver percentage
            # This matches the frontend calculation: payout = -(totalReceiverPercentage/100) * (tips + gratuity)
            payout_tips = round(-(total_receiver_percentage / 100.0) * person_tips, 2) if has_earnings else 0.0
            payout_gratuity = round(-(total_receiver_percentage / 100.0) * person_gratuity, 2) if has_earnings else 0.0
            payout_amount = payout_tips + payout_gratuity

            # Net payout = tips + gratuity + payout (which is negative for contributors)
            # Then subtract prepayout and fee
            gross_payout = person_tips + person_gratuity + payout_amount

            # Apply deductions only if employee has earnings (tips + gratuity > 0)
            if has_earnings:
                net_payout = max(0.0, gross_payout - prepayout_per_person - payout_fee)
                actual_prepayout = prepayout_per_person
                actual_payout_fee = payout_fee
            else:
                net_payout = 0.0
                actual_prepayout = 0.0
                actual_payout_fee = 0.0

            # Debug logging for contributors
            person_name = person.get("employeeName") or person.get("EMPLOYEE_NAME") or "Unknown"
            print(f"CONTRIBUTOR: {person_name}")
            print(f"  tips={person_tips}, gratuity={person_gratuity}")
            print(f"  payout_tips={payout_tips}, payout_gratuity={payout_gratuity}")
            print(f"  payout_amount={payout_amount}, gross_payout={gross_payout}")
            print(f"  net_payout={net_payout}")

        else:
            # Receivers: get their share from the pool
            # Calculate effective payout percentage for this receiver
            payout_pct_raw = float(person.get("payoutPercentage") or person.get("PAYOUT_PERCENTAGE") or 0)
            total_tips_rcv = float(person.get("totalTips") or person.get("TOTAL_TIPS") or 0)
            total_grat_rcv = float(person.get("totalGratuity") or person.get("TOTAL_GRATUITY") or 0)
            in_time = person.get("inTime") or person.get("INDATE")
            out_time = person.get("outTime") or person.get("OUTDATE")
            # Check if manual receiver
            is_manual = payout_pct_raw > 0 and total_tips_rcv == 0 and total_grat_rcv == 0 and in_time is None and out_time is None
            has_hours = is_manual or hours_worked > 0

            if has_hours:
                job_title = person.get("jobTitle") or person.get("JOBTITLE") or person.get("payoutReceiverId") or person.get("PAYOUT_RECEIVERID")
                role_key = (job_title or "").strip().lower()
                role_total_pct = receiver_role_percentages.get(role_key, 0)
                role_count = receiver_role_counts.get(role_key, 0)
                share_pct = role_total_pct / role_count if role_count > 0 else 0
                receiver_pct = payout_pct_raw if is_manual else share_pct

                payout_tips = round((receiver_pct / 100.0) * overall_tips, 2)
                payout_gratuity = round((receiver_pct / 100.0) * overall_gratuity, 2)
                payout_amount = payout_tips + payout_gratuity

                # Net payout = totalTips + totalGratuity + payoutAmount - prepayout - fee
                # For receivers, totalTips and totalGratuity are usually 0, so net is just payout minus deductions
                gross_payout = person_tips + person_gratuity + payout_amount

                # Apply deductions only if receiver has payout > 0
                if payout_amount > 0:
                    net_payout = max(0.0, gross_payout - prepayout_per_person - payout_fee)
                    actual_prepayout = prepayout_per_person
                    actual_payout_fee = payout_fee
                else:
                    net_payout = 0.0
                    actual_prepayout = 0.0
                    actual_payout_fee = 0.0
            else:
                payout_tips = 0.0
                payout_gratuity = 0.0
                net_payout = 0.0
                actual_prepayout = 0.0
                actual_payout_fee = 0.0

        # Create updated person record
        updated_person = dict(person)
        updated_person["payoutTips"] = payout_tips
        updated_person["payoutGratuity"] = payout_gratuity
        updated_person["netPayout"] = round(net_payout, 2)
        updated_person["prepayoutDeduction"] = actual_prepayout
        updated_person["payoutFee"] = actual_payout_fee
        updated_person["contributionPool"] = contribution_pool
        updated_person["overallTips"] = contributed_tips
        updated_person["overallGratuity"] = contributed_gratuity

        updated_contributors.append(updated_person)

    return updated_contributors


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
                    GPS.PAYOUTTRIGGER_GRATUITY,
                    GPS.PAYOUTTRIGGER_TIPS,
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
                    GED.PAYOUTTRIGGER_GRATUITY,
                    GED.PAYOUTTRIGGER_TIPS,
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
                    GED.PAYOUTTRIGGER_GRATUITY,
                    GED.PAYOUTTRIGGER_TIPS,
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
                GAS.PAYOUTTRIGGER_GRATUITY,
                GAS.PAYOUTTRIGGER_TIPS,
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
                    GPS.PAYOUTTRIGGER_GRATUITY,
                    GPS.PAYOUTTRIGGER_TIPS,
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
                    GED.PAYOUTTRIGGER_GRATUITY,
                    GED.PAYOUTTRIGGER_TIPS,
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
                    GED.PAYOUTTRIGGER_GRATUITY,
                    GED.PAYOUTTRIGGER_TIPS,
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
                GAS.PAYOUTTRIGGER_GRATUITY,
                GAS.PAYOUTTRIGGER_TIPS,
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
                    "payoutTriggerTips": float(row.get("PAYOUTTRIGGER_TIPS") or 100),
                    "payoutTriggerGratuity": float(row.get("PAYOUTTRIGGER_GRATUITY") or 100),
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
                        pai.NET_PAYOUT AS net_payout,
                        pai.PREPAYOUT_DEDUCTION AS prepayout_deduction,
                        pai.PAYOUT_FEE AS payout_fee
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
                        "netPayout": float(item["net_payout"] or 0),
                        "prepayoutDeduction": float(item["prepayout_deduction"] or 0),
                        "payoutFee": float(item["payout_fee"] or 0),
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

        # Apply new calculation logic to all schedules
        for schedule_key, schedule in schedule_map.items():
            if schedule.get("contributors"):
                updated_contributors = _apply_calculations_to_schedule(
                    schedule=schedule,
                    contributors=schedule["contributors"],
                    cursor=cursor,
                    restaurant_id=restaurant_id,
                )
                schedule["contributors"] = updated_contributors

        # Apply NEW_VALUE from PAYOUT_APPROVAL_HISTORY to override calculated values
        for schedule in schedule_map.values():
            if not schedule.get("contributors"):
                continue

            # Fetch NEW_VALUE records from history for this schedule
            cursor.execute(
                """
                SELECT EMPLOYEEGUID, JOBTITLE, FIELD_NAME, NEW_VALUE
                FROM GRATLYDB.PAYOUT_APPROVAL_HISTORY
                WHERE PAYOUT_SCHEDULEID = %s
                  AND BUSINESSDATE = %s
                  AND CHANGE_TYPE = 'INITIAL_SNAPSHOT'
                  AND NEW_VALUE IS NOT NULL
                """,
                (schedule["payoutScheduleId"], schedule["businessDate"]),
            )
            history_rows = cursor.fetchall()

            if history_rows:
                # Build lookup: (employeeGuid, jobTitle, fieldName) -> newValue
                history_values = {}
                for row in history_rows:
                    key = (
                        row["EMPLOYEEGUID"] or "",
                        row["JOBTITLE"] or "",
                        row["FIELD_NAME"],
                    )
                    history_values[key] = row["NEW_VALUE"]

                logger.info(f"Found {len(history_values)} NEW_VALUE records for schedule {schedule['payoutScheduleId']}")

                # Apply NEW_VALUE to contributors
                for contributor in schedule["contributors"]:
                    emp_guid = contributor.get("employeeGuid") or ""
                    job_title = contributor.get("jobTitle") or ""

                    # Check for NET_PAYOUT override
                    net_key = (emp_guid, job_title, "NET_PAYOUT")
                    if net_key in history_values:
                        try:
                            new_net = float(history_values[net_key])
                            contributor["netPayout"] = new_net
                            logger.info(f"  Applied NEW_VALUE netPayout={new_net} for {contributor.get('employeeName')}")
                        except (ValueError, TypeError):
                            pass

                    # Check for PAYOUT_PERCENTAGE override
                    pct_key = (emp_guid, job_title, "PAYOUT_PERCENTAGE")
                    if pct_key in history_values:
                        try:
                            new_pct = float(history_values[pct_key])
                            contributor["payoutPercentage"] = new_pct
                            logger.info(f"  Applied NEW_VALUE payoutPercentage={new_pct} for {contributor.get('employeeName')}")
                        except (ValueError, TypeError):
                            pass

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
                    item.prepayoutDeduction,
                    item.payoutFee,
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
                    NET_PAYOUT,
                    PREPAYOUT_DEDUCTION,
                    PAYOUT_FEE
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                rows,
            )

            # Save NEW_VALUE to PAYOUT_APPROVAL_HISTORY for each item
            logger.info(f"=== SAVING NEW_VALUE === schedule={payload.payoutScheduleId}, date={payload.businessDate}, items={len(payload.items)}")

            # DEBUG: First, let's see what records exist in the database
            cursor.execute(
                """
                SELECT EMPLOYEEGUID, JOBTITLE, FIELD_NAME, OLD_VALUE, NEW_VALUE
                FROM GRATLYDB.PAYOUT_APPROVAL_HISTORY
                WHERE PAYOUT_SCHEDULEID = %s
                  AND BUSINESSDATE = %s
                  AND CHANGE_TYPE = 'INITIAL_SNAPSHOT'
                """,
                (payload.payoutScheduleId, payload.businessDate),
            )
            existing_records = cursor.fetchall()
            logger.info(f"  DEBUG: Found {len(existing_records)} existing INITIAL_SNAPSHOT records in DB:")
            for rec in existing_records:
                logger.info(f"    DB record: guid={rec['EMPLOYEEGUID']}, job={rec['JOBTITLE']}, field={rec['FIELD_NAME']}, old={rec['OLD_VALUE']}, new={rec['NEW_VALUE']}")

            records_saved = 0
            for item in payload.items:
                new_net = str(item.netPayout) if item.netPayout is not None else "0"
                new_pct = str(item.payoutPercentage) if item.payoutPercentage is not None else "0"

                logger.info(f"  Saving: name={item.employeeName}")
                logger.info(f"    Payload values: guid='{item.employeeGuid}' (type={type(item.employeeGuid).__name__}), job='{item.jobTitle}' (type={type(item.jobTitle).__name__})")
                logger.info(f"    Values to save: net={new_net}, pct={new_pct}")

                # Save NET_PAYOUT - try UPDATE first, then INSERT if no rows affected
                cursor.execute(
                    """
                    UPDATE GRATLYDB.PAYOUT_APPROVAL_HISTORY
                    SET NEW_VALUE = %s
                    WHERE PAYOUT_SCHEDULEID = %s
                      AND BUSINESSDATE = %s
                      AND ((EMPLOYEEGUID = %s) OR (EMPLOYEEGUID IS NULL AND %s IS NULL))
                      AND ((JOBTITLE = %s) OR (JOBTITLE IS NULL AND %s IS NULL))
                      AND FIELD_NAME = 'NET_PAYOUT'
                      AND CHANGE_TYPE = 'INITIAL_SNAPSHOT'
                    """,
                    (new_net, payload.payoutScheduleId, payload.businessDate,
                     item.employeeGuid, item.employeeGuid, item.jobTitle, item.jobTitle),
                )
                if cursor.rowcount > 0:
                    records_saved += 1
                    logger.info(f"    Updated NET_PAYOUT: {new_net}")
                else:
                    # No existing record, INSERT new one
                    cursor.execute(
                        """
                        INSERT INTO GRATLYDB.PAYOUT_APPROVAL_HISTORY (
                            PAYOUT_APPROVALID, RESTAURANTID, PAYOUT_SCHEDULEID, BUSINESSDATE,
                            EMPLOYEEGUID, EMPLOYEE_NAME, JOBTITLE, FIELD_NAME,
                            OLD_VALUE, NEW_VALUE, USERID, CHANGE_TYPE
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (approval_id, payload.restaurantId, payload.payoutScheduleId, payload.businessDate,
                         item.employeeGuid, item.employeeName, item.jobTitle, 'NET_PAYOUT',
                         new_net, new_net, payload.userId, 'INITIAL_SNAPSHOT'),
                    )
                    records_saved += 1
                    logger.info(f"    Inserted NET_PAYOUT: {new_net}")

                # Save PAYOUT_PERCENTAGE - try UPDATE first, then INSERT if no rows affected
                cursor.execute(
                    """
                    UPDATE GRATLYDB.PAYOUT_APPROVAL_HISTORY
                    SET NEW_VALUE = %s
                    WHERE PAYOUT_SCHEDULEID = %s
                      AND BUSINESSDATE = %s
                      AND ((EMPLOYEEGUID = %s) OR (EMPLOYEEGUID IS NULL AND %s IS NULL))
                      AND ((JOBTITLE = %s) OR (JOBTITLE IS NULL AND %s IS NULL))
                      AND FIELD_NAME = 'PAYOUT_PERCENTAGE'
                      AND CHANGE_TYPE = 'INITIAL_SNAPSHOT'
                    """,
                    (new_pct, payload.payoutScheduleId, payload.businessDate,
                     item.employeeGuid, item.employeeGuid, item.jobTitle, item.jobTitle),
                )
                if cursor.rowcount > 0:
                    records_saved += 1
                    logger.info(f"    Updated PAYOUT_PERCENTAGE: {new_pct}")
                else:
                    # No existing record, INSERT new one
                    cursor.execute(
                        """
                        INSERT INTO GRATLYDB.PAYOUT_APPROVAL_HISTORY (
                            PAYOUT_APPROVALID, RESTAURANTID, PAYOUT_SCHEDULEID, BUSINESSDATE,
                            EMPLOYEEGUID, EMPLOYEE_NAME, JOBTITLE, FIELD_NAME,
                            OLD_VALUE, NEW_VALUE, USERID, CHANGE_TYPE
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (approval_id, payload.restaurantId, payload.payoutScheduleId, payload.businessDate,
                         item.employeeGuid, item.employeeName, item.jobTitle, 'PAYOUT_PERCENTAGE',
                         new_pct, new_pct, payload.userId, 'INITIAL_SNAPSHOT'),
                    )
                    records_saved += 1
                    logger.info(f"    Inserted PAYOUT_PERCENTAGE: {new_pct}")

            logger.info(f"=== SAVE COMPLETE === Total records: {records_saved}")

        conn.commit()
        return {"success": True, "approval_id": approval_id}
    except pymysql.MySQLError as err:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Error saving approval overrides: {err}")
    finally:
        cursor.close()


@router.post("/approvals/snapshot")
def save_approval_snapshot(payload: ApprovalSnapshotPayload):
    """
    Save a snapshot of the current approval state before editing.
    This creates an audit trail for reconciliation purposes.
    Only inserts records that don't already have a snapshot for this schedule/date.
    """
    logger.info(f"=== SNAPSHOT SAVE START === schedule={payload.payoutScheduleId}, date={payload.businessDate}, items={len(payload.items)}")
    for item in payload.items:
        logger.info(f"  Snapshot item: guid={item.employeeGuid}, job={item.jobTitle}, field={item.fieldName}, value={item.currentValue}")

    cursor = _get_cursor(dictionary=True)
    conn = cursor.connection
    try:
        # Get or create approval record
        cursor.execute(
            """
            SELECT PAYOUT_APPROVALID AS approval_id
            FROM GRATLYDB.PAYOUT_APPROVAL
            WHERE RESTAURANTID = %s
              AND PAYOUT_SCHEDULEID = %s
              AND BUSINESSDATE = %s
            LIMIT 1
            """,
            (payload.restaurantId, payload.payoutScheduleId, payload.businessDate),
        )
        approval_row = cursor.fetchone()
        approval_id = approval_row["approval_id"] if approval_row else None

        # Check which snapshots already exist for this schedule/date
        cursor.execute(
            """
            SELECT EMPLOYEEGUID, JOBTITLE, FIELD_NAME
            FROM GRATLYDB.PAYOUT_APPROVAL_HISTORY
            WHERE PAYOUT_SCHEDULEID = %s
              AND BUSINESSDATE = %s
              AND CHANGE_TYPE = 'INITIAL_SNAPSHOT'
            """,
            (payload.payoutScheduleId, payload.businessDate),
        )
        existing_snapshots = cursor.fetchall()

        # Build set of existing snapshot keys (normalize None to empty string)
        existing_keys = set()
        for row in existing_snapshots:
            key = (
                row["EMPLOYEEGUID"] or "",
                row["JOBTITLE"] or "",
                row["FIELD_NAME"] or "",
            )
            existing_keys.add(key)

        logger.info(f"Found {len(existing_keys)} existing INITIAL_SNAPSHOT records for schedule {payload.payoutScheduleId}, date {payload.businessDate}")

        # Filter out items that already have snapshots
        new_items = []
        for item in payload.items:
            key = (
                item.employeeGuid or "",
                item.jobTitle or "",
                item.fieldName or "",
            )
            if key not in existing_keys:
                new_items.append(item)

        logger.info(f"Inserting {len(new_items)} new INITIAL_SNAPSHOT records (skipping {len(payload.items) - len(new_items)} existing)")

        # Insert only new snapshot records into history table
        if new_items:
            rows = [
                (
                    approval_id,
                    None,  # PAYOUT_APPROVAL_ITEMID - can be added later if needed
                    payload.restaurantId,
                    payload.payoutScheduleId,
                    payload.businessDate,
                    item.employeeGuid,
                    item.employeeName,
                    item.jobTitle,
                    item.fieldName,
                    item.currentValue,
                    None,  # NEW_VALUE - will be set when changes are saved
                    payload.userId,
                    "INITIAL_SNAPSHOT",
                )
                for item in new_items
            ]
            cursor.executemany(
                """
                INSERT INTO GRATLYDB.PAYOUT_APPROVAL_HISTORY (
                    PAYOUT_APPROVALID,
                    PAYOUT_APPROVAL_ITEMID,
                    RESTAURANTID,
                    PAYOUT_SCHEDULEID,
                    BUSINESSDATE,
                    EMPLOYEEGUID,
                    EMPLOYEE_NAME,
                    JOBTITLE,
                    FIELD_NAME,
                    OLD_VALUE,
                    NEW_VALUE,
                    CHANGED_BY_USERID,
                    CHANGE_TYPE
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                rows,
            )

        conn.commit()
        return {"success": True, "snapshot_count": len(new_items), "skipped_count": len(payload.items) - len(new_items)}
    except pymysql.MySQLError as err:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Error saving approval snapshot: {err}")
    finally:
        cursor.close()


@router.post("/approvals/record-change")
def record_approval_change(
    restaurant_id: int,
    payout_schedule_id: int,
    business_date: str,
    user_id: int,
    employee_guid: str,
    employee_name: str,
    job_title: str,
    field_name: str,
    old_value: str,
    new_value: str,
    change_type: str = "EDIT",
):
    """
    Record a specific change made to an approval item.
    This is called when saving edits to track what was changed.
    """
    cursor = _get_cursor(dictionary=True)
    conn = cursor.connection
    try:
        # Get approval ID if it exists
        cursor.execute(
            """
            SELECT PAYOUT_APPROVALID AS approval_id
            FROM GRATLYDB.PAYOUT_APPROVAL
            WHERE RESTAURANTID = %s
              AND PAYOUT_SCHEDULEID = %s
              AND BUSINESSDATE = %s
            LIMIT 1
            """,
            (restaurant_id, payout_schedule_id, business_date),
        )
        approval_row = cursor.fetchone()
        approval_id = approval_row["approval_id"] if approval_row else None

        cursor.execute(
            """
            INSERT INTO GRATLYDB.PAYOUT_APPROVAL_HISTORY (
                PAYOUT_APPROVALID,
                RESTAURANTID,
                PAYOUT_SCHEDULEID,
                BUSINESSDATE,
                EMPLOYEEGUID,
                EMPLOYEE_NAME,
                JOBTITLE,
                FIELD_NAME,
                OLD_VALUE,
                NEW_VALUE,
                CHANGED_BY_USERID,
                CHANGE_TYPE
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                approval_id,
                restaurant_id,
                payout_schedule_id,
                business_date,
                employee_guid,
                employee_name,
                job_title,
                field_name,
                old_value,
                new_value,
                user_id,
                change_type,
            ),
        )

        conn.commit()
        return {"success": True}
    except pymysql.MySQLError as err:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Error recording approval change: {err}")
    finally:
        cursor.close()
