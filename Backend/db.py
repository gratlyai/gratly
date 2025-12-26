from fastapi import HTTPException
import pymysql
import os
from dotenv import load_dotenv
import configparser
from typing import Optional

load_dotenv()

def _load_db_config_from_ini(path: str) -> dict:
    parser = configparser.ConfigParser()
    if not os.path.exists(path):
        return {}
    parser.read(path)
    if "DATABASE" not in parser:
        return {}
    section = parser["DATABASE"]
    return {
        "DB_HOST": section.get("host"),
        "DB_USER": section.get("user"),
        "DB_PASSWORD": section.get("password"),
        "DB_NAME": section.get("database"),
    }

_ini_db_config = _load_db_config_from_ini(os.path.join(os.path.dirname(__file__), "setting.ini"))

def _get_env_or_ini(key: str) -> Optional[str]:
    return os.getenv(key) or _ini_db_config.get(key)

DB_CONFIG = {}
try:
    DB_CONFIG = {
        "host": _get_env_or_ini("DB_HOST"),
        "user": _get_env_or_ini("DB_USER"),
        "password": _get_env_or_ini("DB_PASSWORD"),
        "database": _get_env_or_ini("DB_NAME"),
        "autocommit": True, # Ensure changes are committed immediately for table creation
    }
    db = pymysql.connect(**DB_CONFIG)
    cursor = db.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS USER_MASTER (
            USERID INT AUTO_INCREMENT PRIMARY KEY,
            FIRSTNAME VARCHAR(32) NOT NULL,
            LASTNAME VARCHAR(32) NOT NULL,
            EMAIL VARCHAR(64) NOT NULL UNIQUE,
            PHONENUMBER VARCHAR(32),
            PASSWORD_HASH VARCHAR(255) NOT NULL,
            CREATEDAT TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    db.commit()
    cursor.close()
    db.close()
except pymysql.MySQLError as err:
    raise HTTPException(status_code=500, detail=f"Database connection error: {err}")

def _get_cursor(dictionary: bool = True):
    if not DB_CONFIG:
        raise HTTPException(status_code=500, detail="Database connection not initialized.")
    try:
        connection_config = dict(DB_CONFIG)
        if dictionary:
            connection_config["cursorclass"] = pymysql.cursors.DictCursor
        connection = pymysql.connect(**connection_config)
        cursor = connection.cursor()
    except pymysql.MySQLError as err:
        raise HTTPException(status_code=500, detail=f"Database connection error: {err}")

    original_close = cursor.close

    def _close():
        try:
            original_close()
        finally:
            connection.close()

    cursor.close = _close
    return cursor

def _fetch_restaurant_key(user_id: int) -> Optional[int]:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            "SELECT RESTAURANTID AS restaurant_id FROM GRATLYDB.USERRESTAURANT WHERE USERID = %s LIMIT 1",
            (user_id,),
        )
        row = cursor.fetchone()
        return row["restaurant_id"] if row else None
    finally:
        cursor.close()

def _fetch_restaurant_name(user_id: int) -> Optional[str]:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT rd.RESTAURANTNAME AS restaurant_name
            FROM GRATLYDB.USERRESTAURANT ur
            JOIN GRATLYDB.SRC_ONBOARDING ob ON ur.RESTAURANTID = ob.RESTAURANTID
            JOIN GRATLYDB.SRC_RESTAURANTDETAILS rd ON rd.RESTAURANTGUID = ob.RESTAURANTGUID
            WHERE ur.USERID = %s
            LIMIT 1
            """,
            (user_id,),
        )
        row = cursor.fetchone()
        return row["restaurant_name"] if row else None
    finally:
        cursor.close()

def _fetch_restaurant_guid(user_id: int) -> Optional[str]:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT ob.RESTAURANTGUID AS restaurant_guid
            FROM GRATLYDB.USERRESTAURANT ur
            JOIN GRATLYDB.SRC_ONBOARDING ob ON ur.RESTAURANTID = ob.RESTAURANTID
            WHERE ur.USERID = %s
            LIMIT 1
            """,
            (user_id,),
        )
        row = cursor.fetchone()
        return row["restaurant_guid"] if row else None
    finally:
        cursor.close()

def _fetch_user_permission_flags(user_id: int) -> Optional[dict]:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT
                ISADMIN AS isAdmin,
                ISEMPLOYEE AS isEmployee
            FROM GRATLYDB.USER_PERMISSIONS
            WHERE USERID = %s
            LIMIT 1
            """,
            (user_id,),
        )
        return cursor.fetchone()
    finally:
        cursor.close()

def _fetch_employee_guid_for_user(user_id: int) -> Optional[str]:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT SRC_EMPLOYEES.EMPLOYEEGUID AS employee_guid
            FROM GRATLYDB.USER_MASTER AS user_master
            JOIN GRATLYDB.SRC_EMPLOYEES AS SRC_EMPLOYEES
                ON SRC_EMPLOYEES.EMAIL = user_master.EMAIL
            WHERE user_master.USERID = %s
            LIMIT 1
            """,
            (user_id,),
        )
        row = cursor.fetchone()
        return row["employee_guid"] if row else None
    finally:
        cursor.close()

def _serialize_permissions(row: Optional[dict]) -> Optional[dict]:
    if not row:
        return None
    return {
        "createPayoutSchedules": bool(row.get("isCreatePayoutSchedule")),
        "approvePayouts": bool(row.get("isApprovePayout")),
        "manageTeam": bool(row.get("isManageEmployees")),
        "adminAccess": bool(row.get("isAdmin")),
        "employeeOnly": bool(row.get("isEmployee")),
    }

def _fetch_restaurant_id_for_email(email: str) -> Optional[int]:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT ob.RESTAURANTID AS restaurant_id
            FROM GRATLYDB.SRC_EMPLOYEES se
            JOIN GRATLYDB.SRC_ONBOARDING ob ON se.RESTAURANTGUID = ob.RESTAURANTGUID
            WHERE se.EMAIL = %s
            LIMIT 1
            """,
            (email,),
        )
        row = cursor.fetchone()
        return row["restaurant_id"] if row else None
    finally:
        cursor.close()
