from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import pymysql
import os
from dotenv import load_dotenv
import configparser
import hashlib
import json
from pydantic import BaseModel
from typing import List, Optional, Any
from datetime import date, timedelta

def _prehash(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()

def hash_password(password: str) -> str:
    return _prehash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return _prehash(plain_password) == hashed_password

def _serialize_date(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, date):
        return value.isoformat()
    return str(value)

def _serialize_time(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, timedelta):
        total_seconds = int(value.total_seconds())
        hours = (total_seconds // 3600) % 24
        minutes = (total_seconds % 3600) // 60
        seconds = total_seconds % 60
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
    return str(value)

def _deserialize_form(row: Optional[dict]) -> Optional[dict]:
    if not row:
        return row
    row["start_date"] = _serialize_date(row.get("start_date"))
    row["end_date"] = _serialize_date(row.get("end_date"))
    row["start_time"] = _serialize_time(row.get("start_time"))
    row["end_time"] = _serialize_time(row.get("end_time"))
    row["funds_from"] = json.loads(row["funds_from"] or "[]")
    row["positions_pay_into"] = json.loads(row["positions_pay_into"] or "[]")
    row["positions_paid_from_sales"] = json.loads(row["positions_paid_from_sales"] or "[]")
    row["positions_paid_from_tips"] = json.loads(row["positions_paid_from_tips"] or "[]")
    row["tip_percentages"] = json.loads(row["tip_percentages"] or "{}")
    row["flat_rate_positions"] = json.loads(row["flat_rate_positions"] or "[]")
    return row

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

app = FastAPI()

# ✅ Allow React to talk to backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ✅ MySQL connection
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

    # Create user master table if it doesn't exist.
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

    # Create forms table if it doesn't exist
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS forms (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            name VARCHAR(255) NOT NULL,
            start_date DATE,
            end_date DATE,
            start_time TIME,
            end_time TIME,
            order_calculation VARCHAR(50),
            tip_pool_type VARCHAR(50),
            funds_from JSON,
            tip_division VARCHAR(255),
            positions_pay_into JSON,
            positions_paid_from_sales JSON,
            positions_paid_from_tips JSON,
            tip_percentages JSON,
            flat_rate_positions JSON,
            flat_rate_amount DECIMAL(10, 2),
            flat_rate_type VARCHAR(50),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES USER_MASTER(USERID)
        )
    """)

    db.commit() # Commit the table creations

    cursor.close()
    db.close()

except pymysql.MySQLError as err:
    raise HTTPException(status_code=500, detail=f"Database connection error: {err}")

print("DB HOST:", _get_env_or_ini("DB_HOST"))
print("DB USER:", _get_env_or_ini("DB_USER"))
print("DB NAME:", _get_env_or_ini("DB_NAME"))

# Pydantic models for forms
class FormCreate(BaseModel):
    user_id: int  # Temporarily, this will come from frontend; later from JWT
    name: str
    start_date: Optional[str] = None  # Using str for date/time to match frontend input type
    end_date: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    order_calculation: Optional[str] = None
    tip_pool_type: Optional[str] = None
    funds_from: Optional[List[dict]] = None
    tip_division: Optional[str] = None
    positions_pay_into: Optional[List[str]] = None
    positions_paid_from_sales: Optional[List[str]] = None
    positions_paid_from_tips: Optional[List[str]] = None
    tip_percentages: Optional[dict] = None
    flat_rate_positions: Optional[List[str]] = None
    flat_rate_amount: Optional[float] = None  # Changed to float for numerical value
    flat_rate_type: Optional[str] = None

class FormResponse(FormCreate):
    id: int
    created_at: Any # datetime object from DB will be returned here

class FormsDeleteRequest(BaseModel):
    user_id: int
    form_ids: List[int]

class EmployeeResponse(BaseModel):
    userId: Optional[int] = None
    employeeGuid: Optional[str] = None
    firstName: Optional[str] = None
    lastName: Optional[str] = None
    phoneNumber: Optional[str] = None
    email: Optional[str] = None
    is_active: str

class UserPermissionsPayload(BaseModel):
    createPayoutSchedules: bool
    approvePayouts: bool
    manageTeam: bool
    adminAccess: bool
    employeeOnly: bool


@app.post("/forms", response_model=FormResponse)
def create_form(form: FormCreate):
    cursor = _get_cursor(dictionary=True)
    try:
        funds_from = form.funds_from or []
        positions_pay_into = form.positions_pay_into or []
        positions_paid_from_sales = form.positions_paid_from_sales or []
        positions_paid_from_tips = form.positions_paid_from_tips or []
        tip_percentages = form.tip_percentages or {}
        flat_rate_positions = form.flat_rate_positions or []
        query = """
            INSERT INTO forms (
                user_id, name, start_date, end_date, start_time, end_time,
                order_calculation, tip_pool_type, funds_from, tip_division,
                positions_pay_into, positions_paid_from_sales, positions_paid_from_tips,
                tip_percentages, flat_rate_positions, flat_rate_amount, flat_rate_type
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """
        cursor.execute(query, (
            form.user_id, form.name, form.start_date, form.end_date, form.start_time, form.end_time,
            form.order_calculation, form.tip_pool_type, json.dumps(funds_from),
            form.tip_division, json.dumps(positions_pay_into),
            json.dumps(positions_paid_from_sales), json.dumps(positions_paid_from_tips),
            json.dumps(tip_percentages), json.dumps(flat_rate_positions),
            form.flat_rate_amount, form.flat_rate_type
        ))
        cursor.connection.commit()

        form_id = cursor.lastrowid
        cursor.execute("SELECT * FROM forms WHERE id = %s", (form_id,))
        new_form = cursor.fetchone()
        return _deserialize_form(new_form)
    except pymysql.MySQLError as err:
        raise HTTPException(status_code=500, detail=f"Error creating form: {err}")
    finally:
        cursor.close()

@app.get("/forms", response_model=List[FormResponse])
def get_forms(user_id: int): # user_id will eventually come from JWT
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute("SELECT * FROM forms WHERE user_id = %s", (user_id,))
        forms = cursor.fetchall()
        return [_deserialize_form(form) for form in forms]
    except pymysql.MySQLError as err:
        raise HTTPException(status_code=500, detail=f"Error fetching forms: {err}")
    finally:
        cursor.close()

@app.get("/employees", response_model=List[EmployeeResponse])
def get_employees():
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT
                user_master.USERID AS userId,
                SRC_EMPLOYEES.EMPLOYEEGUID AS employeeGuid,
                SRC_EMPLOYEES.EMPLOYEEFNAME AS firstName,
                SRC_EMPLOYEES.EMPLOYEELNAME AS lastName,
                SRC_EMPLOYEES.PHONENUMBER AS phoneNumber,
                case when SRC_EMPLOYEES.deleted = 1 then 'Inactive' else 'Active' end as is_active,
                SRC_EMPLOYEES.EMAIL AS email
            FROM GRATLYDB.SRC_EMPLOYEES
            LEFT JOIN GRATLYDB.USER_MASTER AS user_master
                ON user_master.EMAIL = SRC_EMPLOYEES.EMAIL
            order by SRC_EMPLOYEES.employeefname
            """
        )
        return cursor.fetchall()
    except pymysql.MySQLError as err:
        raise HTTPException(status_code=500, detail=f"Error fetching employees: {err}")
    finally:
        cursor.close()

@app.get("/total-gratuity")
def get_total_gratuity():
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT
                COALESCE(SUM(CASE
                    WHEN BUSINESSDATE = DATE_SUB(CURDATE(), INTERVAL 1 DAY)
                    THEN NONCASHGRATUITYSERVICECHARGES
                    ELSE 0
                END), 0) AS total_gratuity,
                COALESCE(SUM(CASE
                    WHEN BUSINESSDATE = DATE_SUB(CURDATE(), INTERVAL 8 DAY)
                    THEN NONCASHGRATUITYSERVICECHARGES
                    ELSE 0
                END), 0) AS gratuity_change
                ,
                COALESCE(SUM(CASE
                    WHEN BUSINESSDATE = DATE_SUB(CURDATE(), INTERVAL 1 DAY)
                    THEN NONCASHTIPS
                    ELSE 0
                END), 0) AS total_tips
                ,
                COALESCE(SUM(CASE
                    WHEN BUSINESSDATE = DATE_SUB(CURDATE(), INTERVAL 8 DAY)
                    THEN NONCASHTIPS
                    ELSE 0
                END), 0) AS tips_change
            FROM GRATLYDB.SRC_TIMEENTRIES
            """
        )
        row = cursor.fetchone() or {}
        total_gratuity = row.get("total_gratuity") or 0
        gratuity_change = row.get("gratuity_change") or 0
        total_tips = row.get("total_tips") or 0
        tips_change = row.get("tips_change") or 0
        cursor.execute(
            """
            SELECT
                COALESCE(SUM(CASE
                    WHEN BUSINESSDATE = DATE_SUB(CURDATE(), INTERVAL 1 DAY)
                    THEN COALESCE(TOTALAMOUNT, 0) - (COALESCE(TAXAMOUNT, 0) + COALESCE(TIPAMOUNT, 0) + COALESCE(GRATUITYAMOUNT, 0))
                    ELSE 0
                END), 0) AS net_sales,
                COALESCE(SUM(CASE
                    WHEN BUSINESSDATE = DATE_SUB(CURDATE(), INTERVAL 8 DAY)
                    THEN COALESCE(TOTALAMOUNT, 0) - (COALESCE(TAXAMOUNT, 0) + COALESCE(TIPAMOUNT, 0) + COALESCE(GRATUITYAMOUNT, 0))
                    ELSE 0
                END), 0) AS net_sales_change
            FROM GRATLYDB.SRC_ALLORDERS
            """
        )
        net_sales_row = cursor.fetchone() or {}
        net_sales = net_sales_row.get("net_sales") or 0
        net_sales_change = net_sales_row.get("net_sales_change") or 0
        return {
            "totalGratuity": float(total_gratuity),
            "gratuityChange": float(gratuity_change),
            "totalTips": float(total_tips),
            "tipsChange": float(tips_change),
            "netSales": float(net_sales),
            "netSalesChange": float(net_sales_change),
        }
    except pymysql.MySQLError as err:
        raise HTTPException(status_code=500, detail=f"Error fetching total gratuity: {err}")
    finally:
        cursor.close()

@app.get("/employees/{employee_guid}", response_model=EmployeeResponse)
def get_employee(employee_guid: str):
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT
                user_master.USERID AS userId,
                SRC_EMPLOYEES.EMPLOYEEGUID AS employeeGuid,
                SRC_EMPLOYEES.EMPLOYEEFNAME AS firstName,
                SRC_EMPLOYEES.EMPLOYEELNAME AS lastName,
                SRC_EMPLOYEES.PHONENUMBER AS phoneNumber,
                case when SRC_EMPLOYEES.deleted = 1 then 'Inactive' else 'Active' end as is_active,
                SRC_EMPLOYEES.EMAIL AS email
            FROM GRATLYDB.SRC_EMPLOYEES
            LEFT JOIN GRATLYDB.USER_MASTER AS user_master
                ON user_master.EMAIL = SRC_EMPLOYEES.EMAIL
            WHERE SRC_EMPLOYEES.EMPLOYEEGUID = %s
            LIMIT 1
            """,
            (employee_guid,),
        )
        employee = cursor.fetchone()
        if not employee:
            raise HTTPException(status_code=404, detail="Employee not found")
        return employee
    except pymysql.MySQLError as err:
        raise HTTPException(status_code=500, detail=f"Error fetching employee: {err}")
    finally:
        cursor.close()

@app.get("/user-permissions/{user_id}", response_model=UserPermissionsPayload)
def get_user_permissions(user_id: int):
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT
                ISADMIN AS isAdmin,
                ISEMPLOYEE AS isEmployee,
                ISCREATEPAYOUTSCHEDULE AS isCreatePayoutSchedule,
                ISAPPROVEPAYOUT AS isApprovePayout,
                ISMANAGEEMPLOYEES AS isManageEmployees
            FROM GRATLYDB.USER_PERMISSIONS
            WHERE USERID = %s
            LIMIT 1
            """,
            (user_id,),
        )
        row = cursor.fetchone()
        permissions = _serialize_permissions(row)
        if not permissions:
            raise HTTPException(status_code=404, detail="User permissions not found")
        return permissions
    except pymysql.MySQLError as err:
        raise HTTPException(status_code=500, detail=f"Error fetching user permissions: {err}")
    finally:
        cursor.close()

@app.put("/user-permissions/{user_id}", response_model=UserPermissionsPayload)
def update_user_permissions(user_id: int, payload: UserPermissionsPayload):
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            UPDATE GRATLYDB.USER_PERMISSIONS
            SET
                ISADMIN = %s,
                ISEMPLOYEE = %s,
                ISCREATEPAYOUTSCHEDULE = %s,
                ISAPPROVEPAYOUT = %s,
                ISMANAGEEMPLOYEES = %s,
                MODIFIEDDATE = CURRENT_TIMESTAMP
            WHERE USERID = %s
            """,
            (
                payload.adminAccess,
                payload.employeeOnly,
                payload.createPayoutSchedules,
                payload.approvePayouts,
                payload.manageTeam,
                user_id,
            ),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="User permissions not found")
        cursor.execute(
            """
            SELECT
                ISADMIN AS isAdmin,
                ISEMPLOYEE AS isEmployee,
                ISCREATEPAYOUTSCHEDULE AS isCreatePayoutSchedule,
                ISAPPROVEPAYOUT AS isApprovePayout,
                ISMANAGEEMPLOYEES AS isManageEmployees
            FROM GRATLYDB.USER_PERMISSIONS
            WHERE USERID = %s
            LIMIT 1
            """,
            (user_id,),
        )
        row = cursor.fetchone()
        permissions = _serialize_permissions(row)
        if not permissions:
            raise HTTPException(status_code=404, detail="User permissions not found")
        return permissions
    except pymysql.MySQLError as err:
        raise HTTPException(status_code=500, detail=f"Error updating user permissions: {err}")
    finally:
        cursor.close()

