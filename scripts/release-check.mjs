// Release gate. Windows-scope builds can use:
//   node scripts/release-check.mjs --windows-only --allow-unsigned
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const args = new Set(process.argv.slice(2))
const windowsOnly = args.has('--windows-only')
const allowUnsigned = args.has('--allow-unsigned')

const results = []
function check(name, condition, detail = '', blocking = true) {
  results.push({ name, ok: Boolean(condition), detail, blocking })
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function walk(directory, predicate) {
  if (!fs.existsSync(directory)) {
    return []
  }
  const found = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      found.push(...walk(full, predicate))
    } else if (predicate(full)) {
      found.push(full)
    }
  }
  return found
}

function signatureStatus(file) {
  if (process.platform !== 'win32') {
    return 'outside-windows'
  }
  const escaped = file.replace(/'/g, "''")
  try {
    const output = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `(Get-AuthenticodeSignature -LiteralPath '${escaped}').Status`,
      ],
      { encoding: 'utf8' },
    )
    return output.trim()
  } catch (error) {
    return `unavailable: ${error.message}`
  }
}

const pkg = readJson('package.json')
const tauri = readJson('src-tauri/tauri.conf.json')
const capabilities = readJson('src-tauri/capabilities/default.json')

check('package and Tauri versions agree', pkg.version === tauri.version, pkg.version)
const csp = tauri.app?.security?.csp
check('production CSP is configured', typeof csp === 'string' && csp.length > 0)
check('production CSP has no script unsafe-inline/eval', csp ? !/script-src[^;]*(unsafe-inline|unsafe-eval)/.test(csp) : false)
check('development CSP is separate', Boolean(tauri.app?.security?.devCsp))
check('prototype freezing is enabled', tauri.app?.security?.freezePrototype === true)
check(
  'no dialog IPC permissions are granted',
  !capabilities.permissions.some(permission => permission.startsWith('dialog:')),
)
check('core:default is not granted', !capabilities.permissions.includes('core:default'))
check('bundle metadata is present', Boolean(tauri.bundle?.publisher && tauri.bundle?.shortDescription))
check(
  'updater is configured',
  Boolean(tauri.plugins?.updater),
  tauri.plugins?.updater ? 'configured' : 'not configured',
  !windowsOnly,
)
check('frontend production bundle exists', fs.existsSync('dist/index.html'))

const releaseExe = path.join('src-tauri', 'target', 'release', 'y-note.exe')
check('release executable exists', fs.existsSync(releaseExe), releaseExe)
if (fs.existsSync(releaseExe)) {
  const status = signatureStatus(releaseExe)
  check('release executable is signed', status === 'Valid', status, !allowUnsigned)
}

const bundleRoot = path.join('src-tauri', 'target', 'release', 'bundle')
const msi = walk(bundleRoot, file => file.toLowerCase().endsWith('.msi'))
const nsis = walk(bundleRoot, file => file.toLowerCase().endsWith('.exe'))
check('Windows MSI installer exists', msi.length > 0, msi[0] ?? 'missing')
check('Windows NSIS installer exists', nsis.length > 0, nsis[0] ?? 'missing')
for (const installer of [...msi, ...nsis]) {
  const status = signatureStatus(installer)
  check(
    `installer is signed: ${path.basename(installer)}`,
    status === 'Valid',
    status,
    !allowUnsigned,
  )
}

if (windowsOnly) {
  console.log('INFO macOS and Linux bundles are out of scope for --windows-only.')
} else {
  const mac = walk(bundleRoot, file => /\.(dmg|app)$/i.test(file))
  const linux = walk(bundleRoot, file => /\.(deb|rpm|AppImage)$/i.test(file))
  check('macOS installer exists', mac.length > 0, mac[0] ?? 'missing')
  check('Linux installer exists', linux.length > 0, linux[0] ?? 'missing')
}

const blockers = results.filter(result => result.blocking && !result.ok)
console.log(
  `\n${results.filter(result => result.ok).length}/${results.length} checks passed; ${blockers.length} blocking issue(s).`,
)
if (!allowUnsigned) {
  console.log('Unsigned builds are not release-ready; use --allow-unsigned only for local validation.')
}
process.exitCode = blockers.length > 0 ? 1 : 0
