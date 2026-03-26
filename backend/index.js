require('dotenv').config();
const express = require('express');
const iconv = require('iconv-lite');
const cors = require('cors');
const child_process = require('child_process');
const { spawn } = child_process;
const util = require('util');
const execAsync = util.promisify(child_process.exec);
const WebSocket = require('ws');
const http = require('http');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const fs = require('fs');
const app = express();
app.use(cors());
app.use(express.json());

// ─── Sentry helpers ─────────────────────────────────────────────────────────

/**
 * sentry.properties 파일을 파싱하여 auth.token, defaults.org, defaults.project 추출
 * @param {string} projectRoot - .uproject가 위치한 프로젝트 루트
 * @returns {{ authToken: string, org: string, project: string } | null}
 */
function parseSentryProperties(projectRoot) {
  const filePath = path.join(projectRoot, 'sentry.properties');
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf8');
  const props = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('[')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    props[trimmed.substring(0, eqIdx).trim()] = trimmed.substring(eqIdx + 1).trim();
  }
  const authToken = props['auth.token'];
  const org       = props['defaults.org'];
  const project   = props['defaults.project'];
  if (!authToken || !org || !project) return null;
  return { authToken, org, project };
}

/**
 * 프로젝트 루트에서 .uproject 파일명(확장자 제외)을 탐색하여 PROJECT_NAME 추출
 * @param {string} projectRoot
 * @returns {string|null}
 */
function getProjectName(projectRoot) {
  try {
    const files = fs.readdirSync(projectRoot);
    const uproject = files.find(f => f.endsWith('.uproject'));
    if (!uproject) return null;
    return uproject.replace('.uproject', '');
  } catch (_) { return null; }
}

/**
 * 플랫폼별 sentry-cli debug-files upload 대상 심볼 경로 반환
 * @param {string} projectRoot
 * @param {string} projectName
 * @param {string} platform - Win64 | Android | IOS
 * @returns {{ symbolPath: string, description: string } | null}
 */
function getSentrySymbolPath(projectRoot, projectName, platform) {
  switch (platform) {
    case 'Android': {
      // UBT가 생성하는 _Symbols_v1 폴더 (.so 파일)
      const symDir = path.join(projectRoot, 'Binaries', 'Android', `${projectName}_Symbols_v1`);
      if (fs.existsSync(symDir)) return { symbolPath: symDir, description: 'Android .so symbols' };
      return null;
    }
    case 'Win64': {
      // Win64 빌드 산출물 (.pdb 파일)
      const symDir = path.join(projectRoot, 'Binaries', 'Win64');
      if (fs.existsSync(symDir)) return { symbolPath: symDir, description: 'Win64 .pdb symbols' };
      return null;
    }
    case 'IOS': {
      // iOS dSYM 심볼 (향후 확장)
      const symDir = path.join(projectRoot, 'Binaries', 'IOS');
      if (fs.existsSync(symDir)) return { symbolPath: symDir, description: 'iOS dSYM symbols' };
      return null;
    }
    default: return null;
  }
}

/**
 * sentry-cli 실행파일 절대경로를 탐색
 * @param {string} projectRoot
 * @returns {string|null}
 */
