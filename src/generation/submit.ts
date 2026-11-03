/**
 * 发起生成：按模型的 schema 校验，上传文件并向 kie 下单，拿到任务编号后才写进记录。
 * 记录里生成中的版本因此都有任务编号；下单失败直接报错，不留下版本。
 */
import { randomUUID } from 'node:crypto'
import {
  copyFile,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'

import { findModel } from '../catalog/catalog'
import type { CatalogModel } from '../catalog/catalog'
import {
  SOURCE_TOKEN,
  filePaths,
  mapStrings,
  parseInputArgs,
  resolveTokens,
  usesSource,
} from '../catalog/input'
import { getInputSchema, validateInput } from '../catalog/schema'
import { CliError } from '../errors'
import { createKieTask, uploadKieFile } from '../kie/client'
import type { KieTaskRequest } from '../kie/client'
import type { AssetLocation, ProjectContext } from '../library/context'
import { inspectMedia } from '../library/media'
import { claimAssetDir } from '../library/ops'
import { REFERENCES_DIR, versionFromFileName } from '../library/paths'
import {
  assetFile,
  findGeneration,
  findVersion,
  now,
  readAsset,
  updateAsset,
} from '../library/record'
import type { AssetRecord, ReferenceRecord } from '../library/record'
import { nextGenerationId, nextVersionNumber } from '../library/rules'
import { findOwningAsset } from '../library/scan'

export type SubmitDeps = {
  upload: (file: string) => Promise<string>
  createTask: (task: KieTaskRequest) => Promise<string>
}

const defaultDeps: SubmitDeps = {
  upload: uploadKieFile,
  createTask: createKieTask,
}

/** 一次生成最多并列几个 kie 任务。 */
const MAX_TASKS = 10

export type GenerateOptions = {
  model?: string
  /** `-p` 的原始参数。 */
  params: string[]
  count?: number
}

/** 待落记录的生成：input 里的文件仍是 `@<绝对路径>` 或 `@source`。 */
type Plan = {
  model: CatalogModel
  input: Record<string, unknown>
  sourceVersion: number | null
  tasks: number
}

/** kie 接受的任务。并列任务部分下单失败时，errors 是失败原因（成功的照常建版本）。 */
type Orders = {
  request: KieTaskRequest
  taskIds: string[]
  errors: string[]
}

/** 发起生成的结果：新版本号，以及部分下单失败时的原因。 */
export type Submission = {
  versions: number[]
  errors: string[]
}

/** 新建素材并发起第一次生成；新素材的当前版本取版本号最靠前的版本。 */
export async function createAsset(
  project: ProjectContext,
  location: AssetLocation,
  options: GenerateOptions,
  deps: SubmitDeps = defaultDeps,
): Promise<Submission> {
  const plan = await planGeneration(options, null)
  const references = await inspectReferences(project.root, plan.input)

  await claimAssetDir(project, location)

  try {
    const orders = await placeOrders(
      plan.model.model,
      plan.input,
      null,
      plan.tasks,
      deps,
    )
    const record: AssetRecord = {
      schema: 1,
      id: randomUUID(),
      kind: plan.model.kind,
      currentVersion: 0,
      createdAt: now(),
      generations: [],
      versions: [],
    }
    const id = nextGenerationId(record.generations)
    const copied = await copyReferences(location.dir, id, references)
    const versions = appendGeneration(record, id, plan, copied, orders)

    record.currentVersion = versions[0]!

    await writeFile(
      assetFile(location.dir),
      `${JSON.stringify(record, null, 2)}\n`,
      { flag: 'wx' },
    )

    return { versions, errors: orders.errors }
  } catch (error) {
    await rm(location.dir, { recursive: true, force: true })
    throw error
  }
}

/**
 * 在已有素材里发起生成。from 指定时沿用该版本的模型与 input（重新生成），`-p` 给出的
 * 键覆盖沿用值；换了模型时不沿用 input。
 */
export async function generateInAsset(
  project: ProjectContext,
  location: AssetLocation,
  options: GenerateOptions & { from?: number },
  deps: SubmitDeps = defaultDeps,
): Promise<Submission> {
  const record = await readAsset(location.dir)
  let plan: Plan

  if (options.from != null) {
    const base = findGeneration(
      record,
      findVersion(record, options.from).generation,
    )

    if (!base) {
      throw new CliError(`v${options.from} 不是生成产物，无法沿用生成输入`)
    }

    const modelId = options.model ?? base.model
    const inherited =
      modelId === base.model ? absoluteTemplate(location.dir, base.input) : {}

    plan = await planGeneration(
      { ...options, model: modelId },
      base.sourceVersion,
      inherited,
    )
  } else {
    plan = await planGeneration(options, null)
  }

  return appendAndDispatch(project, location, record, plan, deps)
}

/** AI 编辑：以某个就绪版本为源版本发起生成，参数里用 `@source` 引用它；未指定模型时沿用该版本的模型。 */
export async function editVersion(
  project: ProjectContext,
  location: AssetLocation,
  sourceVersion: number,
  options: GenerateOptions,
  deps: SubmitDeps = defaultDeps,
): Promise<Submission> {
  const record = await readAsset(location.dir)
  const source = findVersion(record, sourceVersion)

  if (source.state !== 'ready' || !source.file) {
    throw new CliError(`v${sourceVersion} 尚未就绪，不能作为 AI 编辑的源版本`)
  }

  const plan = await planGeneration(
    {
      ...options,
      model: options.model ?? findGeneration(record, source.generation)?.model,
    },
    sourceVersion,
  )

  return appendAndDispatch(project, location, record, plan, deps)
}

/** 原地重试失败的版本：沿用它那次生成的输入下一个新任务，下单成功后版本才回到生成中。 */
export async function retryVersion(
  location: AssetLocation,
  number: number,
  deps: SubmitDeps = defaultDeps,
): Promise<Submission> {
  const record = await readAsset(location.dir)
  const version = findVersion(record, number)
  const generation = findGeneration(record, version.generation)

  if (version.state !== 'failed') {
    throw new CliError('只有失败的版本可以重试')
  }

  if (!generation) {
    throw new CliError(`v${number} 不是生成产物，无法重试`)
  }

  const orders = await placeOrders(
    generation.model,
    absoluteTemplate(location.dir, generation.input),
    sourceFile(location, record, generation.sourceVersion),
    1,
    deps,
  )

  await updateAsset(location.dir, (latest) => {
    Object.assign(findVersion(latest, number), {
      state: 'generating',
      resultIndex: 0,
      taskId: orders.taskIds[0],
      kieRequest: orders.request,
      kieRecord: null,
      failReason: null,
      credits: null,
      updatedAt: now(),
    })
  })

  return { versions: [number], errors: [] }
}

/**
 * 解析 `-p` 并与沿用的 input 合并，按模型 schema 校验（值类型就地转换）。
 * `@source` 只能用在 AI 编辑（或沿用了 AI 编辑的重新生成）里。
 */
async function planGeneration(
  options: GenerateOptions,
  sourceVersion: number | null,
  inherited: Record<string, unknown> = {},
): Promise<Plan> {
  if (!options.model) {
    throw new CliError('缺少 --model')
  }

  const tasks = options.count ?? 1

  if (!Number.isInteger(tasks) || tasks < 1 || tasks > MAX_TASKS) {
    throw new CliError(`count 范围是 1–${MAX_TASKS}`)
  }

  const model = await findModel(options.model)
  const input = {
    ...inherited,
    ...absoluteFiles(parseInputArgs(options.params)),
  }
  const hasSource = usesSource(input)

  if (sourceVersion == null && hasSource) {
    throw new CliError('@source 只能用于 AI 编辑')
  }

  if (
    sourceVersion != null &&
    !hasSource &&
    Object.keys(inherited).length === 0
  ) {
    throw new CliError('AI 编辑需要在参数里用 @source 引用源版本')
  }

  validateInput(await getInputSchema(model.model), input)

  return {
    model,
    input,
    sourceVersion: hasSource ? sourceVersion : null,
    tasks,
  }
}

/** 命令行里的文件路径转成绝对路径（相对调用时所在目录）。 */
function absoluteFiles(input: Record<string, unknown>) {
  return mapStrings(input, (text) =>
    isLocalFile(text) ? `@${path.resolve(text.slice(1))}` : text,
  ) as Record<string, unknown>
}

/** 记录里的 input 模板（文件相对素材文件夹）→ 绝对路径，供重新生成沿用。 */
function absoluteTemplate(dir: string, template: Record<string, unknown>) {
  return mapStrings(template, (text) =>
    isLocalFile(text) ? `@${path.join(dir, text.slice(1))}` : text,
  ) as Record<string, unknown>
}

function isLocalFile(text: string): boolean {
  return (
    text.startsWith('@') &&
    !text.startsWith('@@') &&
    text !== SOURCE_TOKEN &&
    text.length > 1
  )
}

async function appendAndDispatch(
  project: ProjectContext,
  location: AssetLocation,
  record: AssetRecord,
  plan: Plan,
  deps: SubmitDeps,
): Promise<Submission> {
  if (plan.model.kind !== record.kind) {
    throw new CliError(
      `模型 ${plan.model.model} 生成 ${plan.model.kind}，与素材类型 ${record.kind} 不符`,
    )
  }

  const references = await inspectReferences(project.root, plan.input)
  const orders = await placeOrders(
    plan.model.model,
    plan.input,
    sourceFile(location, record, plan.sourceVersion),
    plan.tasks,
    deps,
  )
  const versions = await updateAsset(location.dir, async (latest) => {
    const id = nextGenerationId(latest.generations)
    const copied = await copyReferences(location.dir, id, references)

    return appendGeneration(latest, id, plan, copied, orders)
  })

  return { versions, errors: orders.errors }
}

/** 源版本产物的绝对路径；没有源版本时为 null。 */
function sourceFile(
  location: AssetLocation,
  record: AssetRecord,
  sourceVersion: number | null,
): string | null {
  const file =
    sourceVersion == null ? null : findVersion(record, sourceVersion).file

  return file ? path.join(location.dir, file) : null
}

type ReferenceInput = Omit<ReferenceRecord, 'file'> & { path: string }

/** input 引用的本机文件：识别类型；位于库内某个版本产物时记下出处。 */
async function inspectReferences(
  root: string,
  input: Record<string, unknown>,
): Promise<ReferenceInput[]> {
  return Promise.all(
    filePaths(input).map(async (file) => {
      let bytes: Buffer

      try {
        if (!(await stat(file)).isFile()) {
          throw new CliError(`不是文件：${file}`)
        }

        bytes = await readFile(file)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new CliError(`文件不存在：${file}`)
        }

        throw error
      }

      const media = await inspectMedia(bytes)
      const owner = await findOwningAsset(root, file)
      const version = versionFromFileName(path.basename(file))

      return {
        path: file,
        name: path.basename(file),
        kind: media.kind,
        origin:
          owner && version != null
            ? {
                asset: path.relative(root, owner).split(path.sep).join('/'),
                version,
              }
            : null,
      }
    }),
  )
}

