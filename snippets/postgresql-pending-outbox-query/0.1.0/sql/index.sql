-- The fixed predicate agrees with the query's meaning of pending.
create index transactional_outbox_pending_specimen_idx
    on sample.transactional_outbox (tenant_id, aggregate_id)
    where delivery_state <> 'delivered';
