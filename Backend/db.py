from fastapi import HTTPException
import pymysql
import os
from contextvars import ContextVar
from dotenv import load_dotenv
import configparser
from typing import Iterable, List, Optional

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

    def _ensure_column(table: str, column: str, ddl: str) -> None:
        cursor.execute(
            """
            SELECT 1
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = %s
              AND TABLE_NAME = %s
              AND COLUMN_NAME = %s
            """,
            ("GRATLYDB", table, column),
        )
        if not cursor.fetchone():
            try:
                cursor.execute(f"ALTER TABLE GRATLYDB.{table} ADD COLUMN {ddl}")
            except pymysql.err.OperationalError as err:
                # Ignore duplicate column errors during concurrent startup.
                if err.args and err.args[0] == 1060:
                    return
                raise

    def _ensure_index(table: str, index_name: str, columns: str) -> None:
        cursor.execute(
            """
            SELECT 1
            FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = %s
              AND TABLE_NAME = %s
              AND INDEX_NAME = %s
            """,
            ("GRATLYDB", table, index_name),
        )
        if not cursor.fetchone():
            try:
                cursor.execute(f"CREATE INDEX {index_name} ON GRATLYDB.{table} ({columns})")
            except pymysql.err.OperationalError as err:
                # Ignore duplicate index errors during concurrent startup.
                if err.args and err.args[0] in (1060, 1061):
                    return
                raise

    _ensure_column(
        "MSTR_PERMISSIONS",
        "DISPLAY",
        "DISPLAY TINYINT(1) DEFAULT 1",
    )

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS ASTRA_RESTAURANTS (
            RESTAURANTID INT PRIMARY KEY,
            RESTAURANTGUID VARCHAR(36),
            NAME VARCHAR(255),
            STATUS ENUM('invited', 'onboarding', 'active', 'suspended') DEFAULT 'invited',
            CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY UNIQ_ASTRA_RESTAURANT_GUID (RESTAURANTGUID),
            CONSTRAINT FK_ASTRA_RESTAURANTID FOREIGN KEY(RESTAURANTID)
                REFERENCES SRC_ONBOARDING(RESTAURANTID)
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS ASTRA_EMPLOYEES (
            USERID INT PRIMARY KEY,
            RESTAURANTID INT,
            EMPLOYEEGUID VARCHAR(36),
            FNAME VARCHAR(64),
            LNAME VARCHAR(64),
            EMAIL VARCHAR(64),
            PHONE VARCHAR(12),
            STATUS ENUM('invited', 'active', 'inactive') DEFAULT 'invited',
            CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY UNIQ_ASTRA_EMPLOYEE_GUID (EMPLOYEEGUID),
            CONSTRAINT FK_ASTRA_EMPLOYEE_USERID FOREIGN KEY(USERID)
                REFERENCES USER_MASTER(USERID),
            CONSTRAINT FK_ASTRA_EMPLOYEE_RESTAURANTID FOREIGN KEY(RESTAURANTID)
                REFERENCES SRC_ONBOARDING(RESTAURANTID)
        )
    """)
    _ensure_index("ASTRA_EMPLOYEES", "IDX_ASTRA_EMPLOYEE_RESTAURANT", "RESTAURANTID")

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS ASTRA_CONNECTIONS (
            ID CHAR(36) PRIMARY KEY,
            OWNER_TYPE ENUM('restaurant', 'employee') NOT NULL,
            OWNER_ID INT NOT NULL,
            ASTRA_USER_ID VARCHAR(255),
            ASTRA_BUSINESS_PROFILE_ID VARCHAR(255),
            KYX_TYPE VARCHAR(64),
            ONBOARDING_STATUS ENUM(
                'not_started', 'in_progress', 'pending_review', 'approved', 'rejected', 'errored'
            ) DEFAULT 'not_started',
            LAST_STATUS_REASON TEXT,
            ACCESS_TOKEN_ENCRYPTED TEXT,
            REFRESH_TOKEN_ENCRYPTED TEXT,
            ACCESS_TOKEN_EXPIRES_AT DATETIME,
            REVOKED_AT DATETIME,
            CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY UNIQ_ASTRA_CONNECTION_OWNER (OWNER_TYPE, OWNER_ID)
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS ASTRA_PAYOUT_METHODS (
            ID CHAR(36) PRIMARY KEY,
            OWNER_TYPE ENUM('restaurant', 'employee') NOT NULL,
            OWNER_ID INT NOT NULL,
            METHOD_TYPE ENUM('bank_account', 'debit_card') NOT NULL,
            ASTRA_ACCOUNT_ID VARCHAR(255),
            ASTRA_CARD_ID VARCHAR(255),
            LABEL VARCHAR(255),
            BRAND VARCHAR(64),
            LAST4 VARCHAR(8),
            STATUS ENUM('active', 'pending_verification', 'disabled', 'errored') DEFAULT 'pending_verification',
            IS_PREFERRED TINYINT(1) DEFAULT 0,
            CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY UNIQ_ASTRA_PAYOUT (OWNER_TYPE, OWNER_ID, ASTRA_ACCOUNT_ID, ASTRA_CARD_ID)
        )
    """)
    _ensure_index("ASTRA_PAYOUT_METHODS", "IDX_ASTRA_PAYOUT_OWNER", "OWNER_TYPE, OWNER_ID")
    _ensure_index("ASTRA_PAYOUT_METHODS", "IDX_ASTRA_PAYOUT_PREF", "OWNER_TYPE, OWNER_ID, IS_PREFERRED")

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS ASTRA_WEBHOOK_EVENTS (
            ID CHAR(36) PRIMARY KEY,
            ASTRA_EVENT_ID VARCHAR(255),
            EVENT_TYPE VARCHAR(255) NOT NULL,
            OWNER_TYPE ENUM('restaurant', 'employee'),
            OWNER_ID INT,
            PAYLOAD_JSON JSON,
            RECEIVED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PROCESSED_AT TIMESTAMP NULL,
            PROCESSING_ERROR TEXT,
            UNIQUE KEY UNIQ_ASTRA_EVENT (ASTRA_EVENT_ID)
        )
    """)

    db.commit()
    cursor.close()
    db.close()
except pymysql.MySQLError as err:
    raise HTTPException(status_code=500, detail=f"Database connection error: {err}")

_request_timezone: ContextVar[Optional[str]] = ContextVar("request_timezone", default=None)

def set_request_timezone(timezone_value: Optional[str]):
    return _request_timezone.set(timezone_value)

def reset_request_timezone(token) -> None:
    _request_timezone.reset(token)

def _get_request_timezone() -> Optional[str]:
    return _request_timezone.get()

def _get_cursor(dictionary: bool = True):
    if not DB_CONFIG:
        raise HTTPException(status_code=500, detail="Database connection not initialized.")
    try:
        connection_config = dict(DB_CONFIG)
        if dictionary:
            connection_config["cursorclass"] = pymysql.cursors.DictCursor
        connection = pymysql.connect(**connection_config)
        cursor = connection.cursor()
        timezone_value = _get_request_timezone()
        if timezone_value:
            try:
                cursor.execute("SET time_zone = %s", (timezone_value,))
            except pymysql.MySQLError:
                pass
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

def _fetch_restaurant_timezone(restaurant_id: Optional[int] = None, restaurant_guid: Optional[str] = None) -> Optional[str]:
    cursor = _get_cursor(dictionary=True)
    try:
        if restaurant_guid:
            cursor.execute(
                """
                SELECT TIMEZONE AS timezone
                FROM GRATLYDB.SRC_RESTAURANTDETAILS
                WHERE RESTAURANTGUID = %s
                LIMIT 1
                """,
                (restaurant_guid,),
            )
        elif restaurant_id is not None:
            cursor.execute(
                """
                SELECT rd.TIMEZONE AS timezone
                FROM GRATLYDB.SRC_RESTAURANTDETAILS rd
                JOIN GRATLYDB.SRC_ONBOARDING ob ON rd.RESTAURANTGUID = ob.RESTAURANTGUID
                WHERE ob.RESTAURANTID = %s
                LIMIT 1
                """,
                (restaurant_id,),
            )
        else:
            return None
        row = cursor.fetchone()
        return row.get("timezone") if row else None
    finally:
        cursor.close()

def _fetch_restaurant_key(user_id: int) -> Optional[int]:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            "SELECT RESTAURANTID AS restaurant_id FROM GRATLYDB.USERRESTAURANT WHERE USERID = %s LIMIT 1",
            (user_id,),
        )
        row = cursor.fetchone()
        if row and row.get("restaurant_id") is not None:
            return row["restaurant_id"]
        cursor.execute(
            """
            SELECT ob.RESTAURANTID AS restaurant_id
            FROM GRATLYDB.USER_MASTER um
            JOIN GRATLYDB.SRC_EMPLOYEES se ON se.EMAIL = um.EMAIL
            JOIN GRATLYDB.SRC_ONBOARDING ob ON se.RESTAURANTGUID = ob.RESTAURANTGUID
            WHERE um.USERID = %s
            LIMIT 1
            """,
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
        if row and row.get("restaurant_name"):
            return row["restaurant_name"]
        cursor.execute(
            """
            SELECT rd.RESTAURANTNAME AS restaurant_name
            FROM GRATLYDB.USER_MASTER um
            JOIN GRATLYDB.SRC_EMPLOYEES se ON se.EMAIL = um.EMAIL
            JOIN GRATLYDB.SRC_ONBOARDING ob ON se.RESTAURANTGUID = ob.RESTAURANTGUID
            JOIN GRATLYDB.SRC_RESTAURANTDETAILS rd ON rd.RESTAURANTGUID = ob.RESTAURANTGUID
            WHERE um.USERID = %s
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
        if row and row.get("restaurant_guid"):
            return row["restaurant_guid"]
        cursor.execute(
            """
            SELECT ob.RESTAURANTGUID AS restaurant_guid
            FROM GRATLYDB.USER_MASTER um
            JOIN GRATLYDB.SRC_EMPLOYEES se ON se.EMAIL = um.EMAIL
            JOIN GRATLYDB.SRC_ONBOARDING ob ON se.RESTAURANTGUID = ob.RESTAURANTGUID
            WHERE um.USERID = %s
            LIMIT 1
            """,
            (user_id,),
        )
        row = cursor.fetchone()
        return row["restaurant_guid"] if row else None
    finally:
        cursor.close()

