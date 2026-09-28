# Database backups

Taken with `pg_dump` before the schema changes in `CLEANUP_PLAN.md`, because this project
has no git repository and a dropped column cannot be reverted.

| File | Taken before |
|---|---|
| `platform_db_before_mongo_cleanup_20260909_184941.sql` | any of the cleanup work |
| `platform_db_before_dropping_legacy_ids_20260909_213637.sql` | dropping `legacy_mongo_id` from 28 tables |

Restore:

```bash
docker exec -i postgres-stable-18.6 psql -U postgres -d platform_db < <file>
```

Both were taken with `--clean --if-exists`, so a restore drops what is there first. Restoring
the older one puts the database back to a shape the current code no longer matches — the code
expects `legacy_mongo_id` to be gone. Use the newer one unless you are deliberately going back
past Phase F.
