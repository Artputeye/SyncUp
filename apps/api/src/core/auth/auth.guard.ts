import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { AuthService } from "./auth.service";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const method = String(request.method ?? "GET").toUpperCase();
    const expectedOrigin = process.env.WEB_ORIGIN;
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && expectedOrigin && request.headers?.origin !== expectedOrigin) {
      throw new UnauthorizedException("Invalid request origin");
    }
    const cookieHeader = request.headers?.cookie ?? "";
    const cookieName = process.env.AUTH_COOKIE_NAME ?? "syncup_session";
    const token = cookieHeader.split(";").map((part: string) => part.trim())
      .find((part: string) => part.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1);
    if (!token) throw new UnauthorizedException("Authentication required");
    try {
      request.user = await this.auth.resolveSession(decodeURIComponent(token));
      return true;
    } catch {
      throw new UnauthorizedException("Session is invalid or expired");
    }
  }
}