# PostgreSQL

The local PostgreSQL 18 instance is defined in [`docker-compose.yml`](../../docker-compose.yml) at the repository root.

- Image: `postgres:18.6-trixie`, initialised with UTF-8 and ICU root collation (`und`) for Sinhala, Tamil and English text.
- Data: the `postgres-data` named volume, mounted at `/var/lib/postgresql` as PostgreSQL 18+ images require.
- Access: published on `127.0.0.1:${POSTGRES_PORT}` (default `5432`). Credentials come from `.env`.

This folder will hold database-level infrastructure, such as init scripts or operational tuning. The schema and its migrations belong to the backend API: see `apps/api/prisma/` and [docs/architecture/database.md](../../docs/architecture/database.md).

To reset local data completely:

```sh
docker compose down --volumes
```
