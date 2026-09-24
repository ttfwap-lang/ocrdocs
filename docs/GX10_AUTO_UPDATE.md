# GX10 automatic updates

`ocr.local` is served by the systemd application on the GX10, not by the
Windows checkout. The live host therefore uses a small release manager rather
than serving whatever happens to be in a long-lived `dist/` directory.

## What is installed

The installer creates:

- `/home/flak3dd/ocrdocs-releases/<git-commit>/` — root-owned, read-only
  source, locked `node_modules`, and production `dist/` for one commit;
- `/home/flak3dd/ocrdocs-current` — an atomically switched symlink used by the
  server and worker units;
- `/home/flak3dd/ocrdocs` — persistent runtime data only (`.env`, `.env.worker`,
  `data/app.db`, uploads, and worker files are not replaced by a release);
- `/var/lib/ocrdocs-updater/` — root-owned previous/last-good release pointers,
  a pending-worker marker, and verified SQLite backups;
- `/usr/local/sbin/ocrdocs-auto-update` — the updater;
- `ocrdocs-update.service` and `ocrdocs-update.timer` — a root-owned systemd
  timer that checks every 15 minutes.

The updater obtains clean tracked files from the repository's `main` branch,
runs `npm ci`, the TypeScript check, and `npm run build` as an isolated
builder account that cannot read the runtime data, makes and integrity-checks a
SQLite backup, validates the server bundle, switches the symlink, restarts the
server, and waits for `/api/health` to report the new commit. If the health
check fails, it restores the durable previous release and restarts it. The
worker is refreshed only after its current `processing` jobs drain; a busy
worker is left running and retried by the next timer pass. The updater also
atomically refreshes its own script and validated systemd unit files from a
successful release, so a future updater fix does not require a second manual
deployment.

The timer follows the repository's `main` branch. That branch is a trusted
release channel: a maintainer who can push to it can cause code to run on the
GX10. Protect the branch and review pushes. The timer never runs
`apt`, `dgx_setup.sh`, or Python dependency installers; the existing GPU/Python
runtime remains separately managed.

## Install or repair it on the GX10

From a checkout of this repository, run on the GX10 as root:

```bash
sudo bash scripts/install_ocrdocs_auto_update.sh
```

The installer first points `ocrdocs-current` at the existing application, so
an unsuccessful first build does not take the live service down. It preserves
the host's existing queue/import policy and worker runtime drop-ins, then
starts one update synchronously and enables the timer.

Useful checks:

```bash
systemctl status ocrdocs-update.timer
systemctl list-timers ocrdocs-update.timer
readlink -f /home/flak3dd/ocrdocs-current
curl -s http://127.0.0.1:3000/api/health | python3 -m json.tool
journalctl -u ocrdocs-update.service -n 100 --no-pager
```

The `build_commit` in the health response must match the commit in the current
release. A browser refresh is not a deployment mechanism: if the live asset is
still old, inspect the updater log and the symlink rather than clearing site
data.

## Manual update and rollback

Run one update immediately:

```bash
sudo systemctl start ocrdocs-update.service
```

The service fails closed: a GitHub outage, dependency failure, build failure,
or unhealthy new process leaves the current release serving. Durable
`previous-release` and `last-good-release` pointers, plus recent verified
SQLite backups, are kept under `/var/lib/ocrdocs-updater/`. The updater never
automatically restores the database during a code rollback, because doing so
could discard legitimate writes made after the backup. To inspect or restore a
specific release manually, stop the application services, point
`/home/flak3dd/ocrdocs-current` at a known release directory, run
`systemctl daemon-reload`, and restart `ocrdocs-server.service` and
`ocrdocs-worker.service`. Do not edit files inside a release directory; create
a new commit/release instead.

## Security and operational notes

- The updater stores no passwords or API keys. It uses the public GitHub
  repository and the existing runtime environment files; those files remain
  owned by `flak3dd` and outside every release directory.
- The source checkout used by the updater is disposable and separate from the
  live checkout. The updater never resets the persistent runtime directory.
- Keep the repository's `main` branch reviewed and push only intended commits.
  Anyone who can write that branch can cause the next scheduled deployment.
- Rotate the GX10 password and any tokens that have been pasted into chat or
  logs. The supplied password is not stored by this repository or installer.