@app.put("/forms/{form_id}", response_model=FormResponse)
def update_form(form_id: int, form: FormCreate):
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute("SELECT id FROM forms WHERE id = %s AND user_id = %s", (form_id, form.user_id))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Form not found")

        funds_from = form.funds_from or []
        positions_pay_into = form.positions_pay_into or []
        positions_paid_from_sales = form.positions_paid_from_sales or []
        positions_paid_from_tips = form.positions_paid_from_tips or []
        tip_percentages = form.tip_percentages or {}
        flat_rate_positions = form.flat_rate_positions or []

        query = """
            UPDATE forms
            SET
                name = %s,
                start_date = %s,
                end_date = %s,
                start_time = %s,
                end_time = %s,
                order_calculation = %s,
                tip_pool_type = %s,
                funds_from = %s,
                tip_division = %s,
                positions_pay_into = %s,
                positions_paid_from_sales = %s,
                positions_paid_from_tips = %s,
                tip_percentages = %s,
                flat_rate_positions = %s,
                flat_rate_amount = %s,
                flat_rate_type = %s
            WHERE id = %s AND user_id = %s
        """
        cursor.execute(query, (
            form.name,
            form.start_date,
            form.end_date,
            form.start_time,
            form.end_time,
            form.order_calculation,
            form.tip_pool_type,
            json.dumps(funds_from),
            form.tip_division,
            json.dumps(positions_pay_into),
            json.dumps(positions_paid_from_sales),
            json.dumps(positions_paid_from_tips),
            json.dumps(tip_percentages),
            json.dumps(flat_rate_positions),
            form.flat_rate_amount,
            form.flat_rate_type,
            form_id,
            form.user_id
        ))
        cursor.connection.commit()

        cursor.execute("SELECT * FROM forms WHERE id = %s", (form_id,))
        updated_form = cursor.fetchone()
        return _deserialize_form(updated_form)
    except pymysql.MySQLError as err:
        raise HTTPException(status_code=500, detail=f"Error updating form: {err}")
    finally:
        cursor.close()

