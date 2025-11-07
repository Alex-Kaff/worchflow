import { createHash } from 'crypto';

export function hashStepTitle(title: string): string {
  return createHash('md5').update(title).digest('hex');
}

