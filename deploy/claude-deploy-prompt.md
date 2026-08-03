# PatWaGo live deployment task

Connect using:

```bash
ssh patwago-vps
```

The matching private key must be installed at `~/.ssh/claude-patwago-deploy` with mode `600`. The VPS public key is already documented in the repository setup script.

## Objective

Turn PatWaGo into a real paid customer application and deploy it to `https://patwago.com`.

Required routes:

- `/` — public marketing site
- `/app` — customer dashboard after payment
- `/app/translate` — working Patois translation service
- `/app/vendors` — searchable vendor marketplace
- `/app/vendor/:id` — vendor details, reviews, price and booking action
- `/app/trips` — persistent trip planner
- `/app/guardian` — persistent safety check-ins and trusted contacts
- `/app/profile` — active pass and account details

## Non-negotiable behavior

1. `/app/*` must be real routed pages, not anchor sections on `/`.
2. Successful payment must activate a pass and redirect to `/app`.
3. Server-side authorization must deny expired/missing passes; hiding UI alone is not authorization.
4. Customer data must be persisted and scoped to the signed-in customer. Do not use shared global demo records in production.
5. Vendor/place/trip/check-in/review screens must read and write through the backend.
6. Keep the app self-hosted on this VPS. Do not use Vercel or cloud Supabase.
7. Do not expose admin credentials or secrets in frontend HTML.
8. Do not destroy or overwrite production data. Back up state/database before migrations.

## Safe deployment sequence

```bash
ssh patwago-vps
cd /opt/patwago
git status --short --branch
git remote -v
git fetch origin
# Inspect local drift before selecting a sync strategy.
```

Discover the live service before restarting anything:

```bash
systemctl list-units --type=service | grep -i patwago || true
docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | grep -i patwago || true
```

Run all tests/builds before deployment. If Docker Compose is used, ensure the app service remains on the external `coolify` network after recreation. Install the repository Traefik file only if needed:

```bash
sudo /usr/local/sbin/patwago-install-traefik
```

## Required verification

Verify every route externally, not just localhost:

```bash
curl -sk -o /dev/null -w '%{http_code}\n' https://patwago.com/
curl -sk https://patwago.com/api/health
curl -sk -o /dev/null -w '%{http_code}\n' https://patwago.com/app
curl -sk -o /dev/null -w '%{http_code}\n' https://patwago.com/app/translate
curl -sk -o /dev/null -w '%{http_code}\n' https://patwago.com/app/vendors
curl -sk -o /dev/null -w '%{http_code}\n' https://patwago.com/app/trips
curl -sk -o /dev/null -w '%{http_code}\n' https://patwago.com/app/guardian
curl -sk -o /dev/null -w '%{http_code}\n' https://patwago.com/app/profile
```

Also complete one test purchase in the configured sandbox/test mode, verify redirect to `/app`, create a trip, schedule a Guardian check-in, open a vendor detail page, and confirm the data survives a service restart. Remove test records afterwards.

Report the deployed Git commit, service/container name, exact verification results, and any remaining blocker. Do not claim completion without live proof.
