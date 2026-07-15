import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

/**
 * Injects the authenticated user (or one of its properties) into a handler:
 *
 *   getMe(@CurrentUser() user: AuthenticatedUser)
 *   getMyId(@CurrentUser('id') userId: string)
 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;

    return data ? user?.[data] : user;
  },
);
