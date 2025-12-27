from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import pymysql
from pydantic import BaseModel
from typing import List, Optional

try:
    from Backend.security import hash_password, verify_password
    from Backend.email_utils import send_sendgrid_email
    from Backend.db import (
        _get_cursor,
        _fetch_restaurant_key,
        _fetch_restaurant_name,
        _fetch_restaurant_guid,
        _fetch_user_permission_flags,
        _fetch_employee_guid_for_user,
        _serialize_permissions,
        _fetch_restaurant_id_for_email,
        _get_env_or_ini,
    )
    from Backend.payout_schedules import router as payout_schedules_router
    from Backend.password_reset import router as password_reset_router
    from Backend.approvals import router as approvals_router
except ImportError:
    from db import (
        _get_cursor,
        _fetch_restaurant_key,
        _fetch_restaurant_name,
        _fetch_restaurant_guid,
        _fetch_user_permission_flags,
        _fetch_employee_guid_for_user,
        _serialize_permissions,
        _fetch_restaurant_id_for_email,
        _get_env_or_ini,
    )
    from payout_schedules import router as payout_schedules_router
    from password_reset import router as password_reset_router
    from approvals import router as approvals_router
    from security import hash_password, verify_password
    from email_utils import send_sendgrid_email

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

app.include_router(payout_schedules_router)
app.include_router(password_reset_router)
app.include_router(approvals_router)

print("DB HOST:", _get_env_or_ini("DB_HOST"))
print("DB USER:", _get_env_or_ini("DB_USER"))
print("DB NAME:", _get_env_or_ini("DB_NAME"))

class EmployeeResponse(BaseModel):
    userId: Optional[int] = None
    employeeGuid: Optional[str] = None
    firstName: Optional[str] = None
    lastName: Optional[str] = None
    phoneNumber: Optional[str] = None
    email: Optional[str] = None
    is_active: str

class UserProfileResponse(BaseModel):
    firstName: Optional[str] = None
    lastName: Optional[str] = None
    email: Optional[str] = None
    phoneNumber: Optional[str] = None
    restaurantName: Optional[str] = None

class UserProfileUpdatePayload(BaseModel):
    firstName: Optional[str] = None
    lastName: Optional[str] = None
    email: Optional[str] = None
    phoneNumber: Optional[str] = None

class UserPermissionsPayload(BaseModel):
    createPayoutSchedules: bool
    approvePayouts: bool
    manageTeam: bool
    adminAccess: bool
    employeeOnly: bool

class TeamInvitePayload(BaseModel):
    user_id: int
    email: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    employee_guid: Optional[str] = None

class EmployeeJobResponse(BaseModel):
    employeeGuid: Optional[str] = None
    firstName: Optional[str] = None
    lastName: Optional[str] = None
    jobTitle: Optional[str] = None

def _send_sendgrid_email(to_email: str, subject: str, content: str, sender_name: Optional[str] = None):
    send_sendgrid_email(to_email=to_email, subject=subject, content=content, sender_name=sender_name)