function findSentryCli(projectRoot) {
  // 프로젝트 내 Sentry 플러그인에 번들된 CLI
  const candidates = [
    path.join(projectRoot, 'Plugins', 'Sentry', 'Source', 'ThirdParty', 'CLI', 'sentry-cli-Windows-x86_64.exe'),
    path.join(projectRoot, 'Plugins', 'Sentry', 'Source', 'Sentry', 'Resources', 'sentry-cli-Windows-x86_64.exe'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  // 시스템 PATH에 등록된 sentry-cli 확인
  try {
    const { execSync } = require('child_process');
    const result = execSync('where sentry-cli', { encoding: 'utf8', timeout: 5000 }).trim();
    if (result) return result.split('\n')[0].trim();
  } catch (_) {}
  return null;
}

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = 3001;
const BAT_SCRIPT_PATH = 'F:\\wz\\UE_CICD\\SampleProject\\BuildProject.bat';

// Initialize SQLite DB for Analytics & History
const db = new Database('build_history.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS builds (
    id TEXT PRIMARY KEY,
    platform TEXT,
    config TEXT,
    status TEXT,
    start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    end_time DATETIME,
    duration_seconds INTEGER,
    log_file TEXT
  )
`);

// WebSocket connections
const clients = new Set();
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
});

function broadcast(data) {
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

let activeBuildProcess = null;
let activeBuildId = null;
let isCancelling = false;
let isPreparingBuild = false;
let lastErrorLine = '';

// 서버 비정상 종료 대처: 과거 Running 상태들을 Failed로 일괄 전환
db.prepare(`UPDATE builds SET status = 'Failed', end_time = CURRENT_TIMESTAMP
            WHERE status = 'Running'`).run();

// 서버 재시작 시 빌드 플래그 강제 리셋 (비정상 종료 대비)
isPreparingBuild   = false;
activeBuildProcess = null;
isCancelling       = false;

// isPreparingBuild watchdog: 5분 이상 Preparing 상태면 자동 리셋
let preparingBuildSince = null;
const _origPost = (v) => v;
setInterval(() => {
  if (isPreparingBuild && preparingBuildSince) {
    const elapsed = Date.now() - preparingBuildSince;
    if (elapsed > 5 * 60 * 1000) {
      console.warn('[Watchdog] isPreparingBuild stuck >5min, auto-resetting.');
      isPreparingBuild   = false;
      activeBuildProcess = null;
      isCancelling       = false;
      pendingBuildContext = null;
      preparingBuildSince = null;
      broadcast({ type: 'BUILD_LOCK_RESET', message: 'Build lock auto-reset by watchdog' });
    }
  } else if (!isPreparingBuild) {
    preparingBuildSince = null;
  }
}, 30 * 1000);

// GET /api/git/refs
app.get('/api/git/refs', async (req, res) => {
  const repoPath = req.query.path || 'F:\\wz\\UE_CICD\\SampleProject';
  try {
    // 원격 ref 동기화 (새 브랜치/태그 반영)
    await execAsync(`git -C "${repoPath}" fetch --all --prune`);

    // 현재 활성화된 HEAD 브랜치 획득
    let currentBranch = '';
    try {
      const { stdout: headOut } = await execAsync(`git -C "${repoPath}" rev-parse --abbrev-ref HEAD`);
      currentBranch = headOut.trim();
    } catch (_) {}

    // ?β돦裕뉛쭚戮ャ럦?嶺뚮ㅄ維뽨빳?
    const { stdout: localOut } = await execAsync(
      `git -C "${repoPath}" branch --format="%(refname:short)|%(objectname:short)|%(subject)|%(authorname)|%(committerdate:relative)"`
    );
    const localBranches = localOut.split('\n').filter(Boolean).map(line => {
      const parts = line.split('|');
      return {
        type: 'branch',
        remote: false,
        name: parts[0] || '',
        hash: parts[1] || '',
        message: parts[2] || '',
        author: parts[3] || '',
        time: parts[4] || '',
        isCurrent: parts[0] === currentBranch
      };
    });

    // ?洹먮맓嫄戮ャ럦?嶺뚮ㅄ維뽨빳?(origin/HEAD 戮곕뇶, origin/ Ŧ蹂ㅽ깴怨댄맋 戮?뻣)
    let remoteBranches = [];
    try {
      const { stdout: remoteOut } = await execAsync(
        `git -C "${repoPath}" branch -r --format="%(refname:short)|%(objectname:short)|%(subject)|%(authorname)|%(committerdate:relative)"`
      );
      const localNames = new Set(localBranches.map(b => b.name));
      remoteBranches = remoteOut.split('\n').filter(Boolean)
        .filter(line => !line.includes('HEAD') && line.includes('/'))  // HEAD 포인터 명시적 스킵
        .map(line => {
          const parts = line.split('|');
          const fullName  = parts[0] || '';             // e.g. origin/RunnerV2
          const shortName = fullName.replace(/^[^/]+\//, ''); // e.g. RunnerV2
          return {
            type: 'branch',
            remote: true,
            name: shortName,
            fullName,
            hash: parts[1] || '',
            message: parts[2] || '',
            author: parts[3] || '',
            time: parts[4] || '',
            isCurrent: false
          };
        })
        .filter(b => !localNames.has(b.name));          // 로컬 브랜치명과 중복되는 원격 브랜치는 통합 처리
    } catch (_) {}

    const branches = [...localBranches, ...remoteBranches];

    // 태그(Tag) 정보 최신순으로 획득
    let tags = [];
    try {
      const { stdout: tagOut } = await execAsync(
        `git -C "${repoPath}" tag --sort=-creatordate --format="%(refname:short)|%(objectname:short)|%(subject)|%(creatordate:relative)" -n1`
      );
      tags = tagOut.split('\n').filter(Boolean).map(line => {
        const parts = line.split('|');
        return {
          type: 'tag',
          name: parts[0] || '',
          hash: parts[1] || '',
          message: parts[2] || '',
          author: '',
          time: parts[3] || ''
        };
      });
    } catch (_) {}

    res.json({ branches, tags, currentBranch });
  } catch (err) {
    console.error('Git refs error:', err);
    res.status(500).json({ error: 'Failed to fetch git refs', details: err.message });
  }
});

// GET /api/git/commits
app.get('/api/git/commits', async (req, res) => {
  const repoPath = req.query.path || 'F:\\wz\\UE_CICD\\SampleProject';
  const branch = req.query.branch || '';
  try {
    if (repoPath.startsWith('http://') || repoPath.startsWith('https://')) {
      const url = new URL(repoPath);
      if (url.hostname === 'github.com') {
        const parts = url.pathname.split('/').filter(Boolean);
        if (parts.length >= 2) {
          const owner = parts[0];
          const repo = parts[1];
          let sha = branch ? `?sha=${branch}` : '';
          if (!branch && parts[2] === 'tree' && parts[3]) {
            sha = `?sha=${parts.slice(3).join('/')}`;
          }
          const apiUrl = `https://api.github.com/repos/${owner}/${repo}/commits${sha}`;
          const response = await fetch(apiUrl, {
            headers: { 'User-Agent': 'node.js', 'Accept': 'application/vnd.github.v3+json' }
          });
          if (!response.ok) throw new Error(`GitHub API returned ${response.status}: ${response.statusText}`);
          const data = await response.json();
          const commits = data.slice(0, 50).map(c => ({
            hash: c.sha.substring(0, 7),
            message: c.commit.message.split('\n')[0],
            author: c.commit.author.name,
            time: new Date(c.commit.author.date).toLocaleString()
          }));
          return res.json(commits);
        } else {
          throw new Error('Invalid GitHub repository URL format');
        }
      } else {
        throw new Error('Only github.com URLs are currently supported.');
      }
    } else {
      const branchArg = branch ? `"${branch}"` : 'HEAD';
      const { stdout } = await execAsync(
        `git -C "${repoPath}" log ${branchArg} -n 50 --pretty=format:"%h|%s|%an|%ar"`
      );
      const commits = stdout.split('\n').filter(Boolean).map(line => {
        const parts = line.split('|');
        return { hash: parts[0], message: parts[1], author: parts[2], time: parts[3] };
      });
      res.json(commits);
    }
  } catch (err) {
    console.error('Git log error:', err);
    res.status(500).json({ error: 'Failed to fetch git commits', details: err.message });
  }
});