PERMISSION_LABELS = {
    "createPayoutSchedules": "Create Payout Schedules",
    "approvePayouts": "Approve Payouts",
    "manageTeam": "Manage Team",
    "adminAccess": "Admin Access",
    "superadminAccess": "Superadmin Access",
    "employeeOnly": "Employee Only",
    "managerAccess": "Manager Access",
}

PERMISSION_NAME_TO_KEY = {
    label.strip().lower(): key for key, label in PERMISSION_LABELS.items()
}
PERMISSION_NAME_TO_KEY["super admin access"] = "superadminAccess"

def _normalize_permission_name(value: str) -> str:
    return value.strip().lower()

def _fetch_user_permission_names(user_id: int) -> List[str]:
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT mp.PERMISSIONSNAME AS permission_name
            FROM GRATLYDB.USER_PERMISSIONS up
            JOIN GRATLYDB.MSTR_PERMISSIONS mp ON up.PERMISSIONSID = mp.PERMISSIONSID
            WHERE up.USERID = %s
              AND (mp.DELETED IS NULL OR mp.DELETED = 0)
            """,
            (user_id,),
        )
        rows = cursor.fetchall()
        return [row["permission_name"] for row in rows if row.get("permission_name")]
    finally:
        cursor.close()

def _fetch_user_permission_flags(user_id: int) -> Optional[dict]:
    permission_names = _fetch_user_permission_names(user_id)
    permissions = _serialize_permissions(permission_names)
    if permissions is None:
        return None
    has_business_access = bool(
        permissions.get("adminAccess")
        or permissions.get("superadminAccess")
        or permissions.get("managerAccess")
        or permissions.get("createPayoutSchedules")
        or permissions.get("approvePayouts")
        or permissions.get("manageTeam")
    )
    return {
        "isAdmin": has_business_access,
        "isEmployee": bool(permissions.get("employeeOnly")),
    }

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

def _serialize_permissions(permission_names: Optional[Iterable[str]]) -> Optional[dict]:
    if permission_names is None:
        return None
    permissions = {key: False for key in PERMISSION_LABELS}
    for name in permission_names:
        if not name:
            continue
        key = PERMISSION_NAME_TO_KEY.get(_normalize_permission_name(name))
        if key:
            permissions[key] = True
    return permissions

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
