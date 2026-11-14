import { expect, it } from 'vitest'
import { runner } from 'node-pg-migrate'
import { runTestMigrations } from '../../scripts/test-migrations.js'
import { withClient, migrate } from '../helpers/db.js'
import { newPublicId } from '../../src/lib/ids.js'

// Deliberately excluded from the normal suite. This is a one-way upgrade drill,
// not a reset script: no DROP, deletion of registry entries or disabled triggers.
// All migration calls still pass through the unchanged HIGH preflight/identity guard.
const nextMigration = () => runTestMigrations(['up'], process.env, {
  runner: (options) => runner({ ...options, count: 1 }),
})
const auditAdded = ['ip','user_agent','result','before_data','after_data','correlation_id','created_at']

async function snapshot(client, table, omitted = []) {
  const { rows } = await client.query(`select to_jsonb(t) - $1::text[] as data from ${table} t`, [omitted])
  return rows.map((r) => r.data).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
}

async function registry(client) {
  return (await client.query('select name from pgmigrations order by name')).rows.map((r) => r.name)
}

async function protections(client) {
  return (await client.query(`select
    has_table_privilege('busway_app','users','SELECT') as users_read,
    has_table_privilege('busway_app','users','DELETE') as users_delete,
    has_table_privilege('busway_app','audit_logs','INSERT') as audit_insert,
    has_table_privilege('busway_app','audit_logs','UPDATE') as audit_update,
    has_table_privilege('busway_app','audit_logs','DELETE') as audit_delete,
    has_table_privilege('busway_app','audit_logs','TRUNCATE') as audit_truncate,
    has_schema_privilege('busway_app','public','CREATE') as app_ddl`)).rows[0]
}

async function refuseDown(version) {
  const before = await withClient('TEST_MIGRATOR_DATABASE_URL', async (c) => ({
    registry: await registry(c), users: await snapshot(c,'users'),
    profiles: await snapshot(c,'driver_profiles'), audit: await snapshot(c,'audit_logs'),
  }))
  expect(before.registry.at(-1)).toMatch(new RegExp(`^${version}_`))
  await expect(migrate('down')).rejects.toMatchObject({ code:'0A000' })
  const after = await withClient('TEST_MIGRATOR_DATABASE_URL', async (c) => ({
    registry: await registry(c), users: await snapshot(c,'users'),
    profiles: await snapshot(c,'driver_profiles'), audit: await snapshot(c,'audit_logs'),
  }))
  expect(after).toEqual(before)
}

