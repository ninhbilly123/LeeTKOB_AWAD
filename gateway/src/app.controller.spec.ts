import { HttpException, HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PostgresPersistence } from './persistence/postgres.store';

describe('AppController', () => {
  let controller: AppController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    controller = module.get<AppController>(AppController);
  });

  it('returns ok when running in memory mode', async () => {
    await expect(controller.getHealth()).resolves.toEqual({
      status: 'ok',
      persistence: 'memory',
    });
  });

  it('returns ok with postgres persistence when SELECT 1 succeeds', async () => {
    const mockPg = {
      isEnabled: () => true,
      checkHealth: jest.fn().mockResolvedValue(true),
    } as unknown as PostgresPersistence;
    const service = new AppService(mockPg);
    await expect(service.getHealth()).resolves.toEqual({
      status: 'ok',
      persistence: 'postgres',
    });
  });

  it('throws 503 Service Unavailable when PostgreSQL connectivity check fails', async () => {
    const mockPg = {
      isEnabled: () => true,
      checkHealth: jest.fn().mockResolvedValue(false),
    } as unknown as PostgresPersistence;
    const service = new AppService(mockPg);
    try {
      await service.getHealth();
      fail('Expected 503 HttpException');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    }
  });
});
