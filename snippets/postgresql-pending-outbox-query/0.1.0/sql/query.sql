select specimen.specimen_id,
       coalesce(outbox.pending_count, 0::bigint) as pending_outbox_count
  from sample.specimen
  left join lateral (
      select pg_catalog.count(*) as pending_count
        from sample.transactional_outbox as pending
       where pending.tenant_id = specimen.tenant_id
         and pending.aggregate_id = specimen.specimen_id
         and pending.delivery_state <> 'delivered'
  ) as outbox on true
 where specimen.tenant_id = %s
 order by specimen.specimen_id;
