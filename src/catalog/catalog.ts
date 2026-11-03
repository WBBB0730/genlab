/** kie 模型目录：模型列表与产物类型（见 ADR-0005）。 */
import { CliError } from '../errors'
import { listKieModels } from '../kie/client'
import type { KieModel } from '../kie/client'
import type { MediaKind } from '../library/media'

import { cached } from './cache'

export type CatalogModel = KieModel & { kind: MediaKind }

/** 目录的任务类型 → 产物的素材类型；对话模型不产出媒体，不在其中。 */
const TASK_TYPE_KINDS: Record<string, MediaKind> = {
  'Text to Image': 'image',
  'Image to Image': 'image',
  'Image Editing': 'image',
  'Text to Video': 'video',
  'Image to Video': 'video',
  'Video to Video': 'video',
  'Video Editing': 'video',
  'Lip Sync': 'video',
  'Speech to Video': 'video',
  'Text to Speech': 'audio',
  'Text to Music': 'audio',
  'Audio to Audio': 'audio',
}

const CHAT_TASK_TYPE = 'Chat'

/** 产物的素材类型；对话模型返回 null，类型未知或互相矛盾时报错。 */
export function kindForModel(model: KieModel): MediaKind | null {
  if (model.taskType.includes(CHAT_TASK_TYPE)) {
    return null
  }

  const kinds = new Set(
    model.taskType.map((taskType) => {
      const kind = TASK_TYPE_KINDS[taskType]

      if (!kind) {
        throw new CliError(
          `无法识别模型 ${model.model} 的任务类型：${taskType}`,
        )
      }

      return kind
    }),
  )

  if (kinds.size !== 1) {
    throw new CliError(
      `模型 ${model.model} 的产物类型不明确：${model.taskType.join(', ')}`,
    )
  }

  return [...kinds][0]
}

export async function listModels(refresh = false): Promise<KieModel[]> {
  return cached('models.json', listKieModels, refresh)
}

/** 按标识找模型；缓存里没有时刷新一次目录再找。 */
export async function findModel(id: string): Promise<CatalogModel> {
  const model =
    (await listModels()).find((item) => item.model === id) ??
    (await listModels(true)).find((item) => item.model === id)

  if (!model) {
    throw new CliError(`未知模型：${id}（用 genhub models 查看）`)
  }

  const kind = kindForModel(model)

  if (!kind) {
    throw new CliError(`模型 ${id} 是对话模型，不支持`)
  }

  return { ...model, kind }
}
