import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApplication } from './configure-app';

function loadLocalEnv(): void {
  for (const envPath of ['.env', 'gateway/.env']) {
    if (existsSync(envPath) && typeof process.loadEnvFile === 'function') {
      process.loadEnvFile(envPath);
      break;
    }
  }
}

async function bootstrap() {
  loadLocalEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  configureApplication(app);
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
