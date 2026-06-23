# Deploying CS2 Manager to AWS Lightsail

End-to-end deploy guide for the recommended single-domain HTTPS setup:
Caddy on a Lightsail box serves the React client AND reverse-proxies the
WebSocket + public HTTP routes to the Node server on localhost:8787.

**Time:** ~20 minutes the first time, mostly waiting on DNS propagation
and `npm install`.

**Result:** Friends visit `https://csm.yourdomain.com`, the client
auto-connects to the WebSocket on the same origin, no port numbers
needed anywhere.

---

## 0. What you need before you start

- AWS account with billing set up (Lightsail is ~$5/mo)
- A domain you control (any registrar — Namecheap, Cloudflare, etc.)
- The repo pushed to GitHub (private is fine, but you'll need to make
  the install step use SSH or a deploy key — public repo is easiest)
- ~5 minutes to wait for DNS to propagate after step 2

---

## 1. Spin up the Lightsail instance

1. Lightsail console → **Create instance**
2. **Linux/Unix → Ubuntu 22.04 LTS**
3. Pick the **$5/mo** plan (1 GB RAM, 1 vCPU) — plenty for this server
4. Name it `csm-server` and create
5. Wait until status reads **Running**
6. Attach a **Static IP**: Networking tab → Create static IP → attach to the instance
7. Open the firewall: **Networking → IPv4 Firewall → Add rule**

   | Application | Port | Source |
   |---|---|---|
   | HTTP | 80 | Anywhere |
   | HTTPS | 443 | Anywhere |

   You do **not** open 8787 — Caddy fronts everything on 443.

---

## 2. Point your domain at the instance

In your DNS provider, add an **A record**:

```
csm.yourdomain.com → <your-lightsail-static-ip>
```

(Or use the apex domain `yourdomain.com` if you prefer — the install
script just takes whatever hostname you give it.)

Wait ~5 minutes for the record to propagate. Test from your laptop:

```bash
ping csm.yourdomain.com   # should resolve to the static IP
```

---

## 3. One-shot install

SSH into the box (Lightsail has a one-click browser SSH, or use the
keypair):

```bash
ssh ubuntu@<your-lightsail-static-ip>
```

Run the install script from your repo:

```bash
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/<you>/csmanager/main/deploy/install.sh)" -- csm.yourdomain.com https://github.com/<you>/csmanager.git
```

(Replace `<you>` and `csm.yourdomain.com` with your real values.)

The script:
- Installs Node 20, git, build tools, **Caddy**
- Clones the repo to `/home/ubuntu/csmanager`
- Runs `npm install` for both the server (`server/`) and the client (`./`)
- Builds the React client (`npm run build` → `dist/`)
- Drops in the `systemd` unit for the Node server
- Templates the Caddyfile with your domain and reloads Caddy

When it finishes, both services are running. Caddy auto-provisions a
Let's Encrypt cert on first request — first hit to `https://csm.yourdomain.com`
takes ~5 seconds, after that it's cached.

---

## 4. Verify

From your laptop:

- Visit **`https://csm.yourdomain.com`** → React app loads
- Click **Play Online → Connect** → the URL field is already populated
  with `wss://csm.yourdomain.com` — just enter a nickname + 4-digit PIN
- Test the public HTTP routes:
  - `https://csm.yourdomain.com/stats` → server-wide stats
  - `https://csm.yourdomain.com/hof` → Hall of Fame
  - `https://csm.yourdomain.com/team/<team-id>` → public team profile
    after you create one

On the box, check status:

```bash
sudo systemctl status csm-server
sudo systemctl status caddy
sudo journalctl -fu csm-server          # live server log
sudo journalctl -fu caddy               # live Caddy log (rare to need)
```

---

## 5. Updating the server

After pushing new commits to GitHub:

```bash
ssh ubuntu@<your-lightsail-static-ip>
bash /home/ubuntu/csmanager/deploy/update.sh
```

That pulls, reinstalls deps if needed, rebuilds the client, restarts
the Node server, and reloads Caddy. **No downtime for the static files**;
WebSocket clients reconnect after the ~1-second restart blip.

---

## 6. Backups

The whole world state lives in **one SQLite file** at
`/home/ubuntu/csmanager/server/data/csm.db`. Back it up daily:

```bash
sqlite3 /home/ubuntu/csmanager/server/data/csm.db ".backup /tmp/csm-$(date +%F).db"
```

A simple cron job (`crontab -e`) covers it:

```cron
0 4 * * * sqlite3 /home/ubuntu/csmanager/server/data/csm.db ".backup /tmp/csm-$(date +\%F).db" && find /tmp -name 'csm-*.db' -mtime +7 -delete
```

(Replace `/tmp` with an S3 sync if you care about retention beyond the box.)

---

## 7. Troubleshooting

**Browser console shows "WebSocket failed" / mixed-content errors**
The page is HTTPS but the client tried `ws://...`. Check that the URL
in the Connect screen starts with `wss://` and the hostname matches
your domain (no port). Hard-refresh after deploys clears any stale
`localStorage` connect URL.

**Caddy returns 502 Bad Gateway**
Node server isn't running. `sudo systemctl status csm-server` to confirm
+ `sudo journalctl -u csm-server -n 100` for the last 100 log lines.

**Let's Encrypt cert didn't issue**
Most likely DNS hasn't propagated yet, or ports 80/443 aren't open.
`dig csm.yourdomain.com +short` from your laptop should return the
Lightsail static IP. Caddy retries automatically every few minutes.

**`npm install` fails on better-sqlite3**
Rare but happens. `sudo apt install -y python3 make g++` then rerun —
build tools needed to compile from source if the prebuilt binary isn't
available for your kernel.

---

## File map

```
deploy/
├── install.sh         # one-shot Lightsail bootstrap
├── update.sh          # pull + rebuild + restart loop
├── csm-server.service # systemd unit (drops into /etc/systemd/system)
└── Caddyfile          # reverse-proxy + static-file routing
```

Want a different setup (subdomain split, separate static host on
Cloudflare Pages, plain HTTP for LAN only)? See [server/README.md](server/README.md)
for the lower-level details.
