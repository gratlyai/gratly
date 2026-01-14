from datetime import datetime, timedelta, timezone
import hashlib
import os
import secrets
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
import pymysql
from pydantic import BaseModel
from typing import List, Optional, Tuple

# Load environment variables from .env file
try:
    from dotenv import load_dotenv
    import sys
    # Find the Backend directory
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    env_path = os.path.join(backend_dir, '.env')
    if os.path.exists(env_path):
        load_dotenv(env_path)
        print(f"Loaded .env from {env_path}")
        print(f"MOOV_API_KEY is set: {bool(os.getenv('MOOV_API_KEY'))}")
    else:
        print(f"Warning: .env file not found at {env_path}")
except ImportError:
    pass

if __package__:
    from .security import hash_password, verify_password
    from .email_utils import send_sendgrid_email
    from .db import (
        _get_cursor,
        _fetch_restaurant_key,
        _fetch_restaurant_name,
        _fetch_restaurant_guid,
        _fetch_user_permission_flags,
        _fetch_user_permission_names,
        _fetch_employee_guid_for_user,
        _serialize_permissions,
        _fetch_restaurant_id_for_email,
        _fetch_restaurant_timezone,
        set_request_timezone,
        reset_request_timezone,
        _get_env_or_ini,
        PERMISSION_LABELS,
        PERMISSION_NAME_TO_KEY,
    )
    from .payout_schedules import router as payout_schedules_router
    from .password_reset import router as password_reset_router
    from .approvals import router as approvals_router
    from .reports import router as reports_router
    from .moov_payments import router as moov_payments_router
    from .payment_routing import router as payment_routing_router
    from .billing import router as billing_router
    from .moov_local import router as moov_local_router
    from .scheduler import init_scheduler, shutdown_scheduler
else:
    from security import hash_password, verify_password
    from email_utils import send_sendgrid_email
    from db import (
        _get_cursor,
        _fetch_restaurant_key,
        _fetch_restaurant_name,
        _fetch_restaurant_guid,
        _fetch_user_permission_flags,
        _fetch_user_permission_names,
        _fetch_employee_guid_for_user,
        _serialize_permissions,
        _fetch_restaurant_id_for_email,
        _fetch_restaurant_timezone,
        set_request_timezone,
        reset_request_timezone,
        _get_env_or_ini,
        PERMISSION_LABELS,
        PERMISSION_NAME_TO_KEY,
    )
    from payout_schedules import router as payout_schedules_router
    from password_reset import router as password_reset_router
    from approvals import router as approvals_router
    from reports import router as reports_router
    from moov_payments import router as moov_payments_router
    from payment_routing import router as payment_routing_router
    from billing import router as billing_router
    from moov_local import router as moov_local_router
    from scheduler import init_scheduler, shutdown_scheduler

app = FastAPI()

def _should_run_migrations() -> bool:
    raw = (_get_env_or_ini("RUN_DB_MIGRATIONS") or "").strip().lower()
    return raw in ("1", "true", "yes", "y")

def _get_migration_connection():
    config = {
        "host": _get_env_or_ini("DB_HOST"),
        "user": _get_env_or_ini("DB_USER"),
        "password": _get_env_or_ini("DB_PASSWORD"),
        "autocommit": True,
    }
    db_name = _get_env_or_ini("DB_NAME")
    if db_name:
        config["database"] = db_name
    return pymysql.connect(**config)

def _run_sql_script(cursor, script_path: str) -> None:
    with open(script_path, "r", encoding="utf-8") as handle:
        lines = []
        for line in handle:
            if line.lstrip().startswith("--"):
                continue
            lines.append(line)
    cleaned = "".join(lines)
    for statement in cleaned.split(";"):
        stmt = statement.strip()
        if stmt:
            try:
                cursor.execute(stmt)
            except pymysql.err.OperationalError as err:
                # Ignore already-exists or missing-object errors for idempotent migrations.
                if err.args and err.args[0] in (1050, 1060, 1061, 1091):
                    continue
                raise

def _build_migration_key(script_path: str) -> str:
    with open(script_path, "rb") as handle:
        digest = hashlib.sha256(handle.read()).hexdigest()
    return f"scripts_sql_{digest[:12]}"

