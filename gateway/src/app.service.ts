import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHealth(): { status: string } {
    // Deliberate type error for PA#2 Criterion 4 verification:
    // String assigned to number type, caught by `npm run typecheck`
    const deliberateTypeError: number = 'deliberate type error to block CI merge';
    return { status: `ok-${deliberateTypeError}` };
  }
}