// キ節띉⑤챶
// step total은 clearCache / sentryUpload 여부에 따라 동적으로 결정
function getBuildSteps(hasClearCache, hasSentryUpload, hasCookClean) {
  let stepNum = 1;
  const steps = {};
  steps.GIT_CHECK   = { step: stepNum++, total: 0, label: 'Git Check'    };
  steps.GIT_FETCH   = { step: stepNum++, total: 0, label: 'Git Fetch'    };
  steps.GIT_SWITCH  = { step: stepNum++, total: 0, label: 'Git Checkout' };
  steps.GIT_PULL    = { step: stepNum++, total: 0, label: 'Git Pull'     };
  if (hasClearCache)   steps.CLEAR_CACHE   = { step: stepNum++, total: 0, label: 'Clear Cache'     };
  if (hasCookClean)    steps.COOK_CLEAN    = { step: stepNum++, total: 0, label: 'Cook Clean'      };
  steps.BUILD_START  = { step: stepNum++, total: 0, label: 'Build'        };
  if (hasSentryUpload) steps.SENTRY_UPLOAD = { step: stepNum++, total: 0, label: 'Sentry Upload'   };
  const total = stepNum - 1;
  for (const key of Object.keys(steps)) steps[key].total = total;
  return steps;
}

// gitRevision 戮ャ럦?濡?뎄?筌? (?β돦裕뉛쭚?+ ?洹먮맓嫄嶺뚮ㅄ維筌筌먦끉逾?
async function isBranchName(repoPath, revision) {
  try {
    const { stdout: local } = await execAsync(`git -C "${repoPath}" branch --list "${revision}"`);
    if (local.trim().length > 0) return true;
    const { stdout: remote } = await execAsync(`git -C "${repoPath}" branch -r --list "origin/${revision}"`);
    return remote.trim().length > 0;
  } catch (_) { return false; }
}

// キ(Revert ?筌먦끉逾繞벿살탳
let pendingBuildContext = null;

