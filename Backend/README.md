# Backend

## CORS
- Set `CORS_ORIGINS` to a comma-separated list of allowed frontend origins, for example `https://dev.gratly.ai,http://localhost:5173`.

## Moov Payments
Set these environment variables for Moov payments and billing:

```
MOOV_BASE_URL=https://api.moov.io
MOOV_API_KEY=your_moov_api_key
MOOV_PLATFORM_ACCOUNT_ID=your_platform_account_id
```

For sandbox testing:

```
MOOV_BASE_URL=https://api.sandbox.moov.io
MOOV_API_KEY=your_sandbox_api_key
MOOV_PLATFORM_ACCOUNT_ID=your_sandbox_platform_account_id
```

### Webhooks
Configure Moov webhooks in the Moov dashboard to point to:

```
https://your-domain.com/api/webhooks/moov
```

### Background Jobs
Four automated jobs run daily:

1. `monthly_invoice` - Generate monthly billing invoices (1st of month, 2 AM restaurant time)
2. `collect_retry` - Retry failed invoice collections (daily, 10 AM restaurant time)
3. `nightly_debit` - Process restaurant ACH debits (daily, 3 AM restaurant time)
4. `payout_disbursement` - Disburse employee payouts (daily, 4 AM restaurant time)