def _apply_scripts_sql_once() -> None:
    script_path = os.path.join(os.path.dirname(__file__), "..", "DB", "scripts.sql")
    if not os.path.exists(script_path):
        raise RuntimeError(f"Migration script not found at {script_path}")
    migration_key = _build_migration_key(script_path)

    conn = _get_migration_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT GET_LOCK('gratly_migrations', 30)")
        cursor.execute("CREATE DATABASE IF NOT EXISTS GRATLYDB")
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS GRATLYDB.MIGRATIONS (
                ID INT AUTO_INCREMENT PRIMARY KEY,
                MIGRATION_KEY VARCHAR(128) NOT NULL UNIQUE,
                APPLIED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        cursor.execute(
            """
            SELECT 1
            FROM GRATLYDB.MIGRATIONS
            WHERE MIGRATION_KEY = %s
            LIMIT 1
            """,
            (migration_key,),
        )
        if cursor.fetchone():
            print(f"Migration {migration_key} already applied; skipping.")
            return
        print(f"Applying migration {migration_key} from scripts.sql.")
        _run_sql_script(cursor, script_path)
        cursor.execute(
            "INSERT INTO GRATLYDB.MIGRATIONS (MIGRATION_KEY) VALUES (%s)",
            (migration_key,),
        )
        print(f"Migration {migration_key} applied successfully.")
    finally:
        try:
            cursor.execute("SELECT RELEASE_LOCK('gratly_migrations')")
        except pymysql.MySQLError:
            pass
        cursor.close()
        conn.close()

def _get_cors_origins() -> List[str]:
    raw = _get_env_or_ini("CORS_ORIGINS")
    if raw:
        return [origin.strip() for origin in raw.split(",") if origin.strip()]
    return [
        "https://dev.gratly.ai",
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
    ]

# ✅ Allow React to talk to backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=_get_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def apply_request_timezone(request: Request, call_next):
    if request.url.path == "/api/webhooks/moov":
        return await call_next(request)
    timezone_value = None
    restaurant_id = request.query_params.get("restaurant_id") or request.query_params.get("restaurantId")
    restaurant_guid = request.query_params.get("restaurant_guid") or request.query_params.get("restaurantGuid")
    user_id = request.query_params.get("user_id") or request.query_params.get("userId")

    body_data = None
    if request.headers.get("content-type", "").startswith("application/json"):
        try:
            body_data = await request.json()
        except Exception:
            body_data = None

    if body_data and isinstance(body_data, dict):
        restaurant_id = restaurant_id or body_data.get("restaurant_id") or body_data.get("restaurantId")
        restaurant_guid = restaurant_guid or body_data.get("restaurant_guid") or body_data.get("restaurantGuid")
        user_id = user_id or body_data.get("user_id") or body_data.get("userId")

    restaurant_id_value = None
    if restaurant_id is not None:
        try:
            restaurant_id_value = int(restaurant_id)
        except (TypeError, ValueError):
            restaurant_id_value = None

    if restaurant_guid:
        timezone_value = _fetch_restaurant_timezone(restaurant_guid=restaurant_guid)
    elif restaurant_id_value is not None:
        timezone_value = _fetch_restaurant_timezone(restaurant_id=restaurant_id_value)
    elif user_id is not None:
        try:
            user_id_value = int(user_id)
        except (TypeError, ValueError):
            user_id_value = None
        if user_id_value is not None:
            restaurant_id_value = _fetch_restaurant_key(user_id_value)
            if restaurant_id_value is not None:
                timezone_value = _fetch_restaurant_timezone(restaurant_id=restaurant_id_value)

    token = None
    if timezone_value:
        token = set_request_timezone(timezone_value)
    try:
        response = await call_next(request)
    finally:
        if token is not None:
            reset_request_timezone(token)
    return response

@app.on_event("startup")
def _run_startup_migrations() -> None:
    if _should_run_migrations():
        _apply_scripts_sql_once()
    try:
        print("[SCHEDULER] Initializing job scheduler...")
        init_scheduler()
        print("[SCHEDULER] Job scheduler initialized successfully")
    except Exception as e:
        print(f"[SCHEDULER ERROR] Failed to initialize scheduler: {e}")
        import traceback
        traceback.print_exc()

@app.on_event("shutdown")
def _run_shutdown() -> None:
    shutdown_scheduler()

@app.get("/healthz")
def healthcheck():
    return {"status": "ok"}

@app.post("/api/admin/jobs/trigger/{job_name}")
def trigger_job_manually(job_name: str, user_id: int):
    """Manually trigger a scheduled job (admin only)."""
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT COUNT(*) AS count
            FROM GRATLYDB.USER_PERMISSIONS up
            JOIN GRATLYDB.MSTR_PERMISSIONS mp ON up.PERMISSIONSID = mp.PERMISSIONSID
            WHERE up.USERID = %s
              AND LOWER(mp.PERMISSIONSNAME) IN ('superadmin access', 'admin access')
              AND (mp.DELETED IS NULL OR mp.DELETED = 0)
            """,
            (user_id,),
        )
        if cursor.fetchone()["count"] == 0:
            raise HTTPException(status_code=403, detail="Admin access required")
    finally:
        cursor.close()

    from moov_jobs import (
        monthly_invoice_job,
        monthly_invoice_collect_retry_job,
        nightly_restaurant_debit_job,
        payout_disbursement_job,
    )

    jobs = {
        "monthly_invoice": monthly_invoice_job,
        "collect_retry": monthly_invoice_collect_retry_job,
        "nightly_debit": nightly_restaurant_debit_job,
        "payout_disbursement": payout_disbursement_job,
    }

    if job_name not in jobs:
        raise HTTPException(status_code=404, detail=f"Job '{job_name}' not found")

    try:
        jobs[job_name]()
        return {"success": True, "job": job_name, "triggered_at": datetime.now(timezone.utc).isoformat()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Job execution failed: {str(e)}")


@app.get("/api/admin/jobs/status")
def get_job_status(user_id: int):
    """Get status of all scheduled jobs (admin only)."""
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT COUNT(*) AS count
            FROM GRATLYDB.USER_PERMISSIONS up
            JOIN GRATLYDB.MSTR_PERMISSIONS mp ON up.PERMISSIONSID = mp.PERMISSIONSID
            WHERE up.USERID = %s
              AND LOWER(mp.PERMISSIONSNAME) IN ('superadmin access', 'admin access')
              AND (mp.DELETED IS NULL OR mp.DELETED = 0)
            """,
            (user_id,),
        )
        if cursor.fetchone()["count"] == 0:
            raise HTTPException(status_code=403, detail="Admin access required")
    finally:
        cursor.close()

    from scheduler import scheduler

    jobs = []
    for job in scheduler.get_jobs():
        jobs.append({
            "id": job.id,
            "name": job.name,
            "next_run": job.next_run_time.isoformat() if job.next_run_time else None,
        })
    return {"jobs": jobs}

app.include_router(payout_schedules_router)
app.include_router(password_reset_router)
app.include_router(approvals_router)
app.include_router(reports_router)
app.include_router(moov_payments_router)
app.include_router(payment_routing_router)
app.include_router(billing_router)
app.include_router(moov_local_router)

print("DB HOST:", _get_env_or_ini("DB_HOST"))
print("DB USER:", _get_env_or_ini("DB_USER"))
print("DB NAME:", _get_env_or_ini("DB_NAME"))


INVITE_PRIMARY_COLOR = "#cab99a"
INVITE_BACKGROUND_COLOR = "#f4f2ee"
INVITE_BORDER_COLOR = "#e4dccf"
INVITE_TEXT_COLOR = "#1f2937"
INVITE_SIGNUP_LINK_BASE = _get_env_or_ini("INVITE_SIGNUP_LINK_BASE") or "http://localhost:5173/signup"
INVITE_TOKEN_TTL_HOURS = 24
GRATLY_LOGO_BASE64 = (
    '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'
    'gg=='
)

def _hash_invite_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()

