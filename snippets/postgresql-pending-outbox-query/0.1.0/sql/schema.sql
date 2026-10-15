-- Synthetic fixture ownership is separate from the SELECT-only query principal.
revoke create on schema public from public;
create role query_reader login nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create schema sample;
create table sample.tenant (
    tenant_id text primary key
);
create table sample.specimen (
    tenant_id text not null references sample.tenant (tenant_id),
    specimen_id text not null,
    primary key (tenant_id, specimen_id)
);
create table sample.transactional_outbox (
    tenant_id text not null references sample.tenant (tenant_id),
    message_id text not null,
    aggregate_id text not null,
    delivery_state text not null check (
        delivery_state in ('ready', 'leased', 'recovery_required', 'delivered')
    ),
    primary key (tenant_id, message_id)
);
-- The generic aggregate ID remains a soft association, as in the source outbox.
grant usage on schema sample to query_reader;
grant select on all tables in schema sample to query_reader;
