import 'dotenv/config';
import * as fs from 'fs';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../src/app.module';

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false });
  const config = new DocumentBuilder()
    .setTitle('Sefay API')
    .setDescription('Sefay POS/ERP API')
    .setVersion('1.0')
    .addBearerAuth()
    .addServer('https://sefay-api-production.up.railway.app')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  fs.writeFileSync('openapi.json', JSON.stringify(document, null, 2));
  console.log('Wrote openapi.json');
  await app.close();
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
