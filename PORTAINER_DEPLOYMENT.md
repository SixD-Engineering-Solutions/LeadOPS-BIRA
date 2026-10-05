# Deploy LeadOps with the existing Aiven database

Use `docker-compose.portainer.yml` in Portainer's **Stacks > Add stack > Web editor**.
This file targets Docker Standalone and expects built images on the destination
Docker host or in an accessible registry. The original `docker-compose.yml`
remains the source-build configuration.

The API keeps using the current Aiven database and its CA certificate. Uploaded
documents use the destination host's disk-backed `leadops-uploads` Docker volume.
An S3/MinIO bucket cannot replace this filesystem volume with the current app.

## 1. Make the images available on the destination

Build from the current repository on a Docker host matching the destination's
Linux CPU architecture. These commands do not start the app or touch Aiven:

```sh
docker build -t leadops-api:2026-09-30 ./Server
docker build --build-arg VITE_API_URL=/api -t leadops-web:2026-09-30 ./Client
```

**On Windows Git Bash**, prefix the web build with `MSYS_NO_PATHCONV=1` (or run it
from PowerShell/cmd). Git Bash otherwise rewrites `/api` to
`C:/Program Files/Git/api`, and the built site can't reach the API. Check with:
`docker run --rm --entrypoint sh leadops-web:<tag> -c 'grep -c "Program Files" /usr/share/nginx/html/assets/index-*.js'`
— it must print `0`.

If built directly on the destination Docker host, the images are ready for
Portainer. Images built on a PC are not automatically available on that server.
To transfer them without publishing to a registry:

```sh
docker image save --output leadops-images.tar leadops-api:2026-09-30 leadops-web:2026-09-30
```

Save the archive outside the repository, transfer it to the destination server,
then load it there:

```sh
docker image load --input leadops-images.tar
```

For this local-image route, set `IMAGE_PULL_POLICY=never` and use the two image
names above. For registry images, set their full repository/tag names, use
`IMAGE_PULL_POLICY=missing`, and configure private registry access in Portainer.
Use a new release tag for later builds so the deployed version is unambiguous.

## 2. Configure the stack

Name the stack `leadops` and paste `docker-compose.portainer.yml` into the editor.
Add these values in Portainer's environment-variable section. You can load
`Server/.env` into Portainer, but review its values for production. Do not paste
secrets into the YAML, commit them, or publish an environment file.

| Variable | Value |
| --- | --- |
| `LEADOPS_API_IMAGE` | Available API image, e.g. `leadops-api:2026-09-30` |
| `LEADOPS_WEB_IMAGE` | Available web image, e.g. `leadops-web:2026-09-30` |
| `IMAGE_PULL_POLICY` | `never` for images loaded on the server; `missing` for registry images |
| `DATABASE_URL` | The existing Aiven connection string, unchanged |
| `JWT_SECRET` | A strong production secret of at least 32 characters |
| `FRONTEND_URL` | Exact public app origin, e.g. `https://crm.example.com`, without a trailing slash |
| `WEB_PORT` | `8080`, or another free server port |
| `DB_POOL_MAX` | `5` initially; account for all other processes using Aiven's connection limit |
| `UPLOADS_VOLUME_NAME` | `leadops-uploads`, or the exact existing destination volume name |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `FROM_EMAIL` | Working SMTP settings for password-reset codes |
| `JWT_EXPIRES_IN` | How long a sign-in lasts. Default `24h`; remove any old `7d` value |
| `MS_CLIENT_ID`, `MS_TENANT_ID` | "Sign in with Microsoft": the Application (client) ID and Directory (tenant) ID from the Azure app registration. Leave empty for password-only login. When set, Microsoft is the only way to sign in. |
| `MS_ALLOWED_TENANT_IDS` | Only when people from more than one Microsoft organisation sign in (e.g. `@sixdengineering.com` and `@sixdx.ai`): every allowed Directory (tenant) ID, comma-separated, including `MS_TENANT_ID`. The Azure app must then accept "Accounts in any organizational directory", and an admin of each other organisation must approve the app once. Empty = only `MS_TENANT_ID`. |
| `ADMIN_PASSWORD_LOGIN` | `false`. Emergency switch: `true` brings back password sign-in for admins only, if Microsoft sign-in breaks. Restart the API after changing it. |

Retaining a production JWT secret preserves existing tokens; changing it requires
users to sign in again. Do not reuse a weak development secret.

If Aiven has an IP allowlist, add the destination server's outbound public IP.
The host must be able to reach the database and SMTP endpoints. Configure the
HTTPS reverse proxy for the chosen public app URL to forward to `WEB_PORT`.

## 3. Preserve files and check migrations before accepting traffic

Database records already live in Aiven, so there is no database export or restore.
Uploaded file contents are separate: copy them from the existing API host's
upload directory to the destination volume's `documents/` directory, keeping
their stored filenames. If `UPLOAD_DIR` was overridden on the source, use that
location. Ensure the destination API's `node` user can read and write the files.
Coordinate the final file copy with a pause in uploads on the old app.

Run `npx prisma migrate status` using the API image and the Aiven environment
before serving users. Review any pending migrations before applying them once
with `npx prisma migrate deploy`; the stack does not apply migrations automatically.
Do not run the demo seed, reset the database, or create a new empty database.

Keep the new site inaccessible to users until these steps are complete. Stop
the old API at cutover: multiple API processes sharing the database can run the
same reminder jobs and split live notifications.

## 4. Deploy and verify

Once images, configuration, file storage, and database compatibility are ready,
click **Deploy the stack**. Check both container logs for startup errors.

- Verify login and that existing leads, proposals, invoices, and totals load.
- Download an existing document, then test an upload and download.
- Test "Sign in with Microsoft" (and, while `ADMIN_PASSWORD_LOGIN=true`, an admin password reset email) and live notifications.
- Restart the API and confirm uploaded files remain available.
- Test through the actual HTTPS URL, including its `/api` proxy.

The current `/health` endpoint checks that Express responds; it does not check
Aiven connectivity. A green container alone does not establish a working app.

Back up the uploads volume separately from Aiven. Do not delete it when removing
or redeploying a stack. Object storage can hold backups; the running app still
uses the disk-backed volume.

Prepared locally only: destination server access, image transfer, deployment,
and live verification must be completed against the actual target environment.