type CopiedReference = ReferenceRecord & { source: string }

/** 参考输入复制到 references/<生成编号>/，保留原文件名，同名时加序号。 */
async function copyReferences(
  dir: string,
  generationId: number,
  references: ReferenceInput[],
): Promise<CopiedReference[]> {
  if (references.length === 0) {
    return []
  }

  const folder = path.join(REFERENCES_DIR, String(generationId))
  const used = new Set<string>()
  const records: CopiedReference[] = []

  await mkdir(path.join(dir, folder), { recursive: true })

  for (const { path: source, ...reference } of references) {
    const { name, ext } = path.parse(reference.name)
    let fileName = reference.name

    for (let index = 2; used.has(fileName); index++) {
      fileName = `${name}-${index}${ext}`
    }

    used.add(fileName)

    const file = path.join(folder, fileName).split(path.sep).join('/')

    await copyFile(source, path.join(dir, file))
    records.push({ ...reference, file, source })
  }

  return records
}

/** 追加一次生成与它的版本（每个 kie 接受的任务一个，就地修改 record）；返回新版本号。 */
function appendGeneration(
  record: AssetRecord,
  id: number,
  plan: Plan,
  references: CopiedReference[],
  orders: Orders,
): number[] {
  const timestamp = now()
  const copies = new Map(
    references.map((reference) => [reference.source, reference.file]),
  )
  const base = nextVersionNumber(record.versions)
  const versions = orders.taskIds.map((taskId, position) => {
    const number = base + position

    record.versions.push({
      number,
      state: 'generating',
      origin: 'generation',
      generation: id,
      position,
      resultIndex: 0,
      sourceVersion: plan.sourceVersion,
      taskId,
      kieRequest: orders.request,
      kieRecord: null,
      failReason: null,
      credits: null,
      file: null,
      mimeType: null,
      fileSize: null,
      width: null,
      height: null,
      duration: null,
      importedFrom: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    return number
  })

  record.generations.push({
    id,
    model: plan.model.model,
    // 模板里的文件改成相对素材文件夹的副本路径。
    input: mapStrings(plan.input, (text) =>
      isLocalFile(text) && copies.has(text.slice(1))
        ? `@${copies.get(text.slice(1))}`
        : text,
    ) as Record<string, unknown>,
    references: references.map(
      ({ source: _source, ...reference }) => reference,
    ),
    sourceVersion: plan.sourceVersion,
    createdAt: timestamp,
  })

  return versions
}

/**
 * 上传 input 引用的文件与源版本换取临时地址（每次下单都重新上传，不保存），再下 count
 * 个任务。全部下单失败时报错；部分失败时返回成功的任务与失败原因。
 */
async function placeOrders(
  model: string,
  input: Record<string, unknown>,
  source: string | null,
  count: number,
  deps: SubmitDeps,
): Promise<Orders> {
  const files = new Map<string, string>(
    filePaths(input).map((file) => [`@${file}`, file]),
  )

  if (usesSource(input)) {
    if (!source) {
      throw new CliError('源版本没有产物文件')
    }

    files.set(SOURCE_TOKEN, source)
  }

  const urls = new Map(
    await Promise.all(
      [...files].map(
        async ([token, file]) => [token, await deps.upload(file)] as const,
      ),
    ),
  )
  const request: KieTaskRequest = {
    model,
    input: resolveTokens(input, (token) => urls.get(token)!),
  }
  const results = await Promise.allSettled(
    Array.from({ length: count }, () => deps.createTask(request)),
  )
  const taskIds = results.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  )
  const errors = [
    ...new Set(
      results.flatMap((result) =>
        result.status === 'rejected' ? [(result.reason as Error).message] : [],
      ),
    ),
  ]

  if (taskIds.length === 0) {
    throw new CliError(errors[0] ?? '下单失败')
  }

  return { request, taskIds, errors }
}