def _ensure_team_invite_token_table(cursor) -> None:
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS GRATLYDB.TEAM_INVITE_TOKENS (
            INVITE_TOKEN_ID INT AUTO_INCREMENT PRIMARY KEY,
            INVITEID INT NOT NULL,
            RESTAURANTID INT NOT NULL,
            TOKEN_HASH VARCHAR(64) NOT NULL,
            EXPIRES_AT TIMESTAMP NOT NULL,
            USED_AT TIMESTAMP NULL,
            CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX (TOKEN_HASH),
            INDEX (INVITEID),
            INDEX (RESTAURANTID)
        )
        """
    )

def _build_invite_signup_link(token: str) -> str:
    separator = "&" if "?" in INVITE_SIGNUP_LINK_BASE else "?"
    return f"{INVITE_SIGNUP_LINK_BASE}{separator}token={token}"

def _create_team_invite_token(cursor, invite_id: int, restaurant_id: int) -> str:
    _ensure_team_invite_token_table(cursor)
    token = secrets.token_urlsafe(32)
    token_hash = _hash_invite_token(token)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=INVITE_TOKEN_TTL_HOURS)
    cursor.execute(
        """
        INSERT INTO GRATLYDB.TEAM_INVITE_TOKENS (INVITEID, RESTAURANTID, TOKEN_HASH, EXPIRES_AT)
        VALUES (%s, %s, %s, %s)
        """,
        (invite_id, restaurant_id, token_hash, expires_at),
    )
    return token

def _create_team_invite_token_with_value(cursor, invite_id: int, restaurant_id: int, token: str) -> str:
    _ensure_team_invite_token_table(cursor)
    token_hash = _hash_invite_token(token)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=INVITE_TOKEN_TTL_HOURS)
    cursor.execute(
        """
        INSERT INTO GRATLYDB.TEAM_INVITE_TOKENS (INVITEID, RESTAURANTID, TOKEN_HASH, EXPIRES_AT)
        VALUES (%s, %s, %s, %s)
        """,
        (invite_id, restaurant_id, token_hash, expires_at),
    )
    return token

def _get_valid_team_invite(cursor, token: str, email: str) -> dict:
    _ensure_team_invite_token_table(cursor)
    token_hash = _hash_invite_token(token)
    cursor.execute(
        """
        SELECT
            tit.INVITE_TOKEN_ID AS inviteTokenId,
            tit.INVITEID AS inviteId,
            tit.RESTAURANTID AS restaurantId,
            tit.EXPIRES_AT AS expiresAt,
            tit.USED_AT AS usedAt,
            ei.EMAIL AS inviteEmail
        FROM GRATLYDB.TEAM_INVITE_TOKENS tit
        JOIN GRATLYDB.EMAIL_INVITES ei ON ei.INVITEID = tit.INVITEID
        WHERE tit.TOKEN_HASH = %s
        LIMIT 1
        """,
        (token_hash,),
    )
    row = cursor.fetchone()
    if not row:
        raise HTTPException(status_code=400, detail="Invalid invite token")
    if row.get("usedAt") is not None:
        raise HTTPException(status_code=400, detail="Invite token already used")
    expires_at = row.get("expiresAt")
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if not expires_at or expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Invite token expired")
    invite_email = (row.get("inviteEmail") or "").strip().lower()
    if invite_email and invite_email != email.strip().lower():
        raise HTTPException(status_code=400, detail="Invite token does not match email")
    return row

def _build_invite_email_content(
    restaurant_name: str, recipient_name: str, signup_link: str
) -> Tuple[str, str]:
    greeting = f"Hi {recipient_name}," if recipient_name else "Hi,"
    text_content = (
        f"{greeting}\n\n"
        f"You've been invited to Gratly by {restaurant_name}.\n"
        "To get started, create your account using this link:\n"
        f"{signup_link}\n\n"
        "If you weren't expecting this invite, you can ignore this email."
    )
    logo_data_uri = f"data:image/png;base64,{GRATLY_LOGO_BASE64}"
    html_content = f"""\
