import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_PASSWORD, createTestApp, login, type TestApp } from './test-app';

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
});

afterAll(async () => {
  await t.app.close();
});

const http = () => request(t.app.getHttpServer());

describe('admin authentication', () => {
  it('rejects management routes without a session', async () => {
    for (const path of ['/api/endpoints', '/api/deliveries', '/api/auth/session']) {
      const res = await http().get(path);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    }
  });

  it('keeps ingest and health public', async () => {
    expect((await http().post('/in/unknown').send('x')).status).toBe(404);
    expect([200, 503]).toContain((await http().get('/health')).status);
  });

  it('rejects a wrong password', async () => {
    const res = await http().post('/api/auth/login').send({ password: 'nope' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('validates the login body', async () => {
    const res = await http().post('/api/auth/login').send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('sets an HttpOnly session cookie that grants access', async () => {
    const res = await http().post('/api/auth/login').send({ password: TEST_PASSWORD });
    expect(res.status).toBe(204);
    const cookie = res.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toMatch(/hookline_session=.+; Path=\/; HttpOnly; SameSite=Lax/);
    const session = await http()
      .get('/api/auth/session')
      .set('Cookie', cookie.split(';')[0] ?? '');
    expect(session.status).toBe(200);
    expect(session.body).toEqual({ authenticated: true });
  });

  it('rejects a forged cookie', async () => {
    const res = await http()
      .get('/api/endpoints')
      .set('Cookie', 'hookline_session=9999999999999.x.y');
    expect(res.status).toBe(401);
  });

  it('clears the cookie on logout', async () => {
    const res = await http()
      .post('/api/auth/logout')
      .set('Cookie', await login(t.app));
    expect(res.status).toBe(204);
    expect(res.headers['set-cookie']?.[0]).toMatch(/hookline_session=; .*Max-Age=0/);
  });
});

describe('login rate limiting', () => {
  it('returns 429 after too many attempts', async () => {
    const app = await createTestApp();
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) {
        statuses.push(
          (await request(app.app.getHttpServer()).post('/api/auth/login').send({ password: 'x' }))
            .status,
        );
      }
      expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
      expect(statuses.slice(10)).toEqual([429, 429]);
    } finally {
      await app.app.close();
    }
  });
});
