import { exec, spawn } from 'child_process'
import type { AgentId, CliVersionInfo } from '../shared/types'
import { listAdapters } from './agents'

const NPM_REGISTRY = 'https://registry.npmjs.org'
/** 执行 <cli> --version 的超时（CLI 冷启动可能较慢） */
const VERSION_TIMEOUT_MS = 10_000
/** 拉取 npm registry 最新版本的超时 */
const LATEST_TIMEOUT_MS = 15_000

/** 单个 CLI 的检测规格：当前版本命令、npm 包名、升级命令 */
interface CliSpec {
  /** 取当前版本执行的命令（走 shell，兼容 npm 的 .cmd shim 与 .exe） */
  versionCommand: string
  /** npm registry 上的包名，用于查询最新版本 */
  npmPackage: string
  /** 安装 / 重装命令（常驻提供，任选其一） */
  installCommands: string[]
  /** 升级命令（可能有多种方式，任选其一；供用户复制自行在终端执行） */
  upgradeCommands: string[]
}

/**
 * pi / omp 两个 CLI 的检测规格。
 * - pi：npm 全局安装的 @earendil-works/pi-coding-agent，安装/升级都用 npm install
 * - omp：bun 全局安装的 @oh-my-pi/pi-coding-agent，升级可用自带的 omp update 或重新 bun install
 */
const CLI_SPECS: Record<AgentId, CliSpec> = {
  pi: {
    versionCommand: 'pi --version',
    npmPackage: '@earendil-works/pi-coding-agent',
    installCommands: ['npm install -g --ignore-scripts @earendil-works/pi-coding-agent'],
    upgradeCommands: ['npm install -g --ignore-scripts @earendil-works/pi-coding-agent']
  },
  omp: {
    versionCommand: 'omp --version',
    npmPackage: '@oh-my-pi/pi-coding-agent',
    installCommands: ['bun install -g @oh-my-pi/pi-coding-agent'],
    upgradeCommands: ['omp update', 'bun install -g @oh-my-pi/pi-coding-agent']
  }
}

/** 从命令输出里抽取形如 x.y.z 的版本号，自动跳过 "omp/" 之类前缀 */
function parseVersion(output: string): string {
  const match = output.match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)/)
  return match ? match[1] : ''
}

/** 语义化版本比较：a>b 返回正，a<b 返回负，相等 0（只比较主/次/修订三段） */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}

/**
 * Windows：exec 超时只会 TerminateProcess cmd.exe，CLI 孙进程（node.exe，经 npm .cmd shim 拉起）
 * 可能残留。重试前先用 taskkill 清掉进程树，避免新旧实例并行抢冷启动资源；进程已退出时静默。
 */
function killProcessTree(pid: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
    windowsHide: true,
    stdio: 'ignore'
  })
  killer.on('close', resolve)
  killer.on('error', resolve)
  return promise
}

/**
 * 执行 <cli> --version 取当前本地版本；未安装/不在 PATH 时抛错。
 * 首次失败会重试一次：CLI 冷启动（首次加载依赖、杀软扫描、刚开机）可能超过单次超时，
 * 重试时通常已「热」起来，避免把偶发的慢启动误判成「未安装」。
 * 用 exec 原始形式拿子进程句柄，超时后能按 PID 清进程树（见 killProcessTree）。
 */
async function getCurrentVersion(command: string): Promise<string> {
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    const child = exec(command, { timeout: VERSION_TIMEOUT_MS, windowsHide: true })
    try {
      const { promise, resolve, reject } = Promise.withResolvers<{
        stdout: string
        stderr: string
      }>()
      let stdout = ''
      let stderr = ''
      child.stdout?.on('data', (chunk) => (stdout += chunk))
      child.stderr?.on('data', (chunk) => (stderr += chunk))
      child.on('error', reject)
      child.on('close', (code, signal) => {
        if (code === 0 && signal === null) resolve({ stdout, stderr })
        else reject(new Error(`命令退出：${code ?? signal ?? '未知原因'}`))
      })
      await promise
      // 部分 CLI 把版本号打到 stderr，两路都扫
      const version = parseVersion(`${stdout}\n${stderr}`)
      if (version) return version
      lastError = new Error('命令执行成功但没有输出版本号')
    } catch (error) {
      lastError = error
      // 首次失败后清掉可能残留的 CLI 进程树再重试（仅 Windows，taskkill 找不到进程时静默）
      if (attempt === 0 && child.pid && process.platform === 'win32') {
        await killProcessTree(child.pid)
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

/** 拉取 npm registry 上某个包的最新版本号 */
async function getLatestVersion(pkg: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LATEST_TIMEOUT_MS)
  try {
    const res = await fetch(`${NPM_REGISTRY}/${encodeURIComponent(pkg)}/latest`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
    const body = (await res.json()) as { version?: unknown }
    return typeof body.version === 'string' ? body.version : ''
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`请求超时（${LATEST_TIMEOUT_MS / 1000}s）`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 检测所有已登记 CLI 的版本信息：并行取「本地当前版本」与「npm 最新版本」，
 * 二者互不阻塞（本地未安装仍能显示最新版，拉取失败仍能显示当前版）。
 */
export async function getCliVersions(): Promise<CliVersionInfo[]> {
  const adapters = listAdapters().filter((a) => CLI_SPECS[a.id])
  return Promise.all(
    adapters.map(async (adapter) => {
      const spec = CLI_SPECS[adapter.id]
      const info: CliVersionInfo = {
        id: adapter.id,
        label: adapter.label,
        installed: false,
        current: '',
        latest: '',
        hasUpdate: false,
        installCommands: spec.installCommands,
        upgradeCommands: spec.upgradeCommands
      }
      const [current, latest] = await Promise.allSettled([
        getCurrentVersion(spec.versionCommand),
        getLatestVersion(spec.npmPackage)
      ])
      if (current.status === 'fulfilled' && current.value) {
        info.current = current.value
        info.installed = true
      }
      if (latest.status === 'fulfilled' && latest.value) {
        info.latest = latest.value
      } else if (latest.status === 'rejected') {
        info.error = latest.reason instanceof Error ? latest.reason.message : String(latest.reason)
      }
      info.hasUpdate =
        info.installed && info.latest !== '' && compareVersions(info.latest, info.current) > 0
      return info
    })
  )
}