<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:{INVITE_BACKGROUND_COLOR};font-family:'Helvetica Neue', Arial, sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:{INVITE_BACKGROUND_COLOR};padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;background-color:#ffffff;border:1px solid {INVITE_BORDER_COLOR};border-radius:16px;overflow:hidden;">
            <tr>
              <td style="background-color:{INVITE_PRIMARY_COLOR};padding:24px 32px;text-align:center;">
                <img src="{logo_data_uri}" alt="Gratly" style="display:block;margin:0 auto;height:48px;width:auto;" />
              </td>
            </tr>
            <tr>
              <td style="padding:32px;color:{INVITE_TEXT_COLOR};font-size:16px;line-height:24px;">
                <p style="margin:0 0 16px 0;">{greeting}</p>
                <p style="margin:0 0 16px 0;">You've been invited to <strong>Gratly</strong> by <strong>{restaurant_name}</strong>.</p>
                <p style="margin:0 0 16px 0;">To get started, create your account:</p>
                <p style="margin:0 0 20px 0;">
                  <a href="{signup_link}" style="display:inline-block;padding:12px 20px;background-color:{INVITE_PRIMARY_COLOR};color:{INVITE_TEXT_COLOR};text-decoration:none;border-radius:999px;font-weight:600;">
                    Complete signup
                  </a>
                </p>
                <p style="margin:0 0 16px 0;font-size:12px;color:#6b7280;word-break:break-all;">
                  Or paste this link into your browser:<br />
                  {signup_link}
                </p>
                <p style="margin:0;">If you weren't expecting this invite, you can ignore this email.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background-color:{INVITE_BACKGROUND_COLOR};color:#6b7280;font-size:12px;line-height:18px;text-align:center;">
                Gratly | Team access
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
"""
    return text_content, html_content


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
    superadminAccess: bool
    managerAccess: bool
    employeeOnly: bool

class PermissionDescriptor(BaseModel):
    key: str
    label: str

class OnboardRestaurantPayload(BaseModel):
    userId: int
    restaurantGuid: str
    payoutFeePayer: Optional[str] = None
    payoutFee: Optional[str] = None
    activationDate: Optional[str] = None
    freePeriod: Optional[str] = None
    billingDate: Optional[str] = None
    billingAmount: Optional[str] = None
    adminName: Optional[str] = None
    adminPhone: Optional[str] = None
    adminEmail: Optional[str] = None
    restaurantName: Optional[str] = None

class OnboardRestaurantResponse(BaseModel):
    success: bool
    restaurantId: int

class TeamInvitePayload(BaseModel):
    user_id: int
    email: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    employee_guid: Optional[str] = None


class OnboardingDetailsResponse(BaseModel):
    restaurantGuid: str
    payoutFeePayer: Optional[str] = None
    payoutFee: Optional[str] = None
    activationDate: Optional[str] = None
    freePeriod: Optional[str] = None
    billingDate: Optional[str] = None
    billingAmount: Optional[str] = None
    adminName: Optional[str] = None
    adminPhone: Optional[str] = None
    adminEmail: Optional[str] = None

class ContactPayload(BaseModel):
    name: str
    email: str
    phone: Optional[str] = None
    message: str

class RestaurantSelectionOption(BaseModel):
    restaurantId: Optional[int] = None
    restaurantGuid: Optional[str] = None
    restaurantName: Optional[str] = None

class RestaurantSelectionPayload(BaseModel):
    userId: int
    restaurantId: Optional[int] = None
    restaurantGuid: Optional[str] = None

class EmployeeJobResponse(BaseModel):
    employeeGuid: Optional[str] = None
    firstName: Optional[str] = None
    lastName: Optional[str] = None
    jobTitle: Optional[str] = None

def _require_superadmin_access(user_id: int) -> None:
    permission_names = _fetch_user_permission_names(user_id)
    permissions = _serialize_permissions(permission_names) or {}
    if not permissions.get("superadminAccess"):
        raise HTTPException(status_code=403, detail="Superadmin access required")

def _send_sendgrid_email(
    to_email: str,
    subject: str,
    content: str,
    sender_name: Optional[str] = None,
    html_content: Optional[str] = None,
    reply_to: Optional[str] = None,
):
    send_sendgrid_email(
        to_email=to_email,
        subject=subject,
        content=content,
        sender_name=sender_name,
        html_content=html_content,
        reply_to=reply_to,
    )

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
def get_employees(user_id: Optional[int] = None, restaurant_id: Optional[int] = None):
    cursor = _get_cursor(dictionary=True)
    try:
        restaurant_guid = None
        if restaurant_id is not None:
            cursor.execute(
                """
                SELECT RESTAURANTGUID AS restaurant_guid
                FROM GRATLYDB.SRC_ONBOARDING
                WHERE RESTAURANTID = %s
                LIMIT 1
                """,
                (restaurant_id,),
            )
            row = cursor.fetchone()
            restaurant_guid = row.get("restaurant_guid") if row else None
            if not restaurant_guid:
                return []
        elif user_id is not None:
            restaurant_guid = _fetch_restaurant_guid(user_id)
            if not restaurant_guid:
                return []

        query = """
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
        """
        params: List[object] = []
        if restaurant_guid:
            query += " WHERE SRC_EMPLOYEES.RESTAURANTGUID = %s"
            params.append(restaurant_guid)
        query += " ORDER BY SRC_EMPLOYEES.employeefname"
        cursor.execute(query, params)
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
    restaurant_id = _fetch_restaurant_key(payload.user_id)
    if not restaurant_id:
        raise HTTPException(status_code=404, detail="Restaurant not found for user")
    restaurant_name = _fetch_restaurant_name(payload.user_id) or "Gratly"
    recipient_name = " ".join(
        part for part in [payload.first_name or "", payload.last_name or ""] if part.strip()
    ).strip()
    cursor = _get_cursor(dictionary=False)
    conn = cursor.connection
    invite_id = None
    try:
        invite_id = _insert_invite_log(cursor, payload, "pending")
        invite_token = _create_team_invite_token(cursor, invite_id, restaurant_id)
        signup_link = _build_invite_signup_link(invite_token)
        text_content, html_content = _build_invite_email_content(
            restaurant_name, recipient_name, signup_link
        )
        conn.commit()
        _send_sendgrid_email(
            to_email=email,
            subject=f"You're invited to Gratly by {restaurant_name}",
            content=text_content,
            html_content=html_content,
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


@app.post("/contact")
def submit_contact(payload: ContactPayload):
    name = payload.name.strip() if payload.name else ""
    email = payload.email.strip() if payload.email else ""
    message = payload.message.strip() if payload.message else ""
    phone = payload.phone.strip() if payload.phone else ""

    if not name or not email or not message:
        raise HTTPException(status_code=400, detail="Name, email, and message are required")

    subject = f"Gratly contact request from {name}"
    content_lines = [
        f"Name: {name}",
        f"Email: {email}",
        f"Phone: {phone}" if phone else "Phone: (not provided)",
        "",
        "Message:",
        message,
    ]
    _send_sendgrid_email(
        to_email="sandeep@gratly.ai",
        subject=subject,
        content="\n".join(content_lines),
        sender_name="Gratly Contact",
        reply_to=email,
    )
    _send_sendgrid_email(
        to_email=email,
        subject="We received your message",
        content=(
            "Thanks for reaching out to Gratly.\n\n"
            "We received your message and will get back to you shortly.\n\n"
            "Summary:\n"
            f"Name: {name}\n"
            f"Email: {email}\n"
            f"Phone: {phone if phone else '(not provided)'}\n\n"
            "Message:\n"
            f"{message}\n"
        ),
        sender_name="Gratly",
    )
    return {"success": True}

@app.post("/superadmin/onboard-restaurant", response_model=OnboardRestaurantResponse)
def onboard_restaurant(payload: OnboardRestaurantPayload):
    _require_superadmin_access(payload.userId)
    if not payload.restaurantGuid:
        raise HTTPException(status_code=400, detail="restaurantGuid is required")
    if payload.payoutFeePayer and payload.payoutFeePayer not in ("restaurant", "employees"):
        raise HTTPException(status_code=400, detail="payoutFeePayer must be restaurant or employees")

    cursor = _get_cursor(dictionary=True)
    conn = cursor.connection
    try:
        cursor.execute(
            """
            SELECT RESTAURANTID AS restaurant_id
            FROM GRATLYDB.SRC_ONBOARDING
            WHERE RESTAURANTGUID = %s
            LIMIT 1
            """,
            (payload.restaurantGuid,),
        )
        existing = cursor.fetchone()

        def _clean_value(value: Optional[str]) -> Optional[str]:
            if value is None:
                return None
            cleaned = value.strip()
            return cleaned if cleaned else None

        if existing:
            restaurant_id = existing["restaurant_id"]
            cursor.execute(
                """
                UPDATE GRATLYDB.SRC_ONBOARDING
                SET
                    PAYOUT_FEE_PAYER = COALESCE(%s, PAYOUT_FEE_PAYER),
                    PAYOUT_FEE = COALESCE(%s, PAYOUT_FEE),
                    ACTIVATION_DATE = COALESCE(%s, ACTIVATION_DATE),
                    FREE_PERIOD = COALESCE(%s, FREE_PERIOD),
                    BILLING_DATE = COALESCE(%s, BILLING_DATE),
                    BILLING_AMOUNT = COALESCE(%s, BILLING_AMOUNT),
                    ADMIN_NAME = COALESCE(%s, ADMIN_NAME),
                    ADMIN_PHONE = COALESCE(%s, ADMIN_PHONE),
                    ADMIN_EMAIL = COALESCE(%s, ADMIN_EMAIL)
                WHERE RESTAURANTGUID = %s
                """,
                (
                    _clean_value(payload.payoutFeePayer),
                    _clean_value(payload.payoutFee),
                    _clean_value(payload.activationDate),
                    _clean_value(payload.freePeriod),
                    _clean_value(payload.billingDate),
                    _clean_value(payload.billingAmount),
                    _clean_value(payload.adminName),
                    _clean_value(payload.adminPhone),
                    _clean_value(payload.adminEmail),
                    payload.restaurantGuid,
                ),
            )
        else:
            cursor.execute(
                """
                INSERT INTO GRATLYDB.SRC_ONBOARDING (
                    RESTAURANTGUID,
                    PAYOUT_FEE_PAYER,
                    PAYOUT_FEE,
                    ACTIVATION_DATE,
                    FREE_PERIOD,
                    BILLING_DATE,
                    BILLING_AMOUNT,
                    ADMIN_NAME,
                    ADMIN_PHONE,
                    ADMIN_EMAIL
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    payload.restaurantGuid,
                    _clean_value(payload.payoutFeePayer),
                    _clean_value(payload.payoutFee),
                    _clean_value(payload.activationDate),
                    _clean_value(payload.freePeriod),
                    _clean_value(payload.billingDate),
                    _clean_value(payload.billingAmount),
                    _clean_value(payload.adminName),
                    _clean_value(payload.adminPhone),
                    _clean_value(payload.adminEmail),
                ),
            )
            restaurant_id = cursor.lastrowid

        if payload.restaurantName:
            cursor.execute(
                """
                UPDATE GRATLYDB.SRC_RESTAURANTDETAILS
                SET RESTAURANTNAME = %s
                WHERE RESTAURANTGUID = %s
                """,
                (payload.restaurantName, payload.restaurantGuid),
            )

        conn.commit()
        return {"success": True, "restaurantId": restaurant_id}
    except pymysql.MySQLError as err:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Error updating restaurant: {err}")
    finally:
        cursor.close()

