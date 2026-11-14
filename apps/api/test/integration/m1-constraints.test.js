import { beforeAll, describe, expect, it } from 'vitest'
import { migrate, withClient, expectDbError } from '../helpers/db.js'
import { newPublicId } from '../../src/lib/ids.js'

beforeAll(async () => { await migrate('up') })

async function rollback(fn, role = 'TEST_MIGRATOR_DATABASE_URL') {
  return withClient(role, async (client) => {
    await client.query('begin')
    try { return await fn(client) } finally { await client.query('rollback') }
  })
}

async function rejected(client, sql, values = []) {
  await client.query('savepoint invalid_case')
  const error = await expectDbError(client.query(sql, values))
  await client.query('rollback to savepoint invalid_case')
  return error
}

async function profile(client) {
  const city = (await client.query(`insert into cities (public_id,name_ru,name_ky) values ($1,'test','test') returning id`, [newPublicId('city')])).rows[0].id
  const user = (await client.query(`insert into users (public_id,email,password_hash) values ($1,$2,'fixture-not-auth') returning id`, [newPublicId('usr'), `${newPublicId('usr')}@example.test`])).rows[0].id
  await client.query(`insert into driver_profiles (user_id,city_id,full_name) values ($1,$2,'Synthetic fixture')`, [user, city])
  return { city, user }
}

describe('M1 database constraints (requires separately authorised test DB)', () => {
  it('derives status/is_active and rejects independent writes', async () => {
    await rollback(async (c) => {
      const { user } = await profile(c)
      expect((await c.query('select status,is_active from driver_profiles where user_id=$1', [user])).rows[0]).toEqual({ status: 'pending', is_active: false })
      for (const status of ['active','suspended','pending']) {
        await c.query('update driver_profiles set status=$1 where user_id=$2', [status,user])
        expect((await c.query('select is_active from driver_profiles where user_id=$1', [user])).rows[0].is_active).toBe(status==='active')
      }
      expect((await rejected(c,'update driver_profiles set is_active=true where user_id=$1',[user])).code).toBe('23514')
      expect((await rejected(c,"update driver_profiles set status='unknown' where user_id=$1",[user])).code).toBe('23514')
      expect((await rejected(c,'update driver_profiles set status=null where user_id=$1',[user])).code).toBe('23502')
      await c.query('delete from driver_profiles where user_id=$1',[user])
      await c.query(`insert into driver_profiles(user_id,city_id,full_name,status,is_active) select $1,id,'Synthetic fixture','active',false from cities limit 1`,[user])
      expect((await c.query('select is_active from driver_profiles where user_id=$1',[user])).rows[0].is_active).toBe(true)
    })
  })

  it('accepts assigned country codes, NULL and valid polygon; rejects invalid countries and shapes', async () => {
    await rollback(async (c) => {
      const { city }=await profile(c)
      for (const code of ['KG','US','TW',null]) await c.query('update cities set country_code=$1 where id=$2',[code,city])
      for (const code of ['ZZ','UK','XK','kg','KGZ','']) expect((await rejected(c,'update cities set country_code=$1 where id=$2',[code,city])).code).toBe('23514')
      await c.query(`update cities set bounds=ST_GeomFromText('POLYGON((70 39,71 39,71 40,70 40,70 39))',4326) where id=$1`,[city])
      for (const [wkt,srid] of [
        ['POLYGON EMPTY',4326], ['POLYGON((0 0,1 1,0 1,1 0,0 0))',4326],
        ['POLYGON((180 0,181 0,181 1,180 1,180 0))',4326],
        ['POLYGON((0 90,1 90,1 91,0 91,0 90))',4326],
        ['POLYGON Z((0 0 1,1 0 1,1 1 1,0 0 1))',4326],
        ['POINT(0 0)',4326], ['POLYGON((0 0,1 0,1 1,0 0))',3857],
      ]) expect(await rejected(c,'update cities set bounds=ST_GeomFromText($1,$2) where id=$3',[wkt,srid,city])).toBeInstanceOf(Error)
      await c.query('update cities set bounds=null where id=$1',[city])
    })
  })

  it('accepts only host IPs and approved results', async () => {
    await rollback(async (c) => {
      for (const ip of ['127.0.0.1','2001:db8::1',null]) {
        for (const result of ['success','failure','denied',null]) await c.query('insert into audit_logs(action,ip,result) values ($1,$2,$3)',['test.m1.ip',ip,result])
      }
      for (const ip of ['192.0.2.1/24','2001:db8::1/64']) expect((await rejected(c,"insert into audit_logs(action,ip) values ('test.m1.invalid',$1)",[ip])).code).toBe('23514')
      expect((await rejected(c,"insert into audit_logs(action,result) values ('test.m1.invalid','unknown')")).code).toBe('23514')
    },'TEST_DATABASE_URL')
  })

  it('enforces the empty snapshot allowlist and distinct audit semantics for application inserts', async () => {
    await rollback(async (c) => {
      const row=(await c.query(`insert into audit_logs(action,before_data,after_data,request_id,correlation_id,occurred_at,created_at)
        values ('test.m1.audit','{}',null,'request-fixture','correlation-fixture','2000-01-01','1900-01-01')
        returning created_at > '2020-01-01'::timestamptz as server_time,request_id <> correlation_id as distinct_ids,occurred_at < created_at as distinct_times`)).rows[0]
      expect(row).toEqual({server_time:true,distinct_ids:true,distinct_times:true})
      for (const column of ['before_data','after_data']) {
        for (const value of ['[]','null','1','"scalar"','{"password":"synthetic"}','{"nested":{}}']) {
          expect((await rejected(c,`insert into audit_logs(action,${column}) values ('test.m1.invalid',$1::jsonb)`,[value])).code).toBe('23514')
        }
      }
    },'TEST_DATABASE_URL')
  })
})