def _insert_invite_log(cursor, payload: TeamInvitePayload, status: str, provider_response: Optional[str] = None) -> int:
    cursor.execute(
        """
        INSERT INTO GRATLYDB.EMAIL_INVITES (
            USERID,
            EMPLOYEEGUID,
            EMAIL,
            FIRSTNAME,
            LASTNAME,
            STATUS,
            PROVIDER,
            PROVIDER_RESPONSE
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            payload.user_id,
            payload.employee_guid,
            payload.email,
            payload.first_name,
            payload.last_name,
            status,
            "sendgrid",
            provider_response,
        ),
    )
    return cursor.lastrowid

def _update_invite_log(cursor, invite_id: int, status: str, provider_response: Optional[str] = None):
    cursor.execute(
        """
        UPDATE GRATLYDB.EMAIL_INVITES
        SET STATUS = %s,
            PROVIDER_RESPONSE = %s
        WHERE INVITEID = %s
        """,
        (status, provider_response, invite_id),
    )


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

@app.get("/employees/active-by-job", response_model=List[EmployeeJobResponse])
def get_active_employees_by_job(restaurant_id: int):
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT
                se.EMPLOYEEGUID AS employeeGuid,
                se.EMPLOYEEFNAME AS firstName,
                se.EMPLOYEELNAME AS lastName,
                sj.JOBTITLE AS jobTitle
            FROM GRATLYDB.SRC_EMPLOYEES se
            JOIN GRATLYDB.SRC_EMPLOYEEROLE ser
                ON ser.RESTAURANTGUID = se.RESTAURANTGUID
                AND ser.EMPLOYEEGUID = se.EMPLOYEEGUID
            JOIN GRATLYDB.SRC_JOBS sj
                ON sj.JOBGUID = ser.JOBGUID
                AND sj.RESTAURANTGUID = ser.RESTAURANTGUID
            JOIN GRATLYDB.SRC_ONBOARDING so
                ON so.RESTAURANTGUID = se.RESTAURANTGUID
            WHERE so.RESTAURANTID = %s
              AND se.DELETED = 0
              AND sj.JOBTITLE IS NOT NULL
              AND sj.JOBTITLE <> ''
            ORDER BY sj.JOBTITLE, se.EMPLOYEEFNAME, se.EMPLOYEELNAME
            """,
            (restaurant_id,),
        )
        return cursor.fetchall()
    except pymysql.MySQLError as err:
        raise HTTPException(status_code=500, detail=f"Error fetching active employees: {err}")
    finally:
        cursor.close()

@app.post("/team/invite")
def send_team_invite(payload: TeamInvitePayload):
    email = payload.email.strip() if payload.email else ""
    if not email:
        raise HTTPException(status_code=400, detail="Email is required")
    restaurant_name = _fetch_restaurant_name(payload.user_id) or "Gratly"
    recipient_name = " ".join(
        part for part in [payload.first_name or "", payload.last_name or ""] if part.strip()
    ).strip()
    greeting = f"Hi {recipient_name}," if recipient_name else "Hi,"
    message = (
        f"{greeting}\n\n"
        f"You've been invited to Gratly by {restaurant_name}.\n"
        "Please create your account to access your shifts and payouts.\n\n"
        "If you weren't expecting this invite, you can ignore this email."
    )
    cursor = _get_cursor(dictionary=False)
    conn = cursor.connection
    invite_id = None
    try:
        invite_id = _insert_invite_log(cursor, payload, "pending")
        conn.commit()
        _send_sendgrid_email(
            to_email=email,
            subject=f"You're invited to Gratly by {restaurant_name}",
            content=message,
            sender_name=restaurant_name,
        )
        _update_invite_log(cursor, invite_id, "sent")
        conn.commit()
        return {"success": True, "invite_id": invite_id}
    except HTTPException as err:
        if invite_id is None:
            try:
                invite_id = _insert_invite_log(cursor, payload, "failed", err.detail)
                conn.commit()
            except pymysql.MySQLError:
                conn.rollback()
        else:
            try:
                _update_invite_log(cursor, invite_id, "failed", err.detail)
                conn.commit()
            except pymysql.MySQLError:
                conn.rollback()
        raise
    except pymysql.MySQLError as err:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Error logging invite: {err}")
    finally:
        cursor.close()

@app.get("/job-titles", response_model=List[str])
def get_job_titles(user_id: int):
    cursor = _get_cursor(dictionary=True)
    try:
        restaurant_guid = _fetch_restaurant_guid(user_id)
        if not restaurant_guid:
            raise HTTPException(status_code=404, detail="Restaurant not found for user")
        cursor.execute(
            """
            SELECT DISTINCT JOBTITLE AS jobTitle
            FROM GRATLYDB.SRC_JOBS
            WHERE RESTAURANTGUID = %s
              AND JOBTITLE IS NOT NULL
              AND JOBTITLE <> ''
            ORDER BY JOBTITLE
            """,
            (restaurant_guid,),
        )
        rows = cursor.fetchall()
        return [row["jobTitle"] for row in rows if row.get("jobTitle")]
    except pymysql.MySQLError as err:
        raise HTTPException(status_code=500, detail=f"Error fetching job titles: {err}")
    finally:
        cursor.close()