@app.get("/superadmin/onboarding-details", response_model=Optional[OnboardingDetailsResponse])
def get_onboarding_details(user_id: int, restaurant_guid: str):
    _require_superadmin_access(user_id)
    if not restaurant_guid:
        raise HTTPException(status_code=400, detail="restaurant_guid is required")
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT
                RESTAURANTGUID AS restaurant_guid,
                PAYOUT_FEE_PAYER AS payout_fee_payer,
                PAYOUT_FEE AS payout_fee,
                ACTIVATION_DATE AS activation_date,
                FREE_PERIOD AS free_period,
                BILLING_DATE AS billing_date,
                BILLING_AMOUNT AS billing_amount,
                ADMIN_NAME AS admin_name,
                ADMIN_PHONE AS admin_phone,
                ADMIN_EMAIL AS admin_email
            FROM GRATLYDB.SRC_ONBOARDING
            WHERE RESTAURANTGUID = %s
            LIMIT 1
            """,
            (restaurant_guid,),
        )
        row = cursor.fetchone()
        if not row:
            return None
        return {
            "restaurantGuid": row.get("restaurant_guid"),
            "payoutFeePayer": row.get("payout_fee_payer"),
            "payoutFee": row.get("payout_fee"),
            "activationDate": str(row.get("activation_date")) if row.get("activation_date") else None,
            "freePeriod": row.get("free_period"),
            "billingDate": str(row.get("billing_date")) if row.get("billing_date") else None,
            "billingAmount": row.get("billing_amount"),
            "adminName": row.get("admin_name"),
            "adminPhone": row.get("admin_phone"),
            "adminEmail": row.get("admin_email"),
        }
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
        restaurant_guid = None
        if user_id is not None:
            permissions = _fetch_user_permission_flags(user_id)
            if not permissions:
                raise HTTPException(status_code=404, detail="User permissions not found")
            is_admin = bool(permissions.get("isAdmin"))
            is_employee = bool(permissions.get("isEmployee"))
            restaurant_guid = _fetch_restaurant_guid(user_id)
            if not restaurant_guid:
                raise HTTPException(status_code=404, detail="Restaurant not found")
            if not is_admin:
                if not is_employee:
                    raise HTTPException(status_code=403, detail="User is not authorized to view totals")
                employee_guid = _fetch_employee_guid_for_user(user_id)
                if not employee_guid:
                    raise HTTPException(status_code=404, detail="Employee not found for user")

        order_conditions = ["(VOIDED IS NULL OR VOIDED <> '1')"]
        order_params: List[object] = []
        if restaurant_guid:
            order_conditions.append("RESTAURANTGUID = %s")
            order_params.append(restaurant_guid)
        if employee_guid:
            order_conditions.append("EMPLOYEEGUID = %s")
            order_params.append(employee_guid)
        order_filter = "WHERE " + " AND ".join(order_conditions)

        cursor.execute(
            f"""
            SELECT
                COALESCE(SUM(CASE
                    WHEN BUSINESSDATE = DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 DAY), '%%Y%%m%%d')
                    THEN COALESCE(TOTALAMOUNT, 0) - (COALESCE(TAXAMOUNT, 0) + COALESCE(TIPAMOUNT, 0) + COALESCE(GRATUITYAMOUNT, 0))
                    ELSE 0
                END), 0) AS net_sales,
                COALESCE(SUM(CASE
                    WHEN BUSINESSDATE = DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 8 DAY), '%%Y%%m%%d')
                    THEN COALESCE(TOTALAMOUNT, 0) - (COALESCE(TAXAMOUNT, 0) + COALESCE(TIPAMOUNT, 0) + COALESCE(GRATUITYAMOUNT, 0))
                    ELSE 0
                END), 0) AS net_sales_change
                ,
                COALESCE(SUM(CASE
                    WHEN BUSINESSDATE = DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 DAY), '%%Y%%m%%d')
                    THEN COALESCE(TIPAMOUNT, 0)
                    ELSE 0
                END), 0) AS total_tips
                ,
                COALESCE(SUM(CASE
                    WHEN BUSINESSDATE = DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 8 DAY), '%%Y%%m%%d')
                    THEN COALESCE(TIPAMOUNT, 0)
                    ELSE 0
                END), 0) AS tips_change
                ,
                COALESCE(SUM(CASE
                    WHEN BUSINESSDATE = DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 DAY), '%%Y%%m%%d')
                    THEN COALESCE(GRATUITYAMOUNT, 0)
                    ELSE 0
                END), 0) AS total_gratuity
                ,
                COALESCE(SUM(CASE
                    WHEN BUSINESSDATE = DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 8 DAY), '%%Y%%m%%d')
                    THEN COALESCE(GRATUITYAMOUNT, 0)
                    ELSE 0
                END), 0) AS gratuity_change
            FROM GRATLYDB.SRC_ALLORDERS
            {order_filter}
            """,
            order_params,
        )
        net_sales_row = cursor.fetchone() or {}
        net_sales = net_sales_row.get("net_sales") or 0
        net_sales_change = net_sales_row.get("net_sales_change") or 0
        total_tips = net_sales_row.get("total_tips") or 0
        tips_change = net_sales_row.get("tips_change") or 0
        total_gratuity = net_sales_row.get("total_gratuity") or 0
        gratuity_change = net_sales_row.get("gratuity_change") or 0
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
            "SELECT 1 FROM GRATLYDB.USER_MASTER WHERE USERID = %s LIMIT 1",
            (user_id,),
        )
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="User permissions not found")
        cursor.execute(
            """
            SELECT
                mp.PERMISSIONSNAME AS permission_name
            FROM GRATLYDB.USER_PERMISSIONS up
            JOIN GRATLYDB.MSTR_PERMISSIONS mp ON up.PERMISSIONSID = mp.PERMISSIONSID
            WHERE up.USERID = %s
              AND (mp.DELETED IS NULL OR mp.DELETED = 0)
            """,
            (user_id,),
        )
        rows = cursor.fetchall()
        permission_names = [row["permission_name"] for row in rows if row.get("permission_name")]
        permissions = _serialize_permissions(permission_names)
        if permissions is None:
            raise HTTPException(status_code=404, detail="User permissions not found")
        return permissions
    except pymysql.MySQLError as err:
        raise HTTPException(status_code=500, detail=f"Error fetching user permissions: {err}")
    finally:
        cursor.close()

@app.get("/permissions/catalog", response_model=List[PermissionDescriptor])
def get_permission_catalog():
    cursor = _get_cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT PERMISSIONSNAME AS permission_name, DISPLAY AS display
            FROM GRATLYDB.MSTR_PERMISSIONS
            WHERE DELETED IS NULL OR DELETED = 0
            ORDER BY PERMISSIONSNAME
            """
        )
        rows = cursor.fetchall()
        results: List[PermissionDescriptor] = []
        for row in rows:
            name = row.get("permission_name")
            if not name:
                continue
            if not int(row.get("display") or 0):
                continue
            key = PERMISSION_NAME_TO_KEY.get(name.strip().lower())
            if not key:
                continue
            results.append({"key": key, "label": name})
        return results
    except pymysql.MySQLError as err:
        raise HTTPException(status_code=500, detail=f"Error fetching permissions catalog: {err}")
    finally:
        cursor.close()

