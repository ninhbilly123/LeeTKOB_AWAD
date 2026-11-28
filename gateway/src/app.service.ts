import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import { problemException } from './common/http-problems';
import { PostgresPersistence } from './persistence/postgres.store';

export interface HealthResponse {
  status: 'ok';
  persistence: 'postgres' | 'memory';
}

@Injectable()
export class AppService {
  constructor(@Optional() private readonly postgres?: PostgresPersistence) {}

  async getHealth(): Promise<HealthResponse> {
    if (this.postgres?.isEnabled()) {
      const ok = await this.postgres.checkHealth();
      if (!ok) {
        throw problemException(
          HttpStatus.SERVICE_UNAVAILABLE,
          'Database connectivity check failed.',
          'service-unavailable',
        );
      }
      return { status: 'ok', persistence: 'postgres' };
    }
    return { status: 'ok', persistence: 'memory' };
  }
}
