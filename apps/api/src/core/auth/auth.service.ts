import { Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { compare } from "bcryptjs";
import { PrismaService } from "../../database/prisma.service";

@Injectable()
export class AuthService {
  constructor(private readonly db: PrismaService) {}

  async createSession(email: string, password: string, metadata?: { userAgent?: string; ipAddress?: string }) {
    const user = await this.db.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || user.status !== "ACTIVE" || !(await compare(password, user.passwordHash))) {
      throw new UnauthorizedException("Invalid email or password");
    }
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
    await this.db.session.create({ data: {
      userId: user.id, tokenHash, expiresAt,
      userAgent: metadata?.userAgent, ipAddress: metadata?.ipAddress
    }});
    return { token, expiresAt, user: { id: user.id, email: user.email, displayName: user.displayName } };
  }

  async resolveSession(token: string) {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const session = await this.db.session.findUnique({ where: { tokenHash }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== "ACTIVE") {
      throw new UnauthorizedException("Session is invalid or expired");
    }
    return { sessionId: session.id, userId: session.userId, email: session.user.email };
  }

  async revokeSession(token: string) {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await this.db.session.updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