@app.put("/user-permissions/{user_id}", response_model=UserPermissionsPayload)
def update_user_permissions(user_id: int, payload: UserPermissionsPayload, actor_user_id: Optional[int] = None):
    cursor = _get_cursor(dictionary=True)
    try:
        if actor_user_id is None:
            raise HTTPException(status_code=400, detail="Missing actor_user_id")
        actor_permission_names = _fetch_user_permission_names(actor_user_id)
        actor_permissions = _serialize_permissions(actor_permission_names) or {}
        target_permission_names = _fetch_user_permission_names(user_id)
        target_permissions = _serialize_permissions(target_permission_names) or {}
        if (
            not actor_permissions.get("adminAccess")
            and not actor_permissions.get("superadminAccess")
            and payload.adminAccess != target_permissions.get("adminAccess")
        ):
            raise HTTPException(status_code=403, detail="Only admins can change admin access")
        if (
            not actor_permissions.get("superadminAccess")
            and payload.superadminAccess != target_permissions.get("superadminAccess")
        ):
            raise HTTPException(status_code=403, detail="Only superadmins can change superadmin access")
        cursor.execute(
            "SELECT 1 FROM GRATLYDB.USER_MASTER WHERE USERID = %s LIMIT 1",
            (user_id,),
        )
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="User permissions not found")

        permission_names = []
        if payload.createPayoutSchedules:
            permission_names.append(PERMISSION_LABELS["createPayoutSchedules"])
        if payload.approvePayouts:
            permission_names.append(PERMISSION_LABELS["approvePayouts"])
        if payload.manageTeam:
            permission_names.append(PERMISSION_LABELS["manageTeam"])
        if payload.adminAccess:
            permission_names.append(PERMISSION_LABELS["adminAccess"])
        if payload.superadminAccess:
            permission_names.append(PERMISSION_LABELS["superadminAccess"])
        if payload.managerAccess:
            permission_names.append(PERMISSION_LABELS["managerAccess"])
        if payload.employeeOnly:
            permission_names.append(PERMISSION_LABELS["employeeOnly"])

        cursor.execute(
            "DELETE FROM GRATLYDB.USER_PERMISSIONS WHERE USERID = %s",
            (user_id,),
        )

        if permission_names:
            placeholders = ", ".join(["%s"] * len(permission_names))
            cursor.execute(
                f"""
                SELECT
                    PERMISSIONSID AS permission_id,
                    PERMISSIONSNAME AS permission_name
                FROM GRATLYDB.MSTR_PERMISSIONS
                WHERE PERMISSIONSNAME IN ({placeholders})
                  AND (DELETED IS NULL OR DELETED = 0)
                """,
                tuple(permission_names),
            )
            rows = cursor.fetchall()
            permission_ids = [
                row["permission_id"] for row in rows if row.get("permission_id") is not None
            ]
            if permission_ids:
                cursor.executemany(
                    """
                    INSERT INTO GRATLYDB.USER_PERMISSIONS (USERID, PERMISSIONSID)
                    VALUES (%s, %s)
                    """,
                    [(user_id, permission_id) for permission_id in permission_ids],
                )

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
        permission_names = [row["permission_name"] for row in rows if row.get("permission_name")]
        permissions = _serialize_permissions(permission_names)
        if permissions is None:
            raise HTTPException(status_code=404, detail="User permissions not found")
        return permissions
    except pymysql.MySQLError as err:
        raise HTTPException(status_code=500, detail=f"Error updating user permissions: {err}")
    finally:
        cursor.close()