@app.get("/total-gratuity")
def get_total_gratuity(user_id: Optional[int] = None):
    cursor = _get_cursor(dictionary=True)
    try:
        employee_guid = None
        if user_id is not None:
            permissions = _fetch_user_permission_flags(user_id)
            if not permissions:
                raise HTTPException(status_code=404, detail="User permissions not found")
            is_admin = bool(permissions.get("isAdmin"))
            is_employee = bool(permissions.get("isEmployee"))
            if not is_admin:
                if not is_employee:
                    raise HTTPException(status_code=403, detail="User is not authorized to view totals")
                employee_guid = _fetch_employee_guid_for_user(user_id)
                if not employee_guid:
                    raise HTTPException(status_code=404, detail="Employee not found for user")

        timeentry_filter = ""
        timeentry_params: tuple = ()
        if employee_guid:
            timeentry_filter = "WHERE EMPLOYEEGUID = %s"
            timeentry_params = (employee_guid,)

        cursor.execute(
            f"""
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
            {timeentry_filter}
            """,
            timeentry_params,
        )
        row = cursor.fetchone() or {}
        total_gratuity = row.get("total_gratuity") or 0
        gratuity_change = row.get("gratuity_change") or 0
        total_tips = row.get("total_tips") or 0
        tips_change = row.get("tips_change") or 0

        order_filter = ""
        order_params: tuple = ()
        if employee_guid:
            order_filter = "WHERE EMPLOYEEGUID = %s"
            order_params = (employee_guid,)

        cursor.execute(
            f"""
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
            {order_filter}
            """,
            order_params,
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

@app.get("/user-profile/{user_id}", response_model=UserProfileResponse)
def get_user_profile(user_id: int):
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT
                FIRSTNAME AS firstName,
                LASTNAME AS lastName,
                EMAIL AS email,
                PHONENUMBER AS phoneNumber
            FROM USER_MASTER
            WHERE USERID = %s
            LIMIT 1
            """,
            (user_id,),
        )
        profile = cursor.fetchone()
        if not profile:
            raise HTTPException(status_code=404, detail="User profile not found")
        profile["restaurantName"] = _fetch_restaurant_name(user_id)
        return profile
    except pymysql.MySQLError as err:
        raise HTTPException(status_code=500, detail=f"Error fetching user profile: {err}")
    finally:
        cursor.close()

@app.put("/user-profile/{user_id}", response_model=UserProfileResponse)
def update_user_profile(user_id: int, payload: UserProfileUpdatePayload):
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            "SELECT USERID AS userId FROM USER_MASTER WHERE USERID = %s LIMIT 1",
            (user_id,),
        )
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="User profile not found")

        email = payload.email.strip() if payload.email is not None else None
        if email is not None and not email:
            raise HTTPException(status_code=400, detail="Email is required")

        if email:
            cursor.execute(
                """
                SELECT USERID AS userId
                FROM USER_MASTER
                WHERE EMAIL = %s AND USERID <> %s
                LIMIT 1
                """,
                (email, user_id),
            )
            if cursor.fetchone():
                raise HTTPException(status_code=400, detail="Email already exists")

        def _normalize(value: Optional[str]) -> Optional[str]:
            if value is None:
                return None
            return value.strip()

        cursor.execute(
            """
            UPDATE USER_MASTER
            SET
                FIRSTNAME = COALESCE(%s, FIRSTNAME),
                LASTNAME = COALESCE(%s, LASTNAME),
                EMAIL = COALESCE(%s, EMAIL),
                PHONENUMBER = COALESCE(%s, PHONENUMBER)
            WHERE USERID = %s
            """,
            (
                _normalize(payload.firstName),
                _normalize(payload.lastName),
                email,
                _normalize(payload.phoneNumber),
                user_id,
            ),
        )

        cursor.execute(
            """
            SELECT
                FIRSTNAME AS firstName,
                LASTNAME AS lastName,
                EMAIL AS email,
                PHONENUMBER AS phoneNumber
            FROM USER_MASTER
            WHERE USERID = %s
            LIMIT 1
            """,
            (user_id,),
        )
        profile = cursor.fetchone()
        if not profile:
            raise HTTPException(status_code=404, detail="User profile not found")
        profile["restaurantName"] = _fetch_restaurant_name(user_id)
        return profile
    except pymysql.MySQLError as err:
        raise HTTPException(status_code=500, detail=f"Error updating user profile: {err}")
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
