from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import pymysql

try:
    from Backend.db import _get_cursor, _fetch_restaurant_key
except ImportError:
    from db import _get_cursor, _fetch_restaurant_key

router = APIRouter()

class PrePayoutItem(BaseModel):
    option: str
    value: Optional[float] = None
    account: Optional[str] = None

class PayoutSchedulePayload(BaseModel):
    user_id: int
    name: str
    start_day: Optional[str] = None
    end_day: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    payout_triggers: Optional[dict] = None
    payout_rule: str
    payout_contributors: Optional[List[str]] = None
    payout_receivers: Optional[List[str]] = None
    payout_percentages: Optional[dict] = None
    custom_individual_payout: Optional[float] = None
    custom_group_contribution: Optional[float] = None
    pre_payouts: Optional[List[PrePayoutItem]] = None

class PayoutScheduleRow(BaseModel):
    payout_schedule_id: int
    name: str
    start_day: Optional[str] = None
    end_day: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    payout_rule_id: Optional[str] = None

class PayoutScheduleDetail(BaseModel):
    payout_schedule_id: int
    name: str
    start_day: Optional[str] = None
    end_day: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    payout_rule_id: Optional[str] = None
    payout_triggers: Optional[dict] = None
    payout_receivers: Optional[List[dict]] = None
    custom_individual_payout: Optional[float] = None
    custom_group_contribution: Optional[float] = None
    pre_payouts: Optional[List[dict]] = None

def _parse_optional_float(value: Optional[object]) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None

def _map_payout_rule(rule: str) -> str:
    normalized = rule.strip()
    mapping = {
        "Custom Payout": "1",
        "Equal Payout": "2",
        "Hour Based Payout": "3",
        "Job Weighted Payout": "4",
    }
    payout_rule_id = mapping.get(normalized)
    if not payout_rule_id:
        raise HTTPException(status_code=400, detail=f"Unsupported payout rule: {rule}")
    return payout_rule_id

def _unique_names(entries: Optional[List[str]]) -> List[str]:
    seen = set()
    unique = []
    for entry in entries or []:
        if entry and entry not in seen:
            seen.add(entry)
            unique.append(entry)
    return unique