@app.get("/restaurant-selection", response_model=List[RestaurantSelectionOption])
def list_restaurant_selection_options(user_id: int):
    permission_names = _fetch_user_permission_names(user_id)
    permissions = _serialize_permissions(permission_names) or {}
    if not (permissions.get("adminAccess") or permissions.get("superadminAccess")):
        raise HTTPException(status_code=403, detail="Admin access required")
    is_superadmin = bool(permissions.get("superadminAccess"))

    cursor = _get_cursor(dictionary=True)
    try:
        if not is_superadmin:
            cursor.execute(
                """
                SELECT 1
                FROM GRATLYDB.USERRESTAURANT
                WHERE USERID = %s
                  AND RESTAURANTID IS NOT NULL
                LIMIT 1
                """,
                (user_id,),
            )
            if cursor.fetchone():
                return []
            cursor.execute(
                """
                SELECT
                    ob.RESTAURANTID AS restaurant_id,
                    rd.RESTAURANTGUID AS restaurant_guid,
                    rd.RESTAURANTNAME AS restaurant_name
                FROM GRATLYDB.SRC_ONBOARDING ob
                LEFT JOIN GRATLYDB.SRC_RESTAURANTDETAILS rd
                    ON rd.RESTAURANTGUID = ob.RESTAURANTGUID
                LEFT JOIN GRATLYDB.USERRESTAURANT ur
                    ON ur.RESTAURANTID = ob.RESTAURANTID
                WHERE ur.RESTAURANTID IS NULL
                ORDER BY rd.RESTAURANTNAME, ob.RESTAURANTID
                """
            )
        else:
            cursor.execute(
                """
                SELECT
                    restaurant_id,
                    restaurant_guid,
                    restaurant_name
                FROM (
                    SELECT
                        ob.RESTAURANTID AS restaurant_id,
                        rd.RESTAURANTGUID AS restaurant_guid,
                        rd.RESTAURANTNAME AS restaurant_name
                    FROM GRATLYDB.SRC_ONBOARDING ob
                    LEFT JOIN GRATLYDB.SRC_RESTAURANTDETAILS rd
                        ON rd.RESTAURANTGUID = ob.RESTAURANTGUID
                    UNION ALL
                    SELECT
                        ob.RESTAURANTID AS restaurant_id,
                        rd.RESTAURANTGUID AS restaurant_guid,
                        rd.RESTAURANTNAME AS restaurant_name
                    FROM GRATLYDB.SRC_RESTAURANTDETAILS rd
                    LEFT JOIN GRATLYDB.SRC_ONBOARDING ob
                        ON ob.RESTAURANTGUID = rd.RESTAURANTGUID
                    WHERE ob.RESTAURANTGUID IS NULL
                ) restaurants
                ORDER BY restaurant_name, restaurant_guid, restaurant_id
                """
            )
        rows = cursor.fetchall()
        return [
            {
                "restaurantId": row.get("restaurant_id"),
                "restaurantGuid": row.get("restaurant_guid"),
                "restaurantName": row.get("restaurant_name"),
            }
            for row in rows
        ]
    finally:
        cursor.close()

