import { createProxyMiddleware, createApp, createAppWithPath } from './test-kit';
import { ErrorRequestHandler } from 'express';
import * as request from 'supertest';
import { getLocal, generateCACertificate, Mockttp } from 'mockttp';

const untrustedCACert = generateCACertificate({ bits: 1024 });

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

describe('E2E router', () => {
  let targetServerA: Mockttp;
  let targetServerB: Mockttp;
  let targetServerC: Mockttp;

  beforeEach(async () => {
    targetServerA = getLocal({ https: await untrustedCACert });
    targetServerB = getLocal({ https: await untrustedCACert });
    targetServerC = getLocal({ https: await untrustedCACert });

    await targetServerA
      .anyRequest()
      .thenPassThrough({ ignoreHostCertificateErrors: ['localhost'] });
    await targetServerB
      .anyRequest()
      .thenPassThrough({ ignoreHostCertificateErrors: ['localhost'] });
    await targetServerC
      .anyRequest()
      .thenPassThrough({ ignoreHostCertificateErrors: ['localhost'] });

    await targetServerA
      .anyRequest()
      .thenCallback(({ protocol }) => ({ body: protocol === 'https' ? 'A' : 'NOT HTTPS A' }));
    await targetServerB
      .anyRequest()
      .thenCallback(({ protocol }) => ({ body: protocol === 'https' ? 'B' : 'NOT HTTPS B' }));
    await targetServerC
      .anyRequest()
      .thenCallback(({ protocol }) => ({ body: protocol === 'https' ? 'C' : 'NOT HTTPS C' }));

    await targetServerA.start(6001);
    await targetServerB.start(6002);
    await targetServerC.start(6003);
  });

  afterEach(async () => {
    await targetServerA.stop();
    await targetServerB.stop();
    await targetServerC.stop();
  });

  describe('router with req', () => {
    it('should work with a string', async () => {
      const app = createApp(
        createProxyMiddleware({
          target: 'https://localhost:6001',
          secure: false,
          changeOrigin: true,
          router(req) {
            return 'https://localhost:6003';
          },
        })
      );

      const agent = request(app);
      const response = await agent.get('/api').expect(200);
      expect(response.text).toBe('C');
    });

    it('should work with an object', async () => {
      const app = createApp(
        createProxyMiddleware({
          target: 'https://localhost:6001',
          secure: false,
          changeOrigin: true,
          router(req) {
            return { host: 'localhost', port: 6003, protocol: 'https:' };
          },
        })
      );
      const agent = request(app);
      const response = await agent.get('/api').expect(200);
      expect(response.text).toBe('C');
    });

    it('should work with an async callback', async () => {
      const app = createApp(
        createProxyMiddleware({
          target: 'https://localhost:6001',
          secure: false,
          changeOrigin: true,
          router: async (req) => {
            return new Promise((resolve) =>
              resolve({ host: 'localhost', port: 6003, protocol: 'https:' })
            );
          },
        })
      );

      const agent = request(app);
      const response = await agent.get('/api').expect(200);
      expect(response.text).toBe('C');
    });

    it('should handle promise rejection in router', async () => {
      const app = createApp(
        createProxyMiddleware({
          target: 'https://localhost:6001',
          secure: false,
          changeOrigin: true,
          router: async (req) => {
            throw new Error('An error thrown in the router');
          },
        })
      );
      const errorHandler: ErrorRequestHandler = (err: Error, req, res, next) => {
        res.status(502).send(err.message);
      };
      app.use(errorHandler);

      const agent = request(app);
      const response = await agent.get('/api').expect(502);
      expect(response.text).toBe('An error thrown in the router');
    });

    it('missing a : will cause it to use http', async () => {
      const app = createApp(
        createProxyMiddleware({
          target: 'https://localhost:6001',
          secure: false,
          changeOrigin: true,
          router: async (req) => {
            return new Promise((resolve) =>
              resolve({ host: 'localhost', port: 6003, protocol: 'https' })
            );
          },
        })
      );

      const agent = request(app);
      const response = await agent.get('/api').expect(200);
      expect(response.text).toBe('NOT HTTPS C');
    });
  });

  describe('router with proxyTable', () => {
    let agent;

    beforeEach(() => {
      const app = createAppWithPath(
        '/',
        createProxyMiddleware({
          target: 'https://localhost:6001',
          secure: false,
          changeOrigin: true,
          router: {
            'alpha.localhost:6000': 'https://localhost:6001',
            'beta.localhost:6000': 'https://localhost:6002',
            'localhost:6000/api': 'https://localhost:6003',
          },
        })
      );

      agent = request(app);
    });

    it('should proxy to option.target', async () => {
      const response = await agent.get('/api').expect(200);

      expect(response.text).toBe('A');
    });

    it('should proxy when host is "alpha.localhost"', async () => {
      const response = await agent.get('/api').set('host', 'alpha.localhost:6000').expect(200);

      expect(response.text).toBe('A');
    });

    it('should proxy when host is "beta.localhost"', async () => {
      const response = await agent.get('/api').set('host', 'beta.localhost:6000').expect(200);

      expect(response.text).toBe('B');
    });

    it('should proxy with host & path config: "localhost:6000/api"', async () => {
      const response = await agent.get('/api').set('host', 'localhost:6000').expect(200);

      expect(response.text).toBe('C');
    });
  });
});