// 堉キ貫
async function executeBuild(ctx) {
  const { buildId, startTime, platform, config, finalEnginePath, finalProjectPath, gitRevision, cleanBuild, clearCache, cookClean } = ctx;

  // Sentry upload 가능 여부 사전 판정 (스텝 수 결정에 필요)
  const sentryProps   = parseSentryProperties(finalProjectPath);
  const projectName   = getProjectName(finalProjectPath);
  const sentryCli     = sentryProps ? findSentryCli(finalProjectPath) : null;
  const hasSentry     = !!(sentryProps && projectName && sentryCli);

  const STEPS = getBuildSteps(clearCache, hasSentry, cookClean);
  try {
    // -- PHASE 1: Git sync (always runs) ------------------------------------------

    // git fetch --all
    broadcast({ type: 'STEP', ...STEPS.GIT_FETCH, buildId });
    broadcast({ type: 'LOG',  data: `[Git] Step ${STEPS.GIT_FETCH.step}/${STEPS.GIT_FETCH.total} fetch --all` });
    await execAsync(`git -C "${finalProjectPath}" fetch --all`);
    broadcast({ type: 'LOG',  data: `[Git] fetch complete`});
    if (isCancelling) throw new Error('Canceled during git fetch');

    if (gitRevision) {
      // STEP 3/5 - checkout specified revision
      broadcast({ type: 'STEP', ...STEPS.GIT_SWITCH, buildId });
      broadcast({ type: 'LOG',  data: `[Git] Step ${STEPS.GIT_SWITCH.step}/${STEPS.GIT_SWITCH.total} checkout: ${gitRevision}` });
      const { stdout: localList } = await execAsync(`git -C "${finalProjectPath}" branch --list "${gitRevision}"`);
      const isLocalBranch = localList.trim().length > 0;
      const { stdout: remoteList } = await execAsync(`git -C "${finalProjectPath}" branch -r --list "origin/${gitRevision}"`);
      const isRemoteOnly = !isLocalBranch && remoteList.trim().length > 0;
      if (isRemoteOnly) {
        await execAsync(`git -C "${finalProjectPath}" checkout -B "${gitRevision}" --track "origin/${gitRevision}"`);
        broadcast({ type: 'LOG', data: `[Git] 리모트 전용 브랜치 로컬 트래킹 checkout: ${gitRevision}` });
      } else {
        await execAsync(`git -C "${finalProjectPath}" checkout ${gitRevision}`);
        broadcast({ type: 'LOG', data: `[Git] checkout 완료` });

      }
      if (isCancelling) throw new Error('Canceled during git checkout');

      // STEP 4/5 - pull if branch
      const isBranch = await isBranchName(finalProjectPath, gitRevision);
      if (isBranch) {
        broadcast({ type: 'STEP', ...STEPS.GIT_PULL, buildId });
        broadcast({ type: 'LOG',  data: `[Git] Step ${STEPS.GIT_PULL.step}/${STEPS.GIT_PULL.total} pull (branch: ${gitRevision})` });
        await execAsync(`git -C "${finalProjectPath}" pull`);
        broadcast({ type: 'LOG',  data: `[Git] pull done` });
        if (isCancelling) throw new Error('Canceled during git pull');
      } else {
        broadcast({ type: 'LOG', data: `[Git] Step 4/5 pull skip (detached HEAD / tag)` });
      }

    } else {
      // HEAD mode: no checkout, but still fetch+pull current branch for latest commits
      broadcast({ type: 'STEP', ...STEPS.GIT_SWITCH, buildId });
      broadcast({ type: 'LOG',  data: `[Git] Step ${STEPS.GIT_SWITCH.step}/${STEPS.GIT_SWITCH.total} HEAD (checkout 생략, 현재 브랜치 연결 유지)` });

      let currentBranch = '';
      try {
        const { stdout: abbrev } = await execAsync(`git -C "${finalProjectPath}" rev-parse --abbrev-ref HEAD`);
        currentBranch = abbrev.trim();
      } catch (_) {}

      if (currentBranch && currentBranch !== 'HEAD') {
        broadcast({ type: 'STEP', ...STEPS.GIT_PULL, buildId });
        broadcast({ type: 'LOG',  data: `[Git] Step ${STEPS.GIT_PULL.step}/${STEPS.GIT_PULL.total} pull (branch: ${currentBranch})` });
        await execAsync(`git -C "${finalProjectPath}" pull`);
        broadcast({ type: 'LOG',  data: `[Git] pull done` });
        if (isCancelling) throw new Error('Canceled during git pull');
      } else {
        broadcast({ type: 'LOG', data: `[Git] Step 4/5 pull skip (detached HEAD)` });
      }
    }

    // Final HEAD info (always shown)
    {
      const { stdout: headSha } = await execAsync(`git -C "${finalProjectPath}" rev-parse --short HEAD`);
      const { stdout: headMsg } = await execAsync(`git -C "${finalProjectPath}" log -1 --pretty=format:"%s"`);
      broadcast({ type: 'LOG',      data: `[Git] Latest commit HEAD: ${headSha.trim()} "${headMsg.trim()}""` });
      broadcast({ type: 'GIT_DONE', buildId });
    }
    // -- PHASE 1.5: Clear Cache (optional) --
    if (clearCache) {
      broadcast({ type: 'STEP', ...STEPS.CLEAR_CACHE, buildId });
      broadcast({ type: 'LOG', data: `[Clean] Step ${STEPS.CLEAR_CACHE.step}/${STEPS.CLEAR_CACHE.total} Clearing build cache and intermediate files...` });
      broadcast({ type: 'LOG', data: `[Clean] Target: ${finalProjectPath}` });
      const fs = require('fs');
      const pathLib = require('path');
      // XmlConfigCache.bin 삭제
      const xmlCache = pathLib.join(finalProjectPath, 'Intermediate', 'Build', 'XmlConfigCache.bin');
      if (fs.existsSync(xmlCache)) {
        fs.unlinkSync(xmlCache);
        broadcast({ type: 'LOG', data: `[Clean] Removed: XmlConfigCache.bin` });
      }
      // Intermediate, Saved, Binaries 폴더 삭제
      const foldersToClean = ['Intermediate', 'Saved', 'Binaries'];
      for (const folder of foldersToClean) {
        const folderPath = pathLib.join(finalProjectPath, folder);
        if (fs.existsSync(folderPath)) {
          try {
            fs.rmSync(folderPath, { recursive: true, force: true });
            broadcast({ type: 'LOG', data: `[Clean] Removed: ${folder}/` });
          } catch (e) {
            broadcast({ type: 'LOG', data: `[Clean] Warning: Could not fully remove ${folder}/ - ${e.message}` });
          }
        }
      }
      broadcast({ type: 'LOG', data: `[Clean] Cache cleared successfully` });
    }
    if (isCancelling) throw new Error('Canceled during cache clear');

    // -- PHASE 1.6: Cook Clean (optional) -- 셰이더·에셋 쿠킹 캐시만 삭제 (C++ 빌드 생략)
    if (cookClean) {
      broadcast({ type: 'STEP', ...STEPS.COOK_CLEAN, buildId });
      broadcast({ type: 'LOG', data: `[CookClean] Step ${STEPS.COOK_CLEAN.step}/${STEPS.COOK_CLEAN.total} Clearing cooked asset & shader cache...` });
      broadcast({ type: 'LOG', data: `[CookClean] Target: ${finalProjectPath}` });
      const fsCC   = require('fs');
      const pathCC = require('path');
      const cookDirs = [
        pathCC.join(finalProjectPath, 'Saved', 'Cooked'),
        pathCC.join(finalProjectPath, 'Saved', 'ShaderDebugInfo'),
        pathCC.join(finalProjectPath, 'DerivedDataCache'),
      ];
      for (const dir of cookDirs) {
        if (fsCC.existsSync(dir)) {
          try {
            fsCC.rmSync(dir, { recursive: true, force: true });
            broadcast({ type: 'LOG', data: `[CookClean] Removed: ${dir}` });
          } catch (e) {
            broadcast({ type: 'LOG', data: `[CookClean] Warning: ${dir} — ${e.message}` });
          }
        } else {
          broadcast({ type: 'LOG', data: `[CookClean] Skip (not found): ${dir}` });
        }
      }
      broadcast({ type: 'LOG', data: `[CookClean] Cook cache cleared. UAT will recook all shaders & assets.` });
    }
    if (isCancelling) throw new Error('Canceled during cook clean');

    // PHASE 2: 빌드 명령줄 조립 및 서브프로세스 런처 진입
    broadcast({ type: 'STEP', ...STEPS.BUILD_START, buildId });
    broadcast({ type: 'LOG',  data: `[Build] Step ${STEPS.BUILD_START.step}/${STEPS.BUILD_START.total} BAT run (${platform} / ${config})${cleanBuild ? ' [Clean Build]' : ''}${cookClean ? ' [Cook Clean]' : ''}` });

    const batEnv        = {
      ...process.env,
      ENGINE_DIR_OVERRIDE:  finalEnginePath,
      PROJECT_DIR_OVERRIDE: finalProjectPath,
      // Android SDK 등 시스템 환경 변수가 설정되지 않은 경우를 대비한 하드코딩 Fallback 경로
      ANDROID_HOME:         process.env.ANDROID_HOME     || 'C:\\Android\\Sdk',
      ANDROID_SDK_ROOT:     process.env.ANDROID_SDK_ROOT || 'C:\\Android\\Sdk',
      NDKROOT:              process.env.NDKROOT          || 'C:\\Android\\Sdk\\ndk\\27.2.12479018',
      NDK_ROOT:             process.env.NDK_ROOT         || 'C:\\Android\\Sdk\\ndk\\27.2.12479018',
      JAVA_HOME:            'C:\\Android\\jdk-17-new',
      _JAVA_OPTIONS:        '-Djava.net.preferIPv4Stack=true',
    };
    const actualBatPath = finalProjectPath ? path.join(finalProjectPath, 'BuildProject.bat') : BAT_SCRIPT_PATH;

    const batArgs = ['/c', actualBatPath, platform, config];
    if (cleanBuild)   batArgs.push('-clean');
    if (cookClean)    batArgs.push('-cookclean');

    activeBuildProcess = spawn('cmd.exe', batArgs, {
      cwd: finalProjectPath ? finalProjectPath : path.dirname(BAT_SCRIPT_PATH),
      env: batEnv
    });
    isPreparingBuild = false;

    activeBuildProcess.stdout.on('data', (d) => {
      const txt = d.toString('utf8');
      broadcast({ type: 'LOG', data: txt });
      const lines = txt.trim().split('\n').filter(Boolean);
      const errLine = lines.find(l => /error|failed|exception/i.test(l) && !/^using |^running |^log file|^total/i.test(l));
      if (errLine) lastErrorLine = errLine.trim();
    });
    activeBuildProcess.stderr.on('data', (d) => {
      const txt = d.toString('utf8');
      broadcast({ type: 'LOG_ERROR', data: txt });
      const lines = txt.trim().split('\n').filter(Boolean);
      if (lines.length > 0) lastErrorLine = lines[lines.length - 1].trim();
    });

    activeBuildProcess.on('close', async (code) => {
      const endTime         = new Date();
      const durationSeconds = Math.round((endTime - startTime) / 1000);
      let   status          = code === 0 ? 'Success' : 'Failed';
      if (isCancelling) status = 'Canceled';

      // 결과 패키지가 저장된 아카이브 절대 경로 문자열 파싱 (UI 탐색기 연동)
      let archivePath = null;
      if (status === 'Success') {
        const base = finalProjectPath || path.dirname(BAT_SCRIPT_PATH);
        archivePath = path.join(base, 'Saved', 'Builds', platform, config);
      }

      // ─── Sentry Symbol Upload (빌드 성공 시에만) ───
      let sentryStatus = null;
      if (status === 'Success' && hasSentry && STEPS.SENTRY_UPLOAD) {
        broadcast({ type: 'STEP', ...STEPS.SENTRY_UPLOAD, buildId });
        broadcast({ type: 'LOG',  data: `[Sentry] Step ${STEPS.SENTRY_UPLOAD.step}/${STEPS.SENTRY_UPLOAD.total} Debug symbol upload starting...` });
        broadcast({ type: 'LOG',  data: `[Sentry] CLI: ${sentryCli}` });
        broadcast({ type: 'LOG',  data: `[Sentry] Org: ${sentryProps.org} / Project: ${sentryProps.project}` });

        const symbolInfo = getSentrySymbolPath(finalProjectPath, projectName, platform);
        if (!symbolInfo) {
          broadcast({ type: 'LOG',  data: `[Sentry] ⚠️ Symbol path not found for platform: ${platform} — skipping upload` });
          sentryStatus = 'skipped';
        } else {
          broadcast({ type: 'LOG',  data: `[Sentry] Symbol target: ${symbolInfo.symbolPath} (${symbolInfo.description})` });
          try {
            const sentryResult = await new Promise((resolve, reject) => {
              const sentryProc = spawn(sentryCli, [
                'debug-files', 'upload',
                '--auth-token', sentryProps.authToken,
                '--org',        sentryProps.org,
                '--project',    sentryProps.project,
                symbolInfo.symbolPath
              ], {
                cwd: finalProjectPath,
                env: { ...process.env },
              });

              sentryProc.stdout.on('data', (d) => {
                const txt = d.toString('utf8').trim();
                if (txt) broadcast({ type: 'LOG', data: `[Sentry] ${txt}` });
              });
              sentryProc.stderr.on('data', (d) => {
                const txt = d.toString('utf8').trim();
                if (txt) broadcast({ type: 'LOG_ERROR', data: `[Sentry] ${txt}` });
              });
              sentryProc.on('close', (sentryCode) => resolve(sentryCode));
              sentryProc.on('error', (err) => reject(err));
            });

            if (sentryResult === 0) {
              broadcast({ type: 'LOG', data: `[Sentry] ✅ Debug symbols uploaded successfully` });
              sentryStatus = 'success';
            } else {
              broadcast({ type: 'LOG_ERROR', data: `[Sentry] ❌ Upload failed with exit code ${sentryResult}` });
              sentryStatus = 'failed';
            }
          } catch (sentryErr) {
            broadcast({ type: 'LOG_ERROR', data: `[Sentry] ❌ Error: ${sentryErr.message}` });
            sentryStatus = 'failed';
          }
        }
      } else if (status === 'Success' && !hasSentry) {
        broadcast({ type: 'LOG', data: `[Sentry] sentry.properties 또는 sentry-cli를 찾을 수 없음 — upload 생략` });
      }

      db.prepare('UPDATE builds SET status = ?, end_time = ?, duration_seconds = ? WHERE id = ?')
        .run(status, endTime.toISOString(), durationSeconds, buildId);

      broadcast({
        type:        'STATUS',
        data:        `Build ${status}`,
        code,
        durationSeconds,
        buildId,
        archivePath:  status === 'Success' ? archivePath : null,
        lastError:    status === 'Failed'  ? (lastErrorLine || null) : null,
        sentryStatus: sentryStatus,
      });

      activeBuildProcess = null;
      activeBuildId      = null;
      isCancelling       = false;
      pendingBuildContext = null;
      lastErrorLine      = '';
    });

  } catch (err) {
    isPreparingBuild    = false;
    activeBuildProcess  = null;
    activeBuildId       = null;
    isCancelling        = false;
    pendingBuildContext = null;
    broadcast({ type: 'LOG_ERROR', data: `[Error] ${err.message}` });
    broadcast({ type: 'STATUS',    data: 'Build Failed', buildId });
    db.prepare('UPDATE builds SET status = ?, end_time = ? WHERE id = ?')
      .run('Failed', new Date().toISOString(), buildId);
  }
}

