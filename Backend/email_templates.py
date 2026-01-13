"""Email templates for Moov billing and payout notifications."""


def get_invoice_created_template(restaurant_name: str, amount: str, due_date: str) -> dict:
    """Generate invoice created email template."""
    return {
        "subject": f"New Invoice from Gratly - ${amount}",
        "html": f"""
        <html>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1a73e8;">Invoice Created</h2>
            <p>Hello {restaurant_name},</p>
            <p>A new invoice has been generated for your monthly Gratly subscription.</p>
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                <tr><td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Amount:</strong></td><td style="padding: 8px; border-bottom: 1px solid #ddd;">${amount}</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Due Date:</strong></td><td style="padding: 8px; border-bottom: 1px solid #ddd;">{due_date}</td></tr>
            </table>
            <p>Payment will be automatically processed from your registered payment method.</p>
            <p style="color: #666; font-size: 12px; margin-top: 30px;">Questions? Contact support@gratly.com</p>
        </body>
        </html>
        """,
    }


def get_payment_success_template(restaurant_name: str, amount: str, date: str) -> dict:
    """Generate payment success email template."""
    return {
        "subject": f"Payment Successful - ${amount}",
        "html": f"""
        <html>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #0f9d58;">Payment Successful</h2>
            <p>Hello {restaurant_name},</p>
            <p>Your monthly Gratly payment has been processed successfully.</p>
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                <tr><td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Amount:</strong></td><td style="padding: 8px; border-bottom: 1px solid #ddd;">${amount}</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Date:</strong></td><td style="padding: 8px; border-bottom: 1px solid #ddd;">{date}</td></tr>
            </table>
            <p>Thank you for using Gratly!</p>
            <p style="color: #666; font-size: 12px; margin-top: 30px;">Questions? Contact support@gratly.com</p>
        </body>
        </html>
        """,
    }


def get_payment_failed_template(restaurant_name: str, amount: str, reason: str) -> dict:
    """Generate payment failed email template."""
    return {
        "subject": "Payment Failed - Action Required",
        "html": f"""
        <html>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #d93025;">Payment Failed</h2>
            <p>Hello {restaurant_name},</p>
            <p>We were unable to process your payment.</p>
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                <tr><td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Amount:</strong></td><td style="padding: 8px; border-bottom: 1px solid #ddd;">${amount}</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Reason:</strong></td><td style="padding: 8px; border-bottom: 1px solid #ddd;">{reason}</td></tr>
            </table>
            <p><strong>Action Required:</strong> Please update your payment method in the Billing settings or contact support.</p>
            <p style="color: #666; font-size: 12px; margin-top: 30px;">Questions? Contact support@gratly.com</p>
        </body>
        </html>
        """,
    }


def get_payout_completed_template(employee_name: str, amount: str, date: str) -> dict:
    """Generate payout completed email template."""
    return {
        "subject": f"Payout Processed - ${amount}",
        "html": f"""
        <html>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #0f9d58;">Payout Completed</h2>
            <p>Hello {employee_name},</p>
            <p>Your payout has been successfully processed.</p>
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                <tr><td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Amount:</strong></td><td style="padding: 8px; border-bottom: 1px solid #ddd;">${amount}</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Date:</strong></td><td style="padding: 8px; border-bottom: 1px solid #ddd;">{date}</td></tr>
            </table>
            <p>Funds should arrive in your account within 1-2 business days.</p>
            <p style="color: #666; font-size: 12px; margin-top: 30px;">Questions? Contact support@gratly.com</p>
        </body>
        </html>
        """,
    }