@app.post("/restaurant-selection", response_model=RestaurantSelectionOption)
def assign_restaurant_selection(payload: RestaurantSelectionPayload):
    user_id = payload.userId
    restaurant_id = payload.restaurantId
    restaurant_guid = payload.restaurantGuid
    permission_names = _fetch_user_permission_names(user_id)
    permissions = _serialize_permissions(permission_names) or {}
    if not (permissions.get("adminAccess") or permissions.get("superadminAccess")):
        raise HTTPException(status_code=403, detail="Admin access required")
    is_superadmin = bool(permissions.get("superadminAccess"))

    cursor = _get_cursor(dictionary=True)
    try:
        if restaurant_id is None and not restaurant_guid:
            raise HTTPException(status_code=400, detail="restaurantId or restaurantGuid is required")
        cursor.execute(
            "SELECT 1 FROM GRATLYDB.USER_MASTER WHERE USERID = %s LIMIT 1",
            (user_id,),
        )
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="User not found")

        restaurant_row = None
        if restaurant_id is not None:
            cursor.execute(
                """
                SELECT
                    ob.RESTAURANTID AS restaurant_id,
                    rd.RESTAURANTGUID AS restaurant_guid,
                    rd.RESTAURANTNAME AS restaurant_name
                FROM GRATLYDB.SRC_ONBOARDING ob
                JOIN GRATLYDB.SRC_RESTAURANTDETAILS rd
                    ON rd.RESTAURANTGUID = ob.RESTAURANTGUID
                WHERE ob.RESTAURANTID = %s
                LIMIT 1
                """,
                (restaurant_id,),
            )
            restaurant_row = cursor.fetchone()
            if not restaurant_row:
                raise HTTPException(status_code=404, detail="Restaurant not found")
            restaurant_guid = restaurant_row.get("restaurant_guid") or restaurant_guid
        elif restaurant_guid:
            cursor.execute(
                """
                SELECT
                    ob.RESTAURANTID AS restaurant_id,
                    rd.RESTAURANTGUID AS restaurant_guid,
                    rd.RESTAURANTNAME AS restaurant_name
                FROM GRATLYDB.SRC_RESTAURANTDETAILS rd
                LEFT JOIN GRATLYDB.SRC_ONBOARDING ob
                    ON ob.RESTAURANTGUID = rd.RESTAURANTGUID
                WHERE rd.RESTAURANTGUID = %s
                LIMIT 1
                """,
                (restaurant_guid,),
            )
            restaurant_row = cursor.fetchone()
            if not restaurant_row:
                raise HTTPException(status_code=404, detail="Restaurant not found")
            if restaurant_row.get("restaurant_id") is not None:
                restaurant_id = restaurant_row["restaurant_id"]
            elif is_superadmin:
                cursor.execute(
                    """
                    INSERT INTO GRATLYDB.SRC_ONBOARDING (RESTAURANTGUID)
                    VALUES (%s)
                    """,
                    (restaurant_guid,),
                )
                restaurant_id = cursor.lastrowid
                restaurant_row["restaurant_id"] = restaurant_id
            else:
                raise HTTPException(status_code=400, detail="Restaurant is not onboarded")

        if not is_superadmin:
            cursor.execute(
                """
                SELECT 1
                FROM GRATLYDB.USERRESTAURANT
                WHERE RESTAURANTID = %s
                LIMIT 1
                """,
                (restaurant_id,),
            )
            if cursor.fetchone():
                raise HTTPException(status_code=409, detail="Restaurant already assigned")

        cursor.execute(
            """
            UPDATE GRATLYDB.USERRESTAURANT
            SET RESTAURANTID = %s
            WHERE USERID = %s
            """,
            (restaurant_id, user_id),
        )
        if cursor.rowcount == 0:
            cursor.execute(
                """
                INSERT INTO GRATLYDB.USERRESTAURANT (USERID, RESTAURANTID)
                VALUES (%s, %s)
                """,
                (user_id, restaurant_id),
            )

        cursor.execute(
            """
            SELECT PERMISSIONSID AS permission_id
            FROM GRATLYDB.MSTR_PERMISSIONS
            WHERE PERMISSIONSNAME = %s
              AND (DELETED IS NULL OR DELETED = 0)
            LIMIT 1
            """,
            (PERMISSION_LABELS["adminAccess"],),
        )
        permission_row = cursor.fetchone()
        if permission_row:
            cursor.execute(
                """
                SELECT 1
                FROM GRATLYDB.USER_PERMISSIONS
                WHERE USERID = %s AND PERMISSIONSID = %s
                LIMIT 1
                """,
                (user_id, permission_row["permission_id"]),
            )
            if not cursor.fetchone():
                cursor.execute(
                    """
                    INSERT INTO GRATLYDB.USER_PERMISSIONS (USERID, PERMISSIONSID)
                    VALUES (%s, %s)
                    """,
                    (user_id, permission_row["permission_id"]),
                )

        return {
            "restaurantId": restaurant_row.get("restaurant_id"),
            "restaurantGuid": restaurant_row.get("restaurant_guid"),
            "restaurantName": restaurant_row.get("restaurant_name"),
        }
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
    invite_token = data.get("inviteToken") or data.get("token")
    if invite_token:
        invite_token = invite_token.strip()

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

    invite_row = None
    if invite_token:
        invite_row = _get_valid_team_invite(cursor, invite_token, email)

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
        INSERT INTO USER_MASTER (FIRSTNAME, LASTNAME, EMAIL, PHONENUMBER, PASSWORD_HASH, USERSTATUS)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (firstname, lastname, email, phonenumber, password_hash, 1)
    )

    user_id = cursor.lastrowid

    cursor.execute(
        "INSERT INTO GRATLYDB.USERRESTAURANT (USERID) VALUES (%s)",
        (user_id,),
    )

    cursor.execute(
        """
        SELECT PERMISSIONSID AS permission_id
        FROM GRATLYDB.MSTR_PERMISSIONS
        WHERE PERMISSIONSNAME = %s
          AND (DELETED IS NULL OR DELETED = 0)
        LIMIT 1
        """,
        (PERMISSION_LABELS["employeeOnly"],),
    )
    permission_row = cursor.fetchone()
    if permission_row:
        cursor.execute(
            """
            INSERT INTO GRATLYDB.USER_PERMISSIONS (USERID, PERMISSIONSID)
            VALUES (%s, %s)
            """,
            (user_id, permission_row["permission_id"]),
        )

    restaurant_id = invite_row["restaurantId"] if invite_row else _fetch_restaurant_id_for_email(email)
    if restaurant_id is not None:
        cursor.execute(
            "UPDATE GRATLYDB.USERRESTAURANT SET RESTAURANTID = %s WHERE USERID = %s",
            (restaurant_id, user_id),
        )
    if invite_row:
        cursor.execute(
            """
            UPDATE GRATLYDB.TEAM_INVITE_TOKENS
            SET USED_AT = CURRENT_TIMESTAMP
            WHERE INVITE_TOKEN_ID = %s
            """,
            (invite_row["inviteTokenId"],),
        )
        _update_invite_log(cursor, invite_row["inviteId"], "accepted")

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
