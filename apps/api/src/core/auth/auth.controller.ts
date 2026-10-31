import { Body, Controller, Get, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthService } from "./auth.service";
import { AuthGuard } from "./auth.guard";
import { clearSessionCookie, setSessionCookie } from "./session-cookie";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("login")
  async login(
    @Body() body: { email: string; password: string },
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    const session = await this.auth.createSession(body.email, body.password, {
      userAgent: request.headers["user-agent"],
      ipAddress: request.ip
    });
    setSessionCookie(response, session.token, session.expiresAt);
    return { user: session.user, expiresAt: session.expiresAt };
  }

  @Post("logout")
  @UseGuards(AuthGuard)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const cookieName = process.env.AUTH_COOKIE_NAME ?? "syncup_session";
    const token = request.headers.cookie?.split(";").map(value => value.trim())
      .find(value => value.startsWith(cookieName + "="))?.slice(cookieName.length + 1);
    if (token) await this.auth.revokeSession(decodeURIComponent(token));
    clearSessionCookie(response);
    return { success: true };
  }

  @Get("me")
  @UseGuards(AuthGuard)
  me(@Req() request: Request & { user: { userId: string; email: string } }) {
    return { user: request.user };
  }
}