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

const app = express();
app.use(cors());
app.use(express.json());

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

// 類ㅼ뮅 戮곗굚 怨몄쓧 リ턁筌앸렇Running Failed筌먲퐘遊?
db.prepare(`UPDATE builds SET status = 'Failed', end_time = CURRENT_TIMESTAMP
            WHERE status = 'Running'`).run();

// 서버 재시작 시 빌드 플래그 강제 리셋 (비정상 종료 대비)
isPreparingBuild   = false;
activeBuildProcess = null;
isCancelling       = false;

// GET /api/git/refs
app.get('/api/git/refs', async (req, res) => {
  const repoPath = req.query.path || 'F:\\wz\\UE_CICD\\SampleProject';
  try {
    // ?熬곣뫗HEAD 戮ャ럦?    let currentBranch = '';
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
        .filter(line => !line.includes('HEAD') && line.includes('/'))  // HEAD ⑸츎 戮곕뇶
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
        .filter(b => !localNames.has(b.name));          // ?β돦裕뉛쭚濾?繞벿살탮戮곕뇶
    } catch (_) {}

    const branches = [...localBranches, ...remoteBranches];

    // 蹂μ쟽 嶺뚮ㅄ維뽨빳?
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
const BUILD_STEPS = {
  GIT_CHECK:   { step: 1, total: 5, label: 'Git Check'    },
  GIT_FETCH:   { step: 2, total: 5, label: 'Git Fetch'    },
  GIT_SWITCH:  { step: 3, total: 5, label: 'Git Checkout' },
  GIT_PULL:    { step: 4, total: 5, label: 'Git Pull'     },
  BUILD_START: { step: 5, total: 5, label: 'Build'        },
};

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
  const { buildId, startTime, platform, config, finalEnginePath, finalProjectPath, gitRevision } = ctx;
  try {
    // -- PHASE 1: Git sync (always runs) ------------------------------------------

    // STEP 2/5 - git fetch --all
    broadcast({ type: 'STEP', ...BUILD_STEPS.GIT_FETCH, buildId });
    broadcast({ type: 'LOG',  data: `[Git] Step 2/5 fetch --all` });
    await execAsync(`git -C "${finalProjectPath}" fetch --all`);
    broadcast({ type: 'LOG',  data: `[Git] fetch complete`});
    if (isCancelling) throw new Error('Canceled during git fetch');

    if (gitRevision) {
      // STEP 3/5 - checkout specified revision
      broadcast({ type: 'STEP', ...BUILD_STEPS.GIT_SWITCH, buildId });
      broadcast({ type: 'LOG',  data: `[Git] Step 3/5 checkout: ${gitRevision}` });
      const { stdout: localList } = await execAsync(`git -C "${finalProjectPath}" branch --list "${gitRevision}"`);
      const isLocalBranch = localList.trim().length > 0;
      const { stdout: remoteList } = await execAsync(`git -C "${finalProjectPath}" branch -r --list "origin/${gitRevision}"`);
      const isRemoteOnly = !isLocalBranch && remoteList.trim().length > 0;
      if (isRemoteOnly) {
        await execAsync(`git -C "${finalProjectPath}" checkout -B "${gitRevision}" --track "origin/${gitRevision}"`);
        broadcast({ type: 'LOG', data: `[Git] 洹먮맓嫄β돦裕뉛쭚筌뤾퍔戮ャ럦諛댁뎽 checkout: ${gitRevision}` });
      } else {
        await execAsync(`git -C "${finalProjectPath}" checkout ${gitRevision}`);
        broadcast({ type: 'LOG', data: `[Git] checkout ?熬곣뫁});
      }
      if (isCancelling) throw new Error('Canceled during git checkout');

      // STEP 4/5 - pull if branch
      const isBranch = await isBranchName(finalProjectPath, gitRevision);
      if (isBranch) {
        broadcast({ type: 'STEP', ...BUILD_STEPS.GIT_PULL, buildId });
        broadcast({ type: 'LOG',  data: `[Git] Step 4/5 pull (branch: ${finalBranch})` });
        await execAsync(`git -C "${finalProjectPath}" pull`);
        broadcast({ type: 'LOG',  data: `[Git] pull ?熬곣뫁});
        if (isCancelling) throw new Error('Canceled during git pull');
      } else {
        broadcast({ type: 'LOG', data: `[Git] Step 4/5 pull (detached HEAD / tag)` });
      }

    } else {
      // HEAD mode: no checkout, but still fetch+pull current branch for latest commits
      broadcast({ type: 'STEP', ...BUILD_STEPS.GIT_SWITCH, buildId });
      broadcast({ type: 'LOG',  data: `[Git] Step 3/5 HEAD (checkout )` });

      let currentBranch = '';
      try {
        const { stdout: abbrev } = await execAsync(`git -C "${finalProjectPath}" rev-parse --abbrev-ref HEAD`);
        currentBranch = abbrev.trim();
      } catch (_) {}

      if (currentBranch && currentBranch !== 'HEAD') {
        broadcast({ type: 'STEP', ...BUILD_STEPS.GIT_PULL, buildId });
        broadcast({ type: 'LOG',  data: `[Git] Step 4/5 pull (branch: ${finalBranch})` });
        await execAsync(`git -C "${finalProjectPath}" pull`);
        broadcast({ type: 'LOG',  data: `[Git] pull ?熬곣뫁});
        if (isCancelling) throw new Error('Canceled during git pull');
      } else {
        broadcast({ type: 'LOG', data: `[Git] Step 4/5 pull (detached HEAD ⑤객臾?` });
      }
    }

    // Final HEAD info (always shown)
    {
      const { stdout: headSha } = await execAsync(`git -C "${finalProjectPath}" rev-parse --short HEAD`);
      const { stdout: headMsg } = await execAsync(`git -C "${finalProjectPath}" log -1 --pretty=format:"%s"`);
      broadcast({ type: 'LOG',      data: `[Git] Latest commit HEAD: ${headSha.trim()} "${headMsg.trim()}""` });
      broadcast({ type: 'GIT_DONE', buildId });
    }
    // PHASE 2: キbroadcast({ type: 'STEP', ...BUILD_STEPS.BUILD_START, buildId });
    broadcast({ type: 'LOG',  data: `[Build] Step 5/5 BAT run (${platform} / ${config})` });

    const batEnv        = {
      ...process.env,
      ENGINE_DIR_OVERRIDE:  finalEnginePath,
      PROJECT_DIR_OVERRIDE: finalProjectPath,
      // Android SDK User 六熬곣뫁夷?筌뤾쑬裕亦껋꼶梨fallback
      ANDROID_HOME:         process.env.ANDROID_HOME     || 'C:\\Android\\Sdk',
      ANDROID_SDK_ROOT:     process.env.ANDROID_SDK_ROOT || 'C:\\Android\\Sdk',
      NDKROOT:              process.env.NDKROOT          || 'C:\\Android\\Sdk\\ndk\\27.2.12479018',
      NDK_ROOT:             process.env.NDK_ROOT         || 'C:\\Android\\Sdk\\ndk\\27.2.12479018',
      JAVA_HOME:            process.env.JAVA_HOME        || 'C:\\Android\\jdk-17-new',
    };
    const actualBatPath = finalProjectPath ? path.join(finalProjectPath, 'BuildProject.bat') : BAT_SCRIPT_PATH;

    activeBuildProcess = spawn('cmd.exe', ['/c', actualBatPath, platform, config], {
      cwd: finalProjectPath ? finalProjectPath : path.dirname(BAT_SCRIPT_PATH),
      env: batEnv
    });
    isPreparingBuild = false;

    activeBuildProcess.stdout.on('data', (d) => {
      const txt = iconv.decode(d, 'cp949');
      broadcast({ type: 'LOG', data: txt });
      const lines = txt.trim().split('\n').filter(Boolean);
      const errLine = lines.find(l => /error|failed|exception/i.test(l) && !/^using |^running |^log file|^total/i.test(l));
      if (errLine) lastErrorLine = errLine.trim();
    });
    activeBuildProcess.stderr.on('data', (d) => {
      const txt = iconv.decode(d, 'cp949');
      broadcast({ type: 'LOG_ERROR', data: txt });
      const lines = txt.trim().split('\n').filter(Boolean);
      if (lines.length > 0) lastErrorLine = lines[lines.length - 1].trim();
    });

    activeBuildProcess.on('close', (code) => {
      const endTime         = new Date();
      const durationSeconds = Math.round((endTime - startTime) / 1000);
      let   status          = code === 0 ? 'Success' : 'Failed';
      if (isCancelling) status = 'Canceled';

      // ?熬곣뫖異δ빳ｌ뫒亦?(?繹먭퍓沅let archivePath = null;
      if (status === 'Success') {
        const pathLib = require('path');
        const base = finalProjectPath || pathLib.dirname(BAT_SCRIPT_PATH);
        archivePath = pathLib.join(base, 'Saved', 'Builds', platform, config);
      }

      db.prepare('UPDATE builds SET status = ?, end_time = ?, duration_seconds = ? WHERE id = ?')
        .run(status, endTime.toISOString(), durationSeconds, buildId);

      broadcast({
        type:        'STATUS',
        data:        `Build ${status}`,
        code,
        durationSeconds,
        buildId,
        archivePath: status === 'Success' ? archivePath : null,
        lastError:   status === 'Failed'  ? (lastErrorLine || null) : null,
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

  const { platform, config, enginePath, projectPath, gitRevision } = req.body;
  if (!platform || !config) {
    return res.status(400).json({ error: 'Missing platform or config' });
  }

  const buildId          = uuidv4();
  const startTime        = new Date();
  activeBuildId          = buildId;
  isCancelling           = false;
  isPreparingBuild       = true;
  pendingBuildContext    = null;

  db.prepare('INSERT INTO builds (id, platform, config, status, start_time) VALUES (?, ?, ?, ?, ?)')
    .run(buildId, platform, config, 'Running', startTime.toISOString());
  res.json({ message: 'Build triggered', buildId });

  (async () => {
    try {
      const finalEnginePath  = enginePath  || 'F:\\wz\\UE_CICD\\UnrealEngine\\UnrealEngine';
      const finalProjectPath = projectPath || 'F:\\wz\\UE_CICD\\SampleProject';
      const ctx = { buildId, startTime, platform, config, finalEnginePath, finalProjectPath, gitRevision };

      // STEP 1/5: ?β돦裕뉛쭚⒵쾮嶺뚳퐢?얍칰broadcast({ type: 'STEP', ...BUILD_STEPS.GIT_CHECK, buildId });
      broadcast({ type: 'LOG',  data: `[Git] Step 1/5 local changes check` });

      const { stdout: statusOut } = await execAsync(`git -C "${finalProjectPath}" status --porcelain`);
      const changedFiles = statusOut.trim().split('\n').filter(Boolean)
        .map(l => l.trim())
        .filter(l => !l.startsWith('')); // untracked 逾戮곕뇶 (?怨뺣뾼⒵쾮壤?

      if (changedFiles.length > 0) {
        // ?곌떠⒵쾮熬곣뫁夷?筌뤾쑬筌먦끉逾broadcast({ type: 'LOG', data: `[Git] ο쭕逾?${changedFiles.length}` });
        changedFiles.forEach(f => broadcast({ type: 'LOG', data: `       ${f}` }));

        pendingBuildContext = ctx;
        broadcast({
          type: 'CONFIRM_REVERT',
          buildId,
          files: changedFiles,
          message: `?β돦裕뉛쭚⒵쾮${changedFiles.length}?띠룇裕? . Revert キ?꾨ご?嶺뚯쉳?듸쭛琉용뻣?롪퍔伊`
        });
        // 袁⑸쐩 /api/build/confirm 裕?/api/build/cancel return;
      }

      broadcast({ type: 'LOG', data: `[Git] ⒵쾮怨몃쾳 餓?嶺뚯쉳?듸쭛? });
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

// POST /api/build/confirm Revert ?筌먦끉逾キ
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
    broadcast({ type: 'LOG', data: '[Git] Revert ?袁⑥┷. 諭띄몴' });
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

// POST /api/build/reset 踰貫?껆뵳(
app.post('/api/build/reset', (req, res) => {
  const wasLocked = isPreparingBuild || !!activeBuildProcess;
  isPreparingBuild   = false;
  activeBuildProcess = null;
  activeBuildId      = null;
  isCancelling       = false;
  // DB Running 類ｌ┣ ?筌먲퐘遊?
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
