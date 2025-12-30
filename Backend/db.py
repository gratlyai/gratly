from fastapi import HTTPException
import pymysql
import os
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

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS STRIPE_CONNECTED_ACCOUNTS (
            RESTAURANTGUID VARCHAR(36),
            EMPLOYEEGUID VARCHAR(64) NOT NULL PRIMARY KEY,
            STRIPE_ACCOUNT_ID VARCHAR(64) NOT NULL,
            CREATEDAT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UPDATEDAT TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
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
            cursor.execute(f"ALTER TABLE GRATLYDB.{table} ADD COLUMN {ddl}")

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
            cursor.execute(f"CREATE INDEX {index_name} ON GRATLYDB.{table} ({columns})")

    _ensure_column(
        "STRIPE_CONNECTED_ACCOUNTS",
        "CHARGES_ENABLED",
        "CHARGES_ENABLED TINYINT(1) DEFAULT 0",
    )
    _ensure_column(
        "STRIPE_CONNECTED_ACCOUNTS",
        "PAYOUTS_ENABLED",
        "PAYOUTS_ENABLED TINYINT(1) DEFAULT 0",
    )
    _ensure_column(
        "STRIPE_CONNECTED_ACCOUNTS",
        "DETAILS_SUBMITTED",
        "DETAILS_SUBMITTED TINYINT(1) DEFAULT 0",
    )
    _ensure_column(
        "STRIPE_CONNECTED_ACCOUNTS",
        "DISABLED_REASON",
        "DISABLED_REASON VARCHAR(255)",
    )
    _ensure_column(
        "STRIPE_CONNECTED_ACCOUNTS",
        "ACCOUNT_DEAUTHORIZED",
        "ACCOUNT_DEAUTHORIZED TINYINT(1) DEFAULT 0",
    )
    _ensure_column(
        "STRIPE_CONNECTED_ACCOUNTS",
        "RESTAURANTGUID",
        "RESTAURANTGUID VARCHAR(36) FIRST",
    )

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS STRIPE_PAYMENT_EVENTS (
            RESTAURANTGUID VARCHAR(36),
            EVENT_ID VARCHAR(255) NOT NULL PRIMARY KEY,
            EVENT_TYPE VARCHAR(128) NOT NULL,
            PAYMENT_INTENT_ID VARCHAR(255),
            EMPLOYEEGUID VARCHAR(64),
            AMOUNT BIGINT,
            CURRENCY VARCHAR(16),
            STATUS VARCHAR(64),
            CREATED_AT DATETIME,
            RAW_PAYLOAD JSON
        )
    """)
    _ensure_index("STRIPE_PAYMENT_EVENTS", "IDX_STRIPE_PAYMENT_EMPLOYEE", "EMPLOYEEGUID")
    _ensure_index("STRIPE_PAYMENT_EVENTS", "IDX_STRIPE_PAYMENT_RESTAURANT", "RESTAURANTGUID")
    _ensure_index("STRIPE_PAYMENT_EVENTS", "IDX_STRIPE_PAYMENT_INTENT", "PAYMENT_INTENT_ID")

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS STRIPE_DISPUTE_EVENTS (
            RESTAURANTGUID VARCHAR(36),
            EVENT_ID VARCHAR(255) NOT NULL PRIMARY KEY,
            EVENT_TYPE VARCHAR(128) NOT NULL,
            DISPUTE_ID VARCHAR(255),
            CHARGE_ID VARCHAR(255),
            EMPLOYEEGUID VARCHAR(64),
            AMOUNT BIGINT,
            CURRENCY VARCHAR(16),
            STATUS VARCHAR(64),
            REASON VARCHAR(255),
            CREATED_AT DATETIME,
            RAW_PAYLOAD JSON
        )
    """)
    _ensure_index("STRIPE_DISPUTE_EVENTS", "IDX_STRIPE_DISPUTE_EMPLOYEE", "EMPLOYEEGUID")
    _ensure_index("STRIPE_DISPUTE_EVENTS", "IDX_STRIPE_DISPUTE_RESTAURANT", "RESTAURANTGUID")
    _ensure_index("STRIPE_DISPUTE_EVENTS", "IDX_STRIPE_DISPUTE_CHARGE", "CHARGE_ID")

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS STRIPE_BALANCE_EVENTS (
            RESTAURANTGUID VARCHAR(36),
            EVENT_ID VARCHAR(255) NOT NULL PRIMARY KEY,
            EVENT_TYPE VARCHAR(128) NOT NULL,
            CREATED_AT DATETIME,
            RAW_PAYLOAD JSON
        )
    """)
    _ensure_column(
        "STRIPE_BALANCE_EVENTS",
        "RESTAURANTGUID",
        "RESTAURANTGUID VARCHAR(36) FIRST",
    )
    _ensure_index("STRIPE_BALANCE_EVENTS", "IDX_STRIPE_BALANCE_CREATED", "CREATED_AT")

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS STRIPE_TRANSFER_EVENTS (
            RESTAURANTGUID VARCHAR(36),
            EVENT_ID VARCHAR(255) NOT NULL PRIMARY KEY,
            EVENT_TYPE VARCHAR(128) NOT NULL,
            TRANSFER_ID VARCHAR(255),
            EMPLOYEEGUID VARCHAR(64),
            AMOUNT BIGINT,
            CURRENCY VARCHAR(16),
            STATUS VARCHAR(64),
            DESTINATION_ACCOUNT VARCHAR(255),
            CREATED_AT DATETIME,
            RAW_PAYLOAD JSON
        )
    """)
    _ensure_index("STRIPE_TRANSFER_EVENTS", "IDX_STRIPE_TRANSFER_EMPLOYEE", "EMPLOYEEGUID")
    _ensure_index("STRIPE_TRANSFER_EVENTS", "IDX_STRIPE_TRANSFER_RESTAURANT", "RESTAURANTGUID")
    _ensure_index("STRIPE_TRANSFER_EVENTS", "IDX_STRIPE_TRANSFER_ID", "TRANSFER_ID")

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS STRIPE_PAYOUT_EVENTS (
            RESTAURANTGUID VARCHAR(36),
            EVENT_ID VARCHAR(255) NOT NULL PRIMARY KEY,
            EVENT_TYPE VARCHAR(128) NOT NULL,
            PAYOUT_ID VARCHAR(255),
            EMPLOYEEGUID VARCHAR(64),
            AMOUNT BIGINT,
            CURRENCY VARCHAR(16),
            STATUS VARCHAR(64),
            ARRIVAL_DATE BIGINT,
            PAYOUT_METHOD VARCHAR(32),
            DESTINATION VARCHAR(255),
            ACCOUNT_ID VARCHAR(255),
            CREATED_AT DATETIME,
            RAW_PAYLOAD JSON
        )
    """)
    _ensure_index("STRIPE_PAYOUT_EVENTS", "IDX_STRIPE_PAYOUT_EMPLOYEE", "EMPLOYEEGUID")
    _ensure_index("STRIPE_PAYOUT_EVENTS", "IDX_STRIPE_PAYOUT_RESTAURANT", "RESTAURANTGUID")
    _ensure_index("STRIPE_PAYOUT_EVENTS", "IDX_STRIPE_PAYOUT_ID", "PAYOUT_ID")

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS STRIPE_RESTAURANT_SETTINGS (
            RESTAURANTGUID VARCHAR(36),
            RESTAURANTID INT NOT NULL PRIMARY KEY,
            STRIPE_CUSTOMER_ID VARCHAR(255),
            US_BANK_PAYMENT_METHOD_ID VARCHAR(255),
            BANK_LAST4 VARCHAR(8),
            BANK_NAME VARCHAR(255),
            UPDATED_AT DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                ON UPDATE CURRENT_TIMESTAMP
        )
    """)
    _ensure_column(
        "STRIPE_RESTAURANT_SETTINGS",
        "BANK_LAST4",
        "BANK_LAST4 VARCHAR(8)",
    )
    _ensure_column(
        "STRIPE_RESTAURANT_SETTINGS",
        "BANK_NAME",
        "BANK_NAME VARCHAR(255)",
    )
    _ensure_column(
        "STRIPE_RESTAURANT_SETTINGS",
        "RESTAURANTGUID",
        "RESTAURANTGUID VARCHAR(36) FIRST",
    )

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS STRIPE_EMPLOYEE_CARRY_FORWARD (
            RESTAURANTGUID VARCHAR(36),
            EMPLOYEEGUID VARCHAR(64) NOT NULL,
            RESTAURANTID INT NOT NULL,
            CARRY_FORWARD_CENTS BIGINT NOT NULL DEFAULT 0,
            UPDATED_AT DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (EMPLOYEEGUID, RESTAURANTID)
        )
    """)
    _ensure_column(
        "STRIPE_EMPLOYEE_CARRY_FORWARD",
        "RESTAURANTGUID",
        "RESTAURANTGUID VARCHAR(36) FIRST",
    )

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS STRIPE_SETTLEMENT_TRANSFERS (
            RESTAURANTGUID VARCHAR(36),
            SETTLEMENT_ID VARCHAR(64) NOT NULL,
            EMPLOYEEGUID VARCHAR(64) NOT NULL,
            TRANSFER_ID VARCHAR(255) NOT NULL,
            AMOUNT_CENTS BIGINT NOT NULL,
            FEE_CENTS BIGINT NOT NULL,
            CARRY_FORWARD_CENTS BIGINT NOT NULL DEFAULT 0,
            CREATED_AT DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (SETTLEMENT_ID, EMPLOYEEGUID)
        )
    """)
    _ensure_index("STRIPE_SETTLEMENT_TRANSFERS", "IDX_STRIPE_SETTLEMENT_TRANSFER_ID", "TRANSFER_ID")
    _ensure_column(
        "STRIPE_SETTLEMENT_TRANSFERS",
        "RESTAURANTGUID",
        "RESTAURANTGUID VARCHAR(36) FIRST",
    )

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
    "employeeOnly": "Employee Only",
    "managerAccess": "Manager Access",
}

PERMISSION_NAME_TO_KEY = {
    label.strip().lower(): key for key, label in PERMISSION_LABELS.items()
}

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