// POST /api/build
app.post('/api/build', (req, res) => {
  if (activeBuildProcess || isPreparingBuild) {
    return res.status(400).json({ error: 'A build is already in progress' });
  }

  const { platform, config, enginePath, projectPath, gitRevision, cleanBuild, clearCache, cookClean } = req.body;
  if (!platform || !config) {
    return res.status(400).json({ error: 'Missing platform or config' });
  }

  const buildId          = uuidv4();
  const startTime        = new Date();
  activeBuildId          = buildId;
  isCancelling           = false;
  isPreparingBuild       = true;
  preparingBuildSince    = Date.now();
  pendingBuildContext    = null;

  db.prepare('INSERT INTO builds (id, platform, config, status, start_time) VALUES (?, ?, ?, ?, ?)')
    .run(buildId, platform, config, 'Running', startTime.toISOString());
  res.json({ message: 'Build triggered', buildId });

  (async () => {
    try {
      const finalEnginePath  = enginePath  || 'F:\\wz\\UE_CICD\\UnrealEngine\\UnrealEngine';
      const finalProjectPath = projectPath || 'F:\\wz\\UE_CICD\\SampleProject';
      const ctx = { buildId, startTime, platform, config, finalEnginePath, finalProjectPath, gitRevision, cleanBuild, clearCache, cookClean };

      // Sentry 사전 판정 (Git Check 스텝 total 표시에 필요)
      const _sentryProps = parseSentryProperties(finalProjectPath);
      const _projectName = getProjectName(finalProjectPath);
      const _sentryCli   = _sentryProps ? findSentryCli(finalProjectPath) : null;
      const _hasSentry   = !!(_sentryProps && _projectName && _sentryCli);
      const STEPS = getBuildSteps(clearCache, _hasSentry, cookClean);

      // STEP 1: 로컬 변경사항 존재 여부 확인 (충돌 방지)
      broadcast({ type: 'STEP', ...STEPS.GIT_CHECK, buildId });
      broadcast({ type: 'LOG',  data: `[Git] Step ${STEPS.GIT_CHECK.step}/${STEPS.GIT_CHECK.total} local changes check` });

      const { stdout: statusOut } = await execAsync(`git -C "${finalProjectPath}" status --porcelain`);
      const changedFiles = statusOut.trim().split('\n').filter(Boolean)
        .map(l => l.trim())
        .filter(l => !l.startsWith('?')); // untracked 파일(?)은 Git 버전에 영향을 받지 않으므로 경고하지 않음

      if (changedFiles.length > 0) {
        // 파일이 감지되었다면 리스트업 수행 후 UI 측으로 CONFIRM 트리거 발송
        broadcast({ type: 'LOG', data: `[Git] 충돌 유발 가능한 파일 개수: ${changedFiles.length}개 발견` });
        changedFiles.forEach(f => broadcast({ type: 'LOG', data: `       ${f}` }));

        pendingBuildContext = ctx;
        broadcast({
          type: 'CONFIRM_REVERT',
          buildId,
          files: changedFiles,
          message: `로컬 변경사항이 ${changedFiles.length}개 존재합니다. 모두 Revert 처리 후 빌드를 진행하시겠습니까?`
        });
        // UI의 사용자 결정(confirm 또는 cancel API 호출) 대기상태가 되므로 여기서 흐름 명시적 종료
        return;
      }

      broadcast({ type: 'LOG', data: `[Git] 로컬 환경 클린 상태. 충돌 없음` });

      await executeBuild(ctx);

    } catch (err) {
      isPreparingBuild    = false;
      activeBuildProcess  = null;
      activeBuildId       = null;
      isCancelling        = false;
      pendingBuildContext = null;
      broadcast({ type: 'LOG_ERROR', data: `[Error] ${err.message}` });
      broadcast({ type: 'STATUS',    data: 'Build Failed', buildId });
      db.prepare('UPDATE builds SET status = ?, end_time = ? WHERE id = ?')
        .run('Failed', new Date().toISOString(), buildId);
    }
  })();
});