@router.post("/payout-schedules")
def create_payout_schedule(payload: PayoutSchedulePayload):
    restaurant_id = _fetch_restaurant_key(payload.user_id)
    if not restaurant_id:
        raise HTTPException(status_code=404, detail="Restaurant not found for user")

    payout_rule_id = _map_payout_rule(payload.payout_rule)
    payout_triggers = payload.payout_triggers or {}
    gratuity_trigger = _parse_optional_float(payout_triggers.get("gratuity"))
    tips_trigger = _parse_optional_float(payout_triggers.get("tips"))

    valid_pre_payouts = []
    for entry in payload.pre_payouts or []:
        option = (entry.option or "").strip()
        value = _parse_optional_float(entry.value)
        account = (entry.account or "").strip()
        if not option or value is None or not account:
            continue
        option_value = 0 if option.lower().startswith("percentage") else 1
        valid_pre_payouts.append((option_value, value, account))

    pre_payout_flag = bool(valid_pre_payouts)

    cursor = _get_cursor(dictionary=False)
    conn = cursor.connection
    try:
        conn.begin()
        cursor.execute(
            """
            INSERT INTO GRATLYDB.PAYOUT_SCHEDULE (
                RESTAURANTID,
                USERID,
                NAME,
                START_DAY,
                END_DAY,
                START_TIME,
                END_TIME,
                PAYOUTTRIGGER_GRATUITY,
                PAYOUTTRIGGER_TIPS,
                PAYOUT_RULE_ID,
                PREPAYOUT_FLAG
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                restaurant_id,
                payload.user_id,
                payload.name.strip(),
                payload.start_day,
                payload.end_day,
                payload.start_time,
                payload.end_time,
                gratuity_trigger,
                tips_trigger,
                payout_rule_id,
                pre_payout_flag,
            ),
        )
        payout_schedule_id = cursor.lastrowid

        contributor_names = _unique_names(payload.payout_contributors)
        receiver_names = _unique_names(payload.payout_receivers)

        payout_percentages = payload.payout_percentages or {}
        receiver_rows = []
        for contributor_name in contributor_names:
            percentage_value = _parse_optional_float(payout_percentages.get(contributor_name))
            receiver_rows.append(
                (
                    payout_schedule_id,
                    payout_rule_id,
                    contributor_name,
                    percentage_value,
                    0,
                )
            )
        for receiver_name in receiver_names:
            percentage_value = _parse_optional_float(payout_percentages.get(receiver_name))
            receiver_rows.append(
                (
                    payout_schedule_id,
                    payout_rule_id,
                    receiver_name,
                    percentage_value,
                    1,
                )
            )

        if receiver_rows:
            cursor.executemany(
                """
                INSERT INTO GRATLYDB.PAYOUTRECEIVERS (
                    PAYOUT_SCHEDULEID,
                    PAYOUT_RULE_ID,
                    PAYOUT_RECEIVERID,
                    PAYOUT_PERCENTAGE,
                    CONTRIBUTOR_RECIEVER
                )
                VALUES (%s, %s, %s, %s, %s)
                """,
                receiver_rows,
            )

        if payout_rule_id == "1":
            individual_value = _parse_optional_float(payload.custom_individual_payout)
            group_value = _parse_optional_float(payload.custom_group_contribution)
            if individual_value is not None or group_value is not None:
                cursor.execute(
                    """
                    INSERT INTO GRATLYDB.PAYOUT_CUSTOM (
                        PAYOUT_SCHEDULEID,
                        INDIVIDUAL_PAYOUT,
                        GROUPCONTRIBUTION
                    )
                    VALUES (%s, %s, %s)
                    """,
                    (payout_schedule_id, individual_value, group_value),
                )

        if valid_pre_payouts:
            pre_rows = [
                (payout_schedule_id, option, value, account)
                for option, value, account in valid_pre_payouts
            ]
            cursor.executemany(
                """
                INSERT INTO GRATLYDB.PREPAYOUT (
                    PAYOUT_SCHEDULEID,
                    PREPAYOUTOPTION,
                    PREPAYOUT_VALUE,
                    USERACCOUNT
                )
                VALUES (%s, %s, %s, %s)
                """,
                pre_rows,
            )

        conn.commit()
        return {"success": True, "payout_schedule_id": payout_schedule_id}
    except pymysql.MySQLError as err:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Error creating payout schedule: {err}")
    finally:
        cursor.close()

@router.get("/payout-schedules", response_model=List[PayoutScheduleRow])
def list_payout_schedules(user_id: Optional[int] = None, restaurant_id: Optional[int] = None):
    resolved_restaurant_id = restaurant_id
    if resolved_restaurant_id is None:
        if user_id is None:
            raise HTTPException(status_code=400, detail="Missing user_id or restaurant_id")
        resolved_restaurant_id = _fetch_restaurant_key(user_id)
    if not resolved_restaurant_id:
        raise HTTPException(status_code=404, detail="Restaurant not found for user")
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT
                PAYOUT_SCHEDULEID AS payout_schedule_id,
                NAME AS name,
                START_DAY AS start_day,
                END_DAY AS end_day,
                START_TIME AS start_time,
                END_TIME AS end_time,
                PAYOUT_RULE_ID AS payout_rule_id
            FROM GRATLYDB.PAYOUT_SCHEDULE
            WHERE RESTAURANTID = %s
            ORDER BY CREATEDDATE DESC
            """,
            (resolved_restaurant_id,),
        )
        rows = cursor.fetchall()
        return rows
    except pymysql.MySQLError as err:
        raise HTTPException(status_code=500, detail=f"Error fetching payout schedules: {err}")
    finally:
        cursor.close()

