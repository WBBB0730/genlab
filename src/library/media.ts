/** 媒体文件识别：类型、扩展名与尺寸/时长。 */
import { fileTypeFromBuffer } from 'file-type'
import { imageSize } from 'image-size'
import { parseBuffer } from 'music-metadata'

import { CliError } from '../errors'

export type MediaKind = 'image' | 'video' | 'audio'

export const MEDIA_KINDS: MediaKind[] = ['image', 'video', 'audio']

export type MediaInfo = {
  mimeType: string
  extension: string
  kind: MediaKind
  width: number | null
  height: number | null
  duration: number | null
}

/** 识别不出的媒体类型。 */
export class UnsupportedMediaError extends CliError {}

/** 按内容识别不出时，按下载响应的 Content-Type 兜住常见格式。 */
const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
}

export function kindForMime(mimeType: string): MediaKind | null {
  const type = mimeType.split('/')[0]

  return type === 'image' || type === 'video' || type === 'audio' ? type : null
}

export async function inspectMedia(
  bytes: Uint8Array,
  contentType: string | null = null,
): Promise<MediaInfo> {
  const detected = await fileTypeFromBuffer(bytes)
  const headerMime = contentType?.split(';')[0]?.trim().toLowerCase() ?? ''
  const mimeType = detected?.mime ?? headerMime
  const extension = detected?.ext ?? MIME_EXTENSIONS[headerMime]
  const kind = kindForMime(mimeType)

  if (!extension || !kind) {
    throw new UnsupportedMediaError(`无法识别的媒体类型：${mimeType || '未知'}`)
  }

  return {
    mimeType,
    extension,
    kind,
    ...(await measure(bytes, kind, mimeType)),
  }
}

/** 尺寸与时长：解析失败不阻塞入库，按未知记录。 */
async function measure(
  bytes: Uint8Array,
  kind: MediaKind,
  mimeType: string,
): Promise<Pick<MediaInfo, 'width' | 'height' | 'duration'>> {
  const unknown = { width: null, height: null, duration: null }

  try {
    if (kind === 'image') {
      const size = imageSize(bytes)

      return { ...unknown, width: size.width, height: size.height }
    }

    const metadata = await parseBuffer(bytes, { mimeType }, { duration: true })
    const video = metadata.format.trackInfo.find((track) => track.video)?.video

    return {
      width: video?.pixelWidth ?? null,
      height: video?.pixelHeight ?? null,
      duration: metadata.format.duration ?? null,
    }
  } catch {
    return unknown
  }
}
