/**
 * Gerçek sunucu — hesabı silme (v3.2a). delete_my_account RPC'si
 * uygulamanın deleteMyAccount fonksiyonuyla; sonuç service role ile
 * sunucudaki gerçek durumdan okunuyor.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { deleteMyAccount } from '@/lib/account';
import { runSync } from '@/lib/sync/engine';
import { supabaseTransport } from '@/lib/sync/supabaseTransport';
import { closePhones, newRoutine, phone, workout } from '../helpers/syncPhones';

import {
  admin,
  createUser,
  deleteCreatedUsers,
  serverRowCounts,
  signedIn,
  stopAppClients,
  type AppClient,
  type TestUser,
} from './support';

let x: TestUser;
let y: TestUser;
let sole: TestUser;
let appX: AppClient;
let appY: AppClient;
let appSole: AppClient;
let gymId: string;

/** Hesabın buluta antrenman ve rutin göndermesi (uygulamanın motoruyla) */
async function pushSomeData(u: TestUser, app: AppClient) {
  const p = await phone();
  const r = await newRoutine(p.db);
  await workout(p.db, r);
  const res = await runSync({ db: p.db, transport: supabaseTransport(app.client), userId: u.id });
  expect(res).toMatchObject({ status: 'ok' });
}

beforeAll(async () => {
  x = await createUser('silX');
  y = await createUser('silY');
  sole = await createUser('silTek');
  const { data, error } = await admin
    .from('gyms')
    .insert({ name: 'INT Tek yöneticili', join_code: 'INTSOLE1' })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  gymId = data.id as string;
  await admin.from('gym_members').insert([
    { gym_id: gymId, user_id: sole.id, role: 'admin' },
    { gym_id: gymId, user_id: x.id, role: 'member' },
  ]);
  appX = await signedIn(x);
  appY = await signedIn(y);
  appSole = await signedIn(sole);
  await pushSomeData(x, appX);
  await pushSomeData(y, appY);
});

afterAll(async () => {
  closePhones();
  await stopAppClients();
  await deleteCreatedUsers();
  await admin.from('gyms').delete().eq('id', gymId);
});

describe('Hesabı silme (gerçek sunucu)', () => {
  it('tek yönetici engelleniyor; hiçbir şey silinmiyor', async () => {
    const before = await serverRowCounts(sole.id);
    expect(await deleteMyAccount(appSole.client)).toMatchObject({ ok: false, error: { kind: 'sole_admin' } });
    expect(await serverRowCounts(sole.id)).toEqual(before);
    expect((await admin.auth.admin.getUserById(sole.id)).data.user).not.toBeNull();
    expect((await appSole.client.auth.getSession()).data.session).not.toBeNull();
  });

  it('yalnızca kendi hesabını siliyor; başka kullanıcının verisi duruyor', async () => {
    const xBefore = await serverRowCounts(x.id);
    const yBefore = await serverRowCounts(y.id);
    expect(xBefore.sets).toBeGreaterThan(0);
    expect(xBefore.gym_members).toBe(1);

    expect(await deleteMyAccount(appX.client)).toEqual({ ok: true, value: null });

    expect(await serverRowCounts(y.id)).toEqual(yBefore);
    expect((await admin.auth.admin.getUserById(y.id)).data.user).not.toBeNull();
    // Salon ve yöneticisi duruyor
    const members = await admin.from('gym_members').select('user_id').eq('gym_id', gymId);
    expect(members.data?.map((m) => m.user_id)).toEqual([sole.id]);
  });

  it('silinen kullanıcının sunucuda hiçbir satırı kalmıyor', async () => {
    const counts = await serverRowCounts(x.id);
    expect(counts).toEqual(Object.fromEntries(Object.keys(counts).map((k) => [k, 0])));
    expect((await admin.auth.admin.getUserById(x.id)).data.user).toBeNull();
  });
});