@app.delete("/forms")
def delete_forms(payload: FormsDeleteRequest):
    if not payload.form_ids:
        raise HTTPException(status_code=400, detail="No form IDs provided")

    cursor = _get_cursor(dictionary=False)
    try:
        placeholders = ", ".join(["%s"] * len(payload.form_ids))
        query = f"DELETE FROM forms WHERE user_id = %s AND id IN ({placeholders})"
        cursor.execute(query, (payload.user_id, *payload.form_ids))
        cursor.connection.commit()
        return {"success": True, "deleted": cursor.rowcount}
    except pymysql.MySQLError as err:
        raise HTTPException(status_code=500, detail=f"Error deleting forms: {err}")
    finally:
        cursor.close()

@app.post("/signup")
def signup(data: dict):
    cursor = _get_cursor(dictionary=True)

    firstname = data.get("firstName")
    lastname = data.get("lastName")
    email = data.get("email")
    phonenumber = data.get("phoneNumber")
    password = data.get("password")

    if not all([firstname, lastname, email, password]):
        raise HTTPException(status_code=400, detail="Missing required fields")

    # Password validation (matching frontend requirements)
    min_length = 8
    max_length = 12
    has_uppercase = any(c.isupper() for c in password)
    has_number = any(c.isdigit() for c in password)
    has_special_char = any(c in "!@#$%^&*()_+-=[]{};':\"\\|,.<>/?" for c in password)

    if not (min_length <= len(password) <= max_length and has_uppercase and has_number and has_special_char):
        raise HTTPException(status_code=400, detail="Password does not meet requirements: must be 8-12 characters, include an uppercase letter, a number, and a special character.")


    # ✅ Check if email already exists
    cursor.execute(
        "SELECT USERID AS user_id FROM USER_MASTER WHERE EMAIL = %s",
        (email,)
    )
    if cursor.fetchone():
        raise HTTPException(status_code=400, detail="Email already exists")

    # ✅ Hash password ONCE
    password_hash = hash_password(password)

    # ✅ Insert into database
    cursor.execute(
        """
        INSERT INTO USER_MASTER (FIRSTNAME, LASTNAME, EMAIL, PHONENUMBER, PASSWORD_HASH)
        VALUES (%s, %s, %s, %s, %s)
        """,
        (firstname, lastname, email, phonenumber, password_hash)
    )

    user_id = cursor.lastrowid

    cursor.execute(
        "INSERT INTO GRATLYDB.USERRESTAURANT (USERID) VALUES (%s)",
        (user_id,),
    )

    cursor.execute(
        """
        INSERT INTO GRATLYDB.USER_PERMISSIONS (
            USERID,
            ISADMIN,
            ISEMPLOYEE,
            ISCREATEPAYOUTSCHEDULE,
            ISAPPROVEPAYOUT,
            ISMANAGEEMPLOYEES
        )
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (user_id, False, True, False, False, False),
    )

    restaurant_id = _fetch_restaurant_id_for_email(email)
    if restaurant_id is not None:
        cursor.execute(
            "UPDATE GRATLYDB.USERRESTAURANT SET RESTAURANTID = %s WHERE USERID = %s",
            (restaurant_id, user_id),
        )

    cursor.connection.commit()

    restaurant_key = _fetch_restaurant_key(user_id)
    restaurant_name = _fetch_restaurant_name(user_id)

    return {
        "success": True,
        "user_id": user_id,
        "first_name": firstname,
        "last_name": lastname,
        "restaurant_key": restaurant_key,
        "restaurant_name": restaurant_name,
    }


@app.post("/login")
def login(data: dict):
    cursor = _get_cursor(dictionary=True)

    email = data.get("email")
    password = data.get("password")

    cursor.execute(
        """
        SELECT
            USERID AS user_id,
            FIRSTNAME AS firstname,
            LASTNAME AS lastname,
            PASSWORD_HASH AS password_hash
        FROM USER_MASTER
        WHERE EMAIL = %s
        """,
        (email,)
    )
    user = cursor.fetchone()

    if not user:
        return {"success": False}

    # ✅ Verify hashed password
    if verify_password(password, user["password_hash"]):
        restaurant_key = _fetch_restaurant_key(user["user_id"])
        restaurant_name = _fetch_restaurant_name(user["user_id"])
        return {
            "success": True,
            "user_id": user["user_id"],
            "first_name": user.get("firstname"),
            "last_name": user.get("lastname"),
            "restaurant_key": restaurant_key,
            "restaurant_name": restaurant_name,
        }
    else:
        return {"success": False}
