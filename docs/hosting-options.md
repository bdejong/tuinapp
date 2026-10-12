# Hosting several personal apps

Recommendation, researched 12 October 2026: share one small EU virtual server between the apps, with one container and separate persistent data per app. Start at 4 GB RAM for a handful of light applications, or 8 GB if the other apps use larger frameworks, databases or background jobs. Measure their idle memory before choosing. Build release images in CI rather than on the small server.

Use Docker Compose and one HTTPS reverse proxy (for example Caddy), with a subdomain per app. Keep each app's database and backup directory separate. Add encrypted backups to an independent provider, server updates, disk monitoring and a backup-failure alert. TuinApp is already packaged for this arrangement. A shared server also means a host outage affects all apps; that is a reasonable cost tradeoff for personal use.

## Shortlist and cost basis

| Option | Current published basis | Fit |
| --- | --- | --- |
| OVHcloud EU VPS | Ireland catalogue advertises VPS-1: 2 vCores, 4 GB RAM, 40 GB disk from €3.81/month excluding VAT; VPS-2: 4 vCores, 8 GB RAM, 75 GB from €7.21/month excluding VAT | A useful starting shortlist for one shared server. Verify Belgian checkout, commitment/renewal price and a regular EU datacentre before ordering. |
| Hetzner | June 2026 price table lists CX23 at €5.49/month excluding VAT and IPv4, but the current cloud catalogue marks the cost-optimized range unavailable | Consider if stock returns; do not budget around an unavailable instance. |
| Managed application hosting, such as Render | Compute is charged per running service; persistent disks are an additional charge, and free web services cannot attach them | Less server maintenance, but compare the total for all apps. TuinApp needs a paid persistent disk. |

Sources: [OVHcloud VPS catalogue](https://www.ovhcloud.com/en-ie/vps/), [Hetzner price adjustment](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/), [Hetzner current catalogue](https://www.hetzner.com/cloud/), [Render compute plans](https://render.com/docs/compute-plans), [Render free-service limits](https://render.com/docs/free), [Render pricing](https://render.com/pricing).

These are advertised starting prices, not a Belgian checkout quote. Allow approximately **€10–15/month total** as an initial planning budget for a small shared server, modest independent backup storage and the amortized cost of a domain. This is an estimate; other app sizes, storage growth, contract terms and tax can change it. One existing domain can cover all apps through subdomains.

Backblaze B2 is one independent backup-storage candidate. Its current published rate is $6.95/TB/month, with the first 10 GB free, and no minimum storage duration. Encrypt snapshots before upload and keep recovery credentials separately. Small garden snapshots are inexpensive; the other apps determine the total. [Backblaze B2 pricing](https://www.backblaze.com/cloud-storage/pricing).

## Proposed rollout

1. Inventory the other apps: language/runtime, database, background tasks, approximate storage and who needs access.
2. Choose the server size and provider using actual checkout terms. Prefer a short initial commitment while validating the setup.
3. Configure HTTPS, owner access, persistent storage, off-site backups and failure alerts.
4. Deploy TuinApp with a copy of the migrated database. Verify counts, notes, calendar and a full recovery from the remote backup.
5. Add the remaining apps one at a time, with independent volumes and resource limits.
6. Retain the golden archive on a separate device/storage account, outside normal expiration rules.

No hosting account, paid service, domain or public deployment has been created. The main decision is whether the lower shared-server cost is worth responsibility for operating-system updates and monitoring. If you prefer very little server administration, compare a managed plan across the complete app inventory first.
