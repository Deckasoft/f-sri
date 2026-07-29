#!/usr/bin/env bash
# Idempotent hardening pass for the Hostinger VPS this stack deploys to. Run
# once after provisioning (and safe to re-run any time — every step checks
# current state before changing anything). Targets the specific ops pain
# points that made a bare VPS unappealing: unattended security patching,
# unbounded log/image growth filling the disk, and basic SSH/firewall
# hygiene — NOT a general CIS-hardening checklist.
#
# Must run as root (or via sudo). Tested on Debian/Ubuntu (Hostinger's VPS
# images); assumes apt.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root (sudo $0)" >&2
  exit 1
fi

echo "== Updating package index =="
apt-get update -qq

echo "== Unattended security upgrades =="
apt-get install -y -qq unattended-upgrades apt-listchanges >/dev/null
cat >/etc/apt/apt.conf.d/51-f-sri-unattended-upgrades <<'EOF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:00";
EOF
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null

echo "== Firewall (ufw): allow SSH/HTTP/HTTPS only =="
apt-get install -y -qq ufw >/dev/null
ufw allow 22/tcp comment 'SSH' >/dev/null
ufw allow 80/tcp comment 'HTTP (Caddy ACME + redirect)' >/dev/null
ufw allow 443/tcp comment 'HTTPS' >/dev/null
ufw --force enable >/dev/null

echo "== fail2ban on sshd =="
apt-get install -y -qq fail2ban >/dev/null
cat >/etc/fail2ban/jail.d/f-sri-sshd.local <<'EOF'
[sshd]
enabled = true
bantime = 1h
findtime = 10m
maxretry = 5
EOF
systemctl enable --now fail2ban >/dev/null

echo "== SSH: key-only auth, no root password login =="
SSHD_CONFIG=/etc/ssh/sshd_config
sed -i \
  -e 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' \
  -e 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' \
  "$SSHD_CONFIG"
systemctl reload sshd

echo "== 2GB swapfile =="
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  echo 'vm.swappiness=10' >/etc/sysctl.d/60-f-sri-swappiness.conf
  sysctl --system >/dev/null
else
  echo "  /swapfile already exists, skipping"
fi

echo "== Docker log rotation =="
mkdir -p /etc/docker
DAEMON_JSON=/etc/docker/daemon.json
if [ ! -f "$DAEMON_JSON" ] || ! grep -q 'log-driver' "$DAEMON_JSON" 2>/dev/null; then
  cat >"$DAEMON_JSON" <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
EOF
  systemctl restart docker
else
  echo "  $DAEMON_JSON already configures log-driver, skipping (edit manually if needed)"
fi

echo "== Weekly Docker image/container prune cron =="
cat >/etc/cron.weekly/f-sri-docker-prune <<'EOF'
#!/bin/sh
docker system prune -af --filter until=168h
EOF
chmod +x /etc/cron.weekly/f-sri-docker-prune

echo "== Done. Reboot recommended to pick up the swapfile/kernel updates. =="
