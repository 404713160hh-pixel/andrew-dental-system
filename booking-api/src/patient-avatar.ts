import { z } from 'zod';
import type { PatientAvatar } from '@andrew/shared';
import { requireThat } from './errors.js';

const maxBytes = 90 * 1024;
const pngHeader = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const pngEnd = Buffer.from('0000000049454e44ae426082', 'hex');
const inputSchema = z.object({
  base64: z.string().min(24).max(maxBytes * 4 / 3).regex(/^[A-Za-z0-9+/]+={0,2}$/).nullable(),
}).strict();

export function parsePatientAvatar(input: unknown) {
  const { base64 } = inputSchema.parse(input);
  if (base64 === null) return null;
  const bytes = Buffer.from(base64, 'base64');
  requireThat(bytes.length >= 16 && bytes.length <= maxBytes && bytes.toString('base64') === base64,
    400, 'INVALID_AVATAR', '请选择有效的头像图片');

  let mimeType: PatientAvatar['mimeType'] | undefined;
  if (bytes.subarray(0, pngHeader.length).equals(pngHeader) && bytes.subarray(-pngEnd.length).equals(pngEnd)) {
    mimeType = 'image/png';
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff &&
    bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) {
    mimeType = 'image/jpeg';
  }
  requireThat(mimeType, 400, 'INVALID_AVATAR', '头像仅支持 JPEG 或 PNG');
  return { bytes, mimeType };
}
