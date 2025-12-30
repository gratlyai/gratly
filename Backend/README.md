# Backend

## Stripe webhooks
- In Stripe Dashboard -> Developers -> Webhooks (Event destinations), add your endpoint URL.
- Local development: use Stripe CLI to forward events to `http://localhost:8000/webhooks/stripe`.
- Production: use your HTTPS endpoint, for example `https://api.your-domain.com/webhooks/stripe`.