// POST /api/build/confirm : 변경사항 강제 Revert 허용 및 빌드 파이프라인 재개
app.post('/api/build/confirm', async (req, res) => {
  if (!pendingBuildContext) {
    return res.status(400).json({ error: 'No pending build to confirm' });
  }
  const ctx = pendingBuildContext;
  pendingBuildContext = null;
  res.json({ message: 'Confirmed reverting and continuing build' });

  try {
    broadcast({ type: 'LOG', data: '[Git] Revert 餓?.. 筌뤴뫀諭?嚥≪뮇類?癰궰野껋럩沅' });
    await execAsync(`git -C "${ctx.finalProjectPath}" checkout -- .`);
    broadcast({ type: 'LOG', data: '[Git] Revert 완료. 기존 빌드 프로세스 지속' });
    await executeBuild(ctx);
  } catch (err) {
    isPreparingBuild    = false;
    activeBuildProcess  = null;
    activeBuildId       = null;
    isCancelling        = false;
    pendingBuildContext = null;
    broadcast({ type: 'LOG_ERROR', data: `[Error] Revert ${err.message}` });
    broadcast({ type: 'STATUS',    data: 'Build Failed', buildId: ctx.buildId });
    db.prepare('UPDATE builds SET status = ?, end_time = ? WHERE id = ?')
      .run('Failed', new Date().toISOString(), ctx.buildId);
  }
});