it('preserves baseline data across 0002/0003 and refuses each forward-only rollback', async () => {
  // Every precondition is checked before creating any synthetic record.
  await withClient('TEST_MIGRATOR_DATABASE_URL', async (c) => {
    expect(await registry(c)).toEqual(['0001_extensions_core'])
    const tables = (await c.query(`select tablename from pg_tables where schemaname='public' order by tablename`)).rows.map((r) => r.tablename)
    expect(tables).toEqual(['audit_logs','cities','driver_profiles','pgmigrations','sessions','spatial_ref_sys','user_roles','users'])
    for (const table of ['cities','users','user_roles','driver_profiles','sessions']) {
      expect((await c.query(`select count(*)::int as n from ${table}`)).rows[0].n).toBe(0)
    }
    expect((await c.query(`select count(*)::int as n from audit_logs where action not like 'test.%' or actor_user_id is not null`)).rows[0].n).toBe(0)
  })

  const userIds = []
  let cityId
  await withClient('TEST_MIGRATOR_DATABASE_URL', async (c) => {
    await c.query('begin')
    try {
      cityId = (await c.query(`insert into cities(public_id,name_ru,name_ky) values ($1,'Synthetic upgrade','Synthetic upgrade') returning id`, [newPublicId('city')])).rows[0].id
      for (const active of [true,false]) {
        const id = (await c.query(`insert into users(public_id,email,password_hash) values ($1,$2,'fixture-not-auth') returning id`, [newPublicId('usr'),`${newPublicId('usr')}@example.test`])).rows[0].id
        userIds.push(id)
        await c.query(`insert into driver_profiles(user_id,city_id,full_name,is_active) values ($1,$2,'Synthetic legacy profile',$3)`,[id,cityId,active])
        await c.query(`insert into user_roles(user_id,role) values ($1,'driver')`,[id])
      }
      await c.query(`insert into audit_logs(action,details,request_id,occurred_at) values ('test.upgrade.legacy','{"fixture":true}','request-fixture','2000-01-01')`)
      await c.query('commit')
    } catch (error) { await c.query('rollback'); throw error }
  })

  await nextMigration() // 0002 only, on the same verified test connection.
  expect(await withClient('TEST_MIGRATOR_DATABASE_URL', registry)).toEqual(['0001_extensions_core','0002_add_documented_text_fields'])
  await refuseDown('0002')
  await withClient('TEST_MIGRATOR_DATABASE_URL', async (c) => {
    await c.query(`update cities set country_code='KG' where id=$1`,[cityId])
    await c.query(`update driver_profiles set internal_number='fixture-001',phone='fixture-phone',admin_note='fixture-note' where user_id=$1`,[userIds[0]])
    await c.query(`update users set display_name='Synthetic display' where id=$1`,[userIds[0]])
  })
  const before = await withClient('TEST_MIGRATOR_DATABASE_URL', async (c) => ({
    users:await snapshot(c,'users'), profiles:await snapshot(c,'driver_profiles'),
    cities:await snapshot(c,'cities'), audit:await snapshot(c,'audit_logs'),
    roles:await snapshot(c,'user_roles'), sessions:await snapshot(c,'sessions'), rights:await protections(c),
    fks:(await c.query(`select conname,pg_get_constraintdef(oid) as definition from pg_constraint where contype='f' and connamespace='public'::regnamespace order by conname`)).rows,
  }))

  await nextMigration() // 0003 only.
  await withClient('TEST_MIGRATOR_DATABASE_URL', async (c) => {
    expect(await registry(c)).toEqual(['0001_extensions_core','0002_add_documented_text_fields','0003_complete_m1_schema'])
    expect(await snapshot(c,'users')).toEqual(before.users)
    const expectedProfiles=before.profiles.map((p)=>({...p,is_active:false}))
      .sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))
    expect(await snapshot(c,'driver_profiles',['status'])).toEqual(expectedProfiles)
    expect((await c.query('select status,is_active from driver_profiles')).rows).toEqual([
      {status:'pending',is_active:false},{status:'pending',is_active:false},
    ])
    expect(await snapshot(c,'cities',['bounds'])).toEqual(before.cities)
    expect(await snapshot(c,'audit_logs',auditAdded)).toEqual(before.audit)
    for (const column of auditAdded) expect((await c.query(`select count(*)::int as n from audit_logs where ${column} is not null`)).rows[0].n).toBe(0)
    expect(await snapshot(c,'user_roles')).toEqual(before.roles)
    expect(await snapshot(c,'sessions')).toEqual(before.sessions)
    expect(await protections(c)).toEqual(before.rights)
    expect(before.rights).toEqual({users_read:true,users_delete:false,audit_insert:true,audit_update:false,audit_delete:false,audit_truncate:false,app_ddl:false})
    expect((await c.query(`select conname,pg_get_constraintdef(oid) as definition from pg_constraint where contype='f' and connamespace='public'::regnamespace order by conname`)).rows).toEqual(before.fks)
    const triggers=(await c.query(`select tgname,tgenabled from pg_trigger where tgrelid='audit_logs'::regclass and not tgisinternal order by tgname`)).rows
    for (const name of ['audit_logs_no_truncate','audit_logs_no_update_delete','audit_logs_record_created_at']) expect(triggers).toContainEqual({tgname:name,tgenabled:'O'})
  })

  await refuseDown('0003')
  const stable = await withClient('TEST_MIGRATOR_DATABASE_URL', async c => ({
    registry:await snapshot(c,'pgmigrations'), profiles:await snapshot(c,'driver_profiles'), audit:await snapshot(c,'audit_logs'),
  }))
  for (let i=0;i<2;i++) expect((await migrate('up')).output).toMatch(/no migrations to run/i)
  expect(await withClient('TEST_MIGRATOR_DATABASE_URL', async c => ({
    registry:await snapshot(c,'pgmigrations'), profiles:await snapshot(c,'driver_profiles'), audit:await snapshot(c,'audit_logs'),
  }))).toEqual(stable)
})
