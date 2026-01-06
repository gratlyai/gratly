# Backend

## CORS
- Set `CORS_ORIGINS` to a comma-separated list of allowed frontend origins, for example `https://dev.gratly.ai,http://localhost:5173`.

## Astra
Set these environment variables for Astra onboarding:

```
ASTRA_BASE_URL=https://api-sandbox.astra.finance
ASTRA_OAUTH_AUTHORIZE_URL=https://app-sandbox.astra.finance/login/oauth/authorize
ASTRA_OAUTH_TOKEN_URL=https://app-sandbox.astra.finance/login/oauth/token
ASTRA_OAUTH_CLIENT_AUTH=basic
ASTRA_OAUTH_SCOPE=cards
ASTRA_CLIENT_ID=...
ASTRA_CLIENT_SECRET=...
ASTRA_REDIRECT_URI_BUSINESS=https://dev.gratly.ai/business/{restaurantId}/profile
ASTRA_REDIRECT_URI_EMPLOYEE=https://dev.gratly.ai/business/{restaurantId}/profile
ASTRA_APP_RETURN_URI_BUSINESS=https://dev.gratly.ai/business/{restaurantId}/profile
ASTRA_APP_RETURN_URI_EMPLOYEE=https://dev.gratly.ai/business/{restaurantId}/profile
ASTRA_CARDS_CONNECT_URL=https://app-sandbox.astra.finance/cards/connect
ASTRA_CARDS_DEBIT_DIRECT=true
TOKEN_ENCRYPTION_KEY=...
ASTRA_WEBHOOK_SECRET=...
```

Note: Cards Connect builds a browser redirect with `client_id`, `user_id`, and `redirect_uri`.

## Stripe Billing (Connect)
Set these environment variables for Stripe Billing:

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID=price_...
APP_URL=http://localhost:5173
```

Local webhook testing:

```
stripe listen --forward-to http://localhost:8000/api/webhooks/stripe
```

Platform MoR: Billing customers/subscriptions are created on the platform account. Stripe webhooks should be configured on the platform account.
The Stripe price ID can be set via `STRIPE_PRICE_ID` or in `GRATLYDB.BILLING_CONFIG` with key `stripe_price_id`.