@router.put("/payout-schedules/{schedule_id}")
def update_payout_schedule(schedule_id: int, payload: PayoutSchedulePayload):
    restaurant_id = _fetch_restaurant_key(payload.user_id)
    if not restaurant_id:
        raise HTTPException(status_code=404, detail="Restaurant not found for user")
    payout_rule_id = _map_payout_rule(payload.payout_rule)
    payout_triggers = payload.payout_triggers or {}
    gratuity_trigger = _parse_optional_float(payout_triggers.get("gratuity"))
    tips_trigger = _parse_optional_float(payout_triggers.get("tips"))

    valid_pre_payouts = []
    for entry in payload.pre_payouts or []:
        option = (entry.option or "").strip()
        value = _parse_optional_float(entry.value)
        account = (entry.account or "").strip()
        if not option or value is None or not account:
            continue
        option_value = 0 if option.lower().startswith("percentage") else 1
        valid_pre_payouts.append((option_value, value, account))

    pre_payout_flag = bool(valid_pre_payouts)

    cursor = _get_cursor(dictionary=False)
    conn = cursor.connection
    try:
        cursor.execute(
            """
            SELECT PAYOUT_SCHEDULEID
            FROM GRATLYDB.PAYOUT_SCHEDULE
            WHERE PAYOUT_SCHEDULEID = %s AND RESTAURANTID = %s
            """,
            (schedule_id, restaurant_id),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Payout schedule not found")

        conn.begin()
        cursor.execute(
            """
            UPDATE GRATLYDB.PAYOUT_SCHEDULE
            SET
                NAME = %s,
                START_DAY = %s,
                END_DAY = %s,
                START_TIME = %s,
                END_TIME = %s,
                PAYOUTTRIGGER_GRATUITY = %s,
                PAYOUTTRIGGER_TIPS = %s,
                PAYOUT_RULE_ID = %s,
                PREPAYOUT_FLAG = %s
            WHERE PAYOUT_SCHEDULEID = %s AND RESTAURANTID = %s
            """,
            (
                payload.name.strip(),
                payload.start_day,
                payload.end_day,
                payload.start_time,
                payload.end_time,
                gratuity_trigger,
                tips_trigger,
                payout_rule_id,
                pre_payout_flag,
                schedule_id,
                restaurant_id,
            ),
        )

        cursor.execute(
            "DELETE FROM GRATLYDB.PAYOUTRECEIVERS WHERE PAYOUT_SCHEDULEID = %s",
            (schedule_id,),
        )
        cursor.execute(
            "DELETE FROM GRATLYDB.PAYOUT_CUSTOM WHERE PAYOUT_SCHEDULEID = %s",
            (schedule_id,),
        )
        cursor.execute(
            "DELETE FROM GRATLYDB.PREPAYOUT WHERE PAYOUT_SCHEDULEID = %s",
            (schedule_id,),
        )

        contributor_names = _unique_names(payload.payout_contributors)
        receiver_names = _unique_names(payload.payout_receivers)
        payout_percentages = payload.payout_percentages or {}
        receiver_rows = []
        for contributor_name in contributor_names:
            percentage_value = _parse_optional_float(payout_percentages.get(contributor_name))
            receiver_rows.append(
                (
                    schedule_id,
                    payout_rule_id,
                    contributor_name,
                    percentage_value,
                    0,
                )
            )
        for receiver_name in receiver_names:
            percentage_value = _parse_optional_float(payout_percentages.get(receiver_name))
            receiver_rows.append(
                (
                    schedule_id,
                    payout_rule_id,
                    receiver_name,
                    percentage_value,
                    1,
                )
            )
        if receiver_rows:
            cursor.executemany(
                """
                INSERT INTO GRATLYDB.PAYOUTRECEIVERS (
                    PAYOUT_SCHEDULEID,
                    PAYOUT_RULE_ID,
                    PAYOUT_RECEIVERID,
                    PAYOUT_PERCENTAGE,
                    CONTRIBUTOR_RECIEVER
                )
                VALUES (%s, %s, %s, %s, %s)
                """,
                receiver_rows,
            )

        if payout_rule_id == "1":
            individual_value = _parse_optional_float(payload.custom_individual_payout)
            group_value = _parse_optional_float(payload.custom_group_contribution)
            if individual_value is not None or group_value is not None:
                cursor.execute(
                    """
                    INSERT INTO GRATLYDB.PAYOUT_CUSTOM (
                        PAYOUT_SCHEDULEID,
                        INDIVIDUAL_PAYOUT,
                        GROUPCONTRIBUTION
                    )
                    VALUES (%s, %s, %s)
                    """,
                    (schedule_id, individual_value, group_value),
                )

        if valid_pre_payouts:
            pre_rows = [
                (schedule_id, option, value, account)
                for option, value, account in valid_pre_payouts
            ]
            cursor.executemany(
                """
                INSERT INTO GRATLYDB.PREPAYOUT (
                    PAYOUT_SCHEDULEID,
                    PREPAYOUTOPTION,
                    PREPAYOUT_VALUE,
                    USERACCOUNT
                )
                VALUES (%s, %s, %s, %s)
                """,
                pre_rows,
            )

        conn.commit()
        return {"success": True, "payout_schedule_id": schedule_id}
    except pymysql.MySQLError as err:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Error updating payout schedule: {err}")
    finally:
        cursor.close()

@router.get("/payout-schedules/{schedule_id}", response_model=PayoutScheduleDetail)
def get_payout_schedule(schedule_id: int, user_id: int):
    restaurant_id = _fetch_restaurant_key(user_id)
    if not restaurant_id:
        raise HTTPException(status_code=404, detail="Restaurant not found for user")
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT
                PAYOUT_SCHEDULEID AS payout_schedule_id,
                NAME AS name,
                START_DAY AS start_day,
                END_DAY AS end_day,
                START_TIME AS start_time,
                END_TIME AS end_time,
                PAYOUT_RULE_ID AS payout_rule_id,
                PAYOUTTRIGGER_GRATUITY AS payouttrigger_gratuity,
                PAYOUTTRIGGER_TIPS AS payouttrigger_tips
            FROM GRATLYDB.PAYOUT_SCHEDULE
            WHERE PAYOUT_SCHEDULEID = %s AND RESTAURANTID = %s
            LIMIT 1
            """,
            (schedule_id, restaurant_id),
        )
        schedule = cursor.fetchone()
        if not schedule:
            raise HTTPException(status_code=404, detail="Payout schedule not found")

        cursor.execute(
            """
            SELECT
                PAYOUT_RECEIVERID AS payout_receiver_id,
                PAYOUT_PERCENTAGE AS payout_percentage,
                CONTRIBUTOR_RECIEVER AS contributor_receiver
            FROM GRATLYDB.PAYOUTRECEIVERS
            WHERE PAYOUT_SCHEDULEID = %s
            """,
            (schedule_id,),
        )
        receivers = cursor.fetchall()

        cursor.execute(
            """
            SELECT
                INDIVIDUAL_PAYOUT AS individual_payout,
                GROUPCONTRIBUTION AS group_contribution
            FROM GRATLYDB.PAYOUT_CUSTOM
            WHERE PAYOUT_SCHEDULEID = %s
            LIMIT 1
            """,
            (schedule_id,),
        )
        custom = cursor.fetchone() or {}

        cursor.execute(
            """
            SELECT
                PREPAYOUTOPTION AS pre_payout_option,
                PREPAYOUT_VALUE AS pre_payout_value,
                USERACCOUNT AS user_account
            FROM GRATLYDB.PREPAYOUT
            WHERE PAYOUT_SCHEDULEID = %s
            """,
            (schedule_id,),
        )
        pre_payouts = cursor.fetchall()

        return {
            "payout_schedule_id": schedule["payout_schedule_id"],
            "name": schedule["name"],
            "start_day": schedule["start_day"],
            "end_day": schedule["end_day"],
            "start_time": schedule["start_time"],
            "end_time": schedule["end_time"],
            "payout_rule_id": schedule["payout_rule_id"],
            "payout_triggers": {
                "gratuity": schedule.get("payouttrigger_gratuity"),
                "tips": schedule.get("payouttrigger_tips"),
            },
            "payout_receivers": receivers,
            "custom_individual_payout": custom.get("individual_payout"),
            "custom_group_contribution": custom.get("group_contribution"),
            "pre_payouts": pre_payouts,
        }
    except pymysql.MySQLError as err:
        raise HTTPException(status_code=500, detail=f"Error fetching payout schedule: {err}")
    finally:
        cursor.close()

@router.delete("/payout-schedules/{schedule_id}")
def delete_payout_schedule(schedule_id: int, user_id: int):
    restaurant_id = _fetch_restaurant_key(user_id)
    if not restaurant_id:
        raise HTTPException(status_code=404, detail="Restaurant not found for user")
    cursor = _get_cursor(dictionary=False)
    conn = cursor.connection
    try:
        cursor.execute(
            """
            SELECT PAYOUT_SCHEDULEID
            FROM GRATLYDB.PAYOUT_SCHEDULE
            WHERE PAYOUT_SCHEDULEID = %s AND RESTAURANTID = %s
            """,
            (schedule_id, restaurant_id),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Payout schedule not found")

        conn.begin()
        cursor.execute(
            "DELETE FROM GRATLYDB.PAYOUTRECEIVERS WHERE PAYOUT_SCHEDULEID = %s",
            (schedule_id,),
        )
        cursor.execute(
            "DELETE FROM GRATLYDB.PAYOUT_CUSTOM WHERE PAYOUT_SCHEDULEID = %s",
            (schedule_id,),
        )
        cursor.execute(
            "DELETE FROM GRATLYDB.PREPAYOUT WHERE PAYOUT_SCHEDULEID = %s",
            (schedule_id,),
        )
        cursor.execute(
            "DELETE FROM GRATLYDB.PAYOUT_SCHEDULE WHERE PAYOUT_SCHEDULEID = %s",
            (schedule_id,),
        )
        conn.commit()
        return {"success": True}
    except pymysql.MySQLError as err:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Error deleting payout schedule: {err}")
    finally:
        cursor.close()
