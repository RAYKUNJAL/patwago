#!/usr/bin/env bash
set -euo pipefail

# Run once as root on the PatWaGo VPS.
# Creates a non-root SSH user for Claude deployments and installs its public key.

DEPLOY_USER="patwago-deploy"
APP_DIR="/opt/patwago"
PUBLIC_KEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOPA820E06Vgn1sTGotvLzKh4cwP/9FjZb4/BEx0TMl4 claude-patwago-deploy"

if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$DEPLOY_USER"
fi

install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
printf '%s\n' "$PUBLIC_KEY" > "/home/$DEPLOY_USER/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"
chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"

# Allow source updates and Docker-based deploys without granting root SSH access.
if [ -d "$APP_DIR" ]; then
  chown -R "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"
fi

if getent group docker >/dev/null 2>&1; then
  usermod -aG docker "$DEPLOY_USER"
fi

# Traefik routing remains root-owned. Permit only controlled installation of the
# PatWaGo dynamic config and reload of the existing Coolify proxy container.
cat > /usr/local/sbin/patwago-install-traefik <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
SOURCE=/opt/patwago/apps/yaadie-web/patwago.traefik.yaml
TARGET=/data/coolify/proxy/dynamic/patwago.yaml
[ -f "$SOURCE" ] || { echo "Missing $SOURCE" >&2; exit 1; }
install -m 644 "$SOURCE" "$TARGET"
docker restart coolify-proxy >/dev/null
echo "Installed $TARGET and restarted coolify-proxy"
SCRIPT
chmod 755 /usr/local/sbin/patwago-install-traefik

cat > /etc/sudoers.d/patwago-deploy <<'SUDOERS'
patwago-deploy ALL=(root) NOPASSWD: /usr/local/sbin/patwago-install-traefik
SUDOERS
chmod 440 /etc/sudoers.d/patwago-deploy
visudo -cf /etc/sudoers.d/patwago-deploy

echo "PatWaGo deploy access configured."
echo "Login: ssh patwago-deploy@5.78.105.83"
echo "App:   $APP_DIR"
