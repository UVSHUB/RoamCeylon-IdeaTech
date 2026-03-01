import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

interface RequestWithUser {
  user?: { userId?: string };
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
}

@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: RequestWithUser): Promise<string> {
    // Attempt to track by isolated userId first, fallback to IP
    if (req.user?.userId) {
      return Promise.resolve(`user_ttl_${req.user.userId}`);
    }

    // Fallback to fastify/express default IP derivation
    const forwardedFor = req.headers?.['x-forwarded-for'];
    const tracker = req.ip || forwardedFor || 'mock-ip';
    return Promise.resolve(`ip_ttl_${String(tracker)}`);
  }
}
