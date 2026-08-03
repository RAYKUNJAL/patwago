# PatWaGo VPS handoff for Claude

This package gives a Claude Code session with normal network access a safe, key-based route to the PatWaGo VPS.

## Connection

- Domain: `https://patwago.com`
- VPS: `5.78.105.83`
- SSH port: `22`
- Deploy user: `patwago-deploy`
- Expected app directory: `/opt/patwago`
- Edge proxy: Traefik/Coolify (do **not** enable Caddy)

Public key to authorize on the VPS:

```text
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOPA820E06Vgn1sTGotvLzKh4cwP/9FjZb4/BEx0TMl4 claude-patwago-deploy
```

> The public key is not a login secret. Claude also needs the matching **private key**. This repository does not contain that private key or a VPS password.

## Files in this handoff

- `deploy/setup-patwago-deploy-user.sh` — run once as root on the VPS to create the non-root deploy user and authorize the public key.
- `deploy/patwago_ssh_config` — copy into the Claude Code environment's SSH config.
- `deploy/claude-deploy-prompt.md` — complete implementation, deployment, and live-verification task for Claude.

## One-time VPS setup

From a terminal that can already access the VPS, copy and run the setup script as root:

```bash
scp deploy/setup-patwago-deploy-user.sh root@5.78.105.83:/root/
ssh root@5.78.105.83 'bash /root/setup-patwago-deploy-user.sh'
```

The script:

1. Creates `patwago-deploy`.
2. Installs the supplied public key in its `authorized_keys`.
3. Grants access to `/opt/patwago`.
4. Adds it to the Docker group if Docker is installed.
5. Grants only one passwordless root helper for installing PatWaGo's Traefik file and restarting `coolify-proxy`.

## Claude Code environment setup

Save the matching private key as:

```text
~/.ssh/claude-patwago-deploy
```

Permissions:

```bash
chmod 600 ~/.ssh/claude-patwago-deploy
```

Append `deploy/patwago_ssh_config` to `~/.ssh/config`, then verify:

```bash
ssh patwago-vps 'whoami && hostname && test -d /opt/patwago && echo app-found'
```

Expected user: `patwago-deploy`.

## Task for Claude

Give Claude the contents of `deploy/claude-deploy-prompt.md`. It requires real routed customer pages after payment, backend-linked data, server-side pass authorization, production-safe deployment, and external verification.

## Important security rules

- Do not put a root password, GitHub token, or private key into this repository.
- Do not commit a filled `.env` or credential file.
- Do not give Claude root SSH access when the non-root deploy user is sufficient.
- If the private key has been disclosed publicly, revoke it and generate a new pair.
- This package intentionally contains no fabricated password. A password cannot be recovered from the public key.

## Internal routes Claude must deliver

- `/app`
- `/app/translate`
- `/app/vendors`
- `/app/vendor/:id`
- `/app/trips`
- `/app/guardian`
- `/app/profile`

Successful payment must activate the customer's pass and redirect to `/app`. Missing or expired passes must be rejected server-side.
