# Production boundary

The existing Harmony production Supabase project is READ-ONLY for this work.

Prohibited without explicit authorization:
- SQL writes or schema changes
- migrations
- Edge Function deployment or edits
- storage bucket or policy changes
- authentication or permission changes
- production environment/configuration changes

This starter contains no production credentials and no production endpoint configuration.

Development must use a separate project/environment and separate credentials. Any later integration must be reviewed and explicitly authorized.
