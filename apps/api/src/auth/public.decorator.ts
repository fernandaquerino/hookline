import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'hookline:isPublic';

/** Marks a controller or route as reachable without an admin session. */
export const Public = (): ClassDecorator & MethodDecorator => SetMetadata(IS_PUBLIC, true);
