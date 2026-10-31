import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
async function bootstrap() {
  process.loadEnvFile(".env");
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api");
  if (process.env.WEB_ORIGIN) {
    app.enableCors({ origin: process.env.WEB_ORIGIN, credentials: true, methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] });
  }
  app.enableShutdownHooks();
  await app.listen(Number(process.env.API_PORT ?? 4000));
}
void bootstrap();
