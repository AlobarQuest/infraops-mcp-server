# Job monitoring with Healthchecks

Scheduled jobs in the portfolio report to the self-hosted Healthchecks at
https://healthcheck.alobar.net (Coolify service `o13j4sqwwfyktuuje0qvaa6k` on the OVH VPS,
Healthchecks v4.4). This page is how an agent adds a check for a new job and manages it
afterwards. There's no check limit, and no step needs Devon.

Hosted Healthchecks.io keeps two checks on purpose:

- `alobar-healthchecks-watchdog`: pinged every 10 minutes by `scripts/hc-watchdog.sh`
  (launchd `com.devon.hc-watchdog`) only while the self-hosted instance answers `OK`. If the
  instance, the VPS, Cloudflare, or the Mac mini stops working, hosted emails Devon. A monitor
  can't report on the host it runs on (infra-brain lesson #275), so never move it.
- `VPS Nightly Backup`: `vps-backup/backup.sh` pings it on both instances, so the proof that
  production data left the VPS doesn't depend on the VPS.

Don't add other checks to hosted. To manage those two checks, use the hosted read-write key,
BWS secret `healthchecks.io_api_key` (`260cc8ad-f170-44cc-a672-b47000df3350`), against
`https://healthchecks.io/api/v3/`. No job uses it; it's kept only for this.

## Fetch the API key

The read-write key is BWS secret `healthchecks_selfhosted_api_key`
(`51509d5e-64f5-4781-ae82-b4ed00b644e1`, project `Ops / Platform`). Read it into a variable and
never print it:

```sh
HC_KEY=$(bws secret get 51509d5e-64f5-4781-ae82-b4ed00b644e1 --output json --color no \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["value"])')
```

Pass `--color no` on every parsed `bws` call. The read-only key, which hides ping URLs, belongs to
the rotation executor alone (BWS `f07b1368-…` in `Rotation / Healthchecks`). Healthchecks allows
one read-write and one read-only key per project, so don't create more.

Healthcheck.alobar.net is proxied by Cloudflare, which refuses default Python User-Agents with
`error code: 1010`. A Python client must send a named User-Agent; curl's default passes.

## Register a check

Create the check from the job's setup or install step, with `unique: ["name"]` so a re-run returns
the existing check (HTTP 200) instead of a duplicate (HTTP 201 means it was created):

```sh
curl -fsS -X POST https://healthcheck.alobar.net/api/v3/checks/ \
  -H "X-Api-Key: $HC_KEY" -H "Content-Type: application/json" \
  -d '{"name": "<kebab-case-job-name>", "schedule": "30 3 * * *", "tz": "America/New_York",
       "grace": 3600, "channels": "alert-hub", "unique": ["name"], "desc": "<repo and launcher>"}'
```

- **Name:** kebab-case, matching the launchd label or lane (`sds-<lane>`). Pingers find the check
  by this exact name, so treat it as permanent. The rotation registry's `healthchecks_check`
  fields name checks too.
- **Schedule:** for a cron job, `schedule` plus `tz: "America/New_York"`. For an interval job, send
  `timeout` in seconds instead.
- **Grace:** how late a run may be before the check goes down. Existing jobs use 3,600 seconds for
  hourly jobs and 14,400 for the nightly SDS lanes.
- **`channels: "alert-hub"`:** attaches the `alert-hub` webhook, which sends the check's down and up
  events to alert-hub (`https://alerts.alobar.net`). Don't use `"*"`: it would also attach the
  email integration and deliver every failure twice. Only the hub's own `alert-hub` check uses
  email, because the hub can't report its own outage.

A new check stays in `new` status, which never alerts, until its first ping.

## Ping from the job

Resolve the ping URL by name at run time, the pattern in `orchestrator/scripts/sds-deadman.sh`,
`project-standards/integrations/portfolio-scan.sh`, and `vps-backup/backup-mini.sh`. Never commit
a ping URL.

1. `GET https://healthcheck.alobar.net/api/v3/checks/` with the key, and take `ping_url` from the
   one check whose `name` matches exactly. A read-only key returns no `ping_url`.
2. Ping `<ping_url>/start` when the job begins, `<ping_url>` on success, and `<ping_url>/fail` on
   failure. `<ping_url>/<exit-code>` also works. A POST body is stored with the ping and readable
   in the UI and through `/api/v3/checks/<uuid>/pings/`.
3. Treat every Healthchecks failure as non-fatal: log one line and keep running the job.

## Change, pause, or delete a check

| Action                                   | Request                                                |
| ---------------------------------------- | ------------------------------------------------------ |
| Change settings                          | `POST /api/v3/checks/<uuid>` with the fields to change |
| Pause (stops alerts until the next ping) | `POST /api/v3/checks/<uuid>/pause`                     |
| Delete                                   | `DELETE /api/v3/checks/<uuid>`                         |
| List integrations                        | `GET /api/v3/channels/`                                |

Get `<uuid>` from the listing. Before deleting or renaming a check, grep the portfolio's
`.cred-consumers.toml` files for its name: the rotation executor refuses a unit whose
`healthchecks_check` names a missing check.

Integrations can't be created through the API. Devon adds them in the web UI under
**Integrations**.

## Back up and restore

The database is `/var/lib/docker/volumes/o13j4sqwwfyktuuje0qvaa6k_healthchecks-data/_data/hc.sqlite`
on the VPS, copied nightly by `vps-backup/backup.sh` (`sqlite_copy "healthchecks"`).

## Copy checks from another instance

`scripts/hc-copy-checks.py --hosted-key-id <bws-uuid> --target-key-id <bws-uuid>` copies every
check from hosted Healthchecks.io, keeping names and settings. It's safe to re-run, and it never
prints ping URLs.
