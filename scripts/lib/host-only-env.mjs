/**
 * Settings in .env that only the host's own scripts use (deploy/scripts/offsite-backup.sh,
 * cloudflared). The app and worker never read them, so they drop them right after loading
 * .env: code running in the app (a dependency, or an attacker after a compromise) cannot read
 * the keys that delete the offsite backups or take over the tunnel. Compose and k3s blank the
 * same keys (deploy/docker-compose.yml x-app-env, deploy/scripts/k3s/deploy.sh).
 */
export const HOST_ONLY_ENV = ["RESTIC_REPOSITORY", "RESTIC_PASSWORD", "OFFSITE_ACCESS_KEY_ID", "OFFSITE_SECRET_ACCESS_KEY", "CLOUDFLARE_TUNNEL_TOKEN"];

/** Removes the host-only settings from `env` (process.env by default). */
export function dropHostOnlyEnv(env = process.env) {
  for (const key of HOST_ONLY_ENV) delete env[key];
}
