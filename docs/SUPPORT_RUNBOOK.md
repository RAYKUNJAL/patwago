# PatWaGo support runbook

## Payment worked but no pass
1. Get PayPal order id / capture id from customer.
2. Confirm they can sign in.
3. Have them open `/support` and paste order id, or:
```bash
curl -X POST https://patwago.com/api/account/claim-order   -H "Cookie: patwago_session=..." -H "Content-Type: application/json"   -d '{"order_id":"ORDER_ID"}'
```
4. Admin grant (last resort):
```bash
curl -X POST https://patwago.com/api/admin/grant-pass   -H "Authorization: Bearer $ADMIN_ANALYTICS_TOKEN"   -H "Content-Type: application/json"   -d '{"email":"user@email.com","plan":"day"}'
```
5. Check payments:
```bash
curl -H "Authorization: Bearer $ADMIN_ANALYTICS_TOKEN"   "https://patwago.com/api/admin/payments?limit=20"
```

## Verify a partner vendor
```bash
curl -X POST https://patwago.com/api/admin/vendor-signups/verify   -H "Authorization: Bearer $ADMIN_ANALYTICS_TOKEN"   -H "Content-Type: application/json"   -d '{"id":"signup-XXXX"}'
```

## Refunds
- Email bookings@patwago.com within 24h for platform-fault cases.
- Refund in PayPal dashboard; note order id in support log.
- Do not re-grant pass after full refund unless goodwill.

## Privacy / consent
- privacy@patwago.com
- User can clear site data to withdraw browser consent.
