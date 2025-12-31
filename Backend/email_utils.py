import json
import urllib.request
import urllib.error
from typing import Optional
from fastapi import HTTPException

try:
    from Backend.db import _get_env_or_ini
except ImportError:
    from db import _get_env_or_ini

def send_sendgrid_email(
    to_email: str,
    subject: str,
    content: str,
    sender_name: Optional[str] = None,
    html_content: Optional[str] = None,
):
    api_key = _get_env_or_ini("SENDGRID_API_KEY")
    from_email = _get_env_or_ini("SENDGRID_FROM_EMAIL")
    if not api_key or not from_email:
        raise HTTPException(status_code=500, detail="SendGrid is not configured")

    contents = [{"type": "text/plain", "value": content}]
    if html_content:
        contents.append({"type": "text/html", "value": html_content})

    payload = {
        "personalizations": [{"to": [{"email": to_email}]}],
        "from": {"email": from_email, "name": sender_name or "Gratly"},
        "subject": subject,
        "content": contents,
    }
    request = urllib.request.Request(
        "https://api.sendgrid.com/v3/mail/send",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request) as response:
            if response.status not in (200, 202):
                raise HTTPException(status_code=502, detail="Failed to send invite email")
    except urllib.error.HTTPError as err:
        raise HTTPException(status_code=502, detail=f"SendGrid error: {err.reason}")
    except urllib.error.URLError as err:
        raise HTTPException(status_code=502, detail=f"SendGrid connection error: {err.reason}")
