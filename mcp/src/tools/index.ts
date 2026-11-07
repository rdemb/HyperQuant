/** Lista narzędzi serwera MCP: każde z jednym celem, krótkim opisem dla modelu i kopertą jako wynikiem. */
import type * as z from 'zod';
import type { Envelope } from '../envelope';
import type { Sources } from '../sources';
import { dayMap } from './dayMap';
import { sessionContext, sessionReview } from './session';

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  /** Schemat argumentów; brak — narzędzie bez argumentów. */
  input?: z.ZodObject;
  run(src: Sources, args: unknown): Promise<Envelope<unknown>>;
}

export const TOOLS: ToolDef[] = [dayMap, sessionContext, sessionReview];
