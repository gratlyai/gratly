"""Background job scheduler for Moov payments and billing."""

import logging
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

try:
    from Backend.moov_jobs import (
        monthly_invoice_job,
        monthly_invoice_collect_retry_job,
        nightly_restaurant_debit_job,
        payout_disbursement_job,
    )
except ImportError:
    from moov_jobs import (
        monthly_invoice_job,
        monthly_invoice_collect_retry_job,
        nightly_restaurant_debit_job,
        payout_disbursement_job,
    )

logger = logging.getLogger(__name__)
scheduler = BackgroundScheduler()


def init_scheduler():
    """Initialize and start the background job scheduler."""
    print("[SCHEDULER] Starting scheduler initialization...")

    # Monthly invoice generation - 1st of month at 2 AM
    scheduler.add_job(
        monthly_invoice_job,
        CronTrigger(day=1, hour=2, minute=0),
        id="monthly_invoice",
        name="Generate monthly billing invoices",
        replace_existing=True,
    )
    print("[SCHEDULER] Added job: monthly_invoice")

    # Collection retry - Daily at 10 AM
    scheduler.add_job(
        monthly_invoice_collect_retry_job,
        CronTrigger(hour=10, minute=0),
        id="collect_retry",
        name="Retry failed invoice collections",
        replace_existing=True,
    )
    print("[SCHEDULER] Added job: collect_retry")

    # Nightly restaurant debit - Daily at 3 AM
    scheduler.add_job(
        nightly_restaurant_debit_job,
        CronTrigger(hour=3, minute=0),
        id="nightly_debit",
        name="Process restaurant debits",
        replace_existing=True,
    )
    print("[SCHEDULER] Added job: nightly_debit")

    # Payout disbursement - Daily at 4 AM
    scheduler.add_job(
        payout_disbursement_job,
        CronTrigger(hour=4, minute=0),
        id="payout_disbursement",
        name="Disburse employee payouts",
        replace_existing=True,
    )
    print("[SCHEDULER] Added job: payout_disbursement")

    scheduler.start()
    logger.info("Job scheduler started successfully with 4 automated jobs")
    print("[SCHEDULER] Job scheduler started successfully with 4 automated jobs")


def shutdown_scheduler():
    """Gracefully shutdown the scheduler."""
    if scheduler.running:
        scheduler.shutdown()
        logger.info("Job scheduler shut down gracefully")