// POST /api/build/cancel
app.post('/api/build/cancel', (req, res) => {
  if (!activeBuildProcess) {
    if (isPreparingBuild) {
      isCancelling = true;
      return res.json({ message: 'Cancellation requested during preparation' });
    }
    return res.status(400).json({ error: 'No active build to cancel' });
  }
  isCancelling = true;
  spawn('taskkill', ['/pid', activeBuildProcess.pid, '/f', '/t']);
  res.json({ message: 'Cancellation requested' });
});

// POST /api/build/reset : 교착상태(Lock) 대피용 빌드 상태 강제 릴리즈 처리 기능
app.post('/api/build/reset', (req, res) => {
  const wasLocked = isPreparingBuild || !!activeBuildProcess;
  isPreparingBuild   = false;
  activeBuildProcess = null;
  activeBuildId      = null;
  isCancelling       = false;
  // DB 메모리상 남아있는 Running 상태 프로세스들을 일괄 Failed로 덤프 처리
  db.prepare(`UPDATE builds SET status = 'Failed', end_time = CURRENT_TIMESTAMP
              WHERE status = 'Running'`).run();
  res.json({ message: 'Build state reset', wasLocked });
});

// GET /api/history
app.get('/api/history', (req, res) => {
  const stmt = db.prepare('SELECT * FROM builds ORDER BY start_time DESC LIMIT 50');
  res.json(stmt.all());
});

// POST /api/open-folder Windows 轅명▽빳⒱뵛
app.post('/api/open-folder', (req, res) => {
  const { path: folderPath } = req.body;
  if (!folderPath) return res.status(400).json({ error: 'path required' });
  const { spawn } = require('child_process');
  spawn('explorer.exe', [folderPath], { detached: true, stdio: 'ignore' }).unref();
  res.json({ message: 'Opened', path: folderPath });
});

// GET /api/analytics
app.get('/api/analytics', (req, res) => {
  const totalBuilds      = db.prepare('SELECT COUNT(*) as count FROM builds').get().count;
  const successfulBuilds = db.prepare("SELECT COUNT(*) as count FROM builds WHERE status = 'Success'").get().count;
  const failedBuilds     = db.prepare("SELECT COUNT(*) as count FROM builds WHERE status = 'Failed'").get().count;
  const platformStats    = db.prepare('SELECT platform, COUNT(*) as count FROM builds GROUP BY platform').all();
  res.json({ totalBuilds, successfulBuilds, failedBuilds, platformStats });
});

server.listen(PORT, () => {
  console.log(`Build Server running on http://localhost:${PORT}`);
});
