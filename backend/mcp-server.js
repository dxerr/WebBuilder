#!/usr/bin/env node
/**
 * UE_Web_Builder MCP Server (stdio transport)
 *
 * 역할: 기존 Express 백엔드(index.js :3001)를 그대로 유지하면서
 *       Claude Desktop이 stdio로 연결할 수 있는 MCP 서버 레이어를 추가한다.
 *
 * 모든 도구는 내부적으로 http://localhost:3001/api/* 를 호출하거나
 * SQLite DB / 로그 파일을 직접 읽는다.
 *
 * 실행 전 선행 조건:
 *   1. backend/index.js 가 :3001 포트로 이미 실행 중이어야 한다.
 *   2. node mcp-server.js  (Claude Desktop이 자동 실행)
 */

'use strict';

const { McpServer }          = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z }                  = require('zod');
const http                   = require('http');
const fs                     = require('fs');
const path                   = require('path');
const Database               = require('better-sqlite3');

// ─── 설정 ────────────────────────────────────────────────────────────────────
const BACKEND_HOST = process.env.UE_BACKEND_HOST || 'localhost';
const BACKEND_PORT = parseInt(process.env.UE_BACKEND_PORT || '3001', 10);
const DB_PATH      = path.join(__dirname, 'build_history.db');

// ─── 내부 유틸 ───────────────────────────────────────────────────────────────

/** Express 백엔드 REST API 호출 헬퍼 */
function apiCall(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: BACKEND_HOST,
      port:     BACKEND_PORT,
      path:     pathname,
      method,
      headers:  {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** 백엔드 서버 생존 여부 확인 */
async function isBackendAlive() {
  try {
    const r = await apiCall('GET', '/api/history');
    return r.status === 200;
  } catch {
    return false;
  }
}

/** SQLite DB 직접 조회 (백엔드 없이도 이력 읽기 가능) */
function openDb() {
  if (!fs.existsSync(DB_PATH)) return null;
  try { return new Database(DB_PATH, { readonly: true, fileMustExist: true }); }
  catch { return null; }
}

// ─── MCP 서버 생성 ───────────────────────────────────────────────────────────
const server = new McpServer({
  name:    'ue-web-builder',
  version: '1.0.0',
});

// ════════════════════════════════════════════════════════════════════════════
// 도구 1: trigger_build — 빌드 시작
// ════════════════════════════════════════════════════════════════════════════
server.registerTool(
  'trigger_build',
  {
    title:       '빌드 시작',
    description: 'Unreal Engine 빌드를 시작합니다. 플랫폼·설정·Git 리비전·빌드 옵션을 지정할 수 있습니다.',
    inputSchema: {
      platform: z.enum(['Win64', 'Win64Server', 'Android', 'IOS'])
        .describe('빌드 대상 플랫폼'),
      config: z.enum(['Development', 'Debug', 'Test', 'Shipping'])
        .describe('빌드 설정'),
      enginePath: z.string().optional()
        .describe('UE 엔진 경로 (생략 시 서버 기본값 사용)'),
      projectPath: z.string().optional()
        .describe('UE 프로젝트 경로 (생략 시 서버 기본값 사용)'),
      gitRevision: z.string().optional()
        .describe('체크아웃할 브랜치명·태그명·커밋 해시 (생략 시 현재 HEAD)'),
      cleanBuild: z.boolean().optional().default(false)
        .describe('true: C++ 포함 전체 풀리빌드 (-clean 플래그)'),
      cookClean: z.boolean().optional().default(false)
        .describe('true: 셰이더·에셋 쿠킹 캐시만 삭제 후 재쿡 (C++ 생략)'),
      clearCache: z.boolean().optional().default(false)
        .describe('true: Intermediate/Saved/Binaries 전체 삭제 후 풀빌드'),
    },
  },
  async ({ platform, config, enginePath, projectPath, gitRevision, cleanBuild, cookClean, clearCache }) => {
    if (!(await isBackendAlive())) {
      return { content: [{ type: 'text', text: '❌ 백엔드 서버(:3001)에 연결할 수 없습니다. node index.js 를 먼저 실행하세요.' }] };
    }
    const r = await apiCall('POST', '/api/build', {
      platform, config, enginePath, projectPath,
      gitRevision: gitRevision || '',
      cleanBuild:  !!cleanBuild,
      cookClean:   !!cookClean,
      clearCache:  !!clearCache,
    });
    if (r.status === 200) {
      const { buildId } = r.body;
      return {
        content: [{
          type: 'text',
          text: [
            `✅ 빌드가 시작되었습니다.`,
            `• BuildID : ${buildId}`,
            `• Platform: ${platform} / ${config}`,
            gitRevision ? `• Revision : ${gitRevision}` : `• Revision : HEAD (현재 브랜치)`,
            cleanBuild  ? `• 옵션     : Clean Build` : '',
            cookClean   ? `• 옵션     : Cook Clean`  : '',
            clearCache  ? `• 옵션     : Clear Cache` : '',
            `\n진행 상황은 get_build_status 도구로 확인하세요.`,
          ].filter(Boolean).join('\n'),
        }],
      };
    }
    return {
      content: [{ type: 'text', text: `❌ 빌드 시작 실패 (HTTP ${r.status}): ${JSON.stringify(r.body)}` }],
    };
  },
);

// ════════════════════════════════════════════════════════════════════════════
// 도구 2: get_build_status — 최신 빌드 상태 조회
// ════════════════════════════════════════════════════════════════════════════
server.registerTool(
  'get_build_status',
  {
    title:       '빌드 상태 조회',
    description: '현재 진행 중이거나 가장 최근 빌드의 상태를 조회합니다.',
    inputSchema: {
      buildId: z.string().optional()
        .describe('특정 BuildID 지정 (생략 시 가장 최근 빌드)'),
    },
  },
  async ({ buildId }) => {
    const db = openDb();
    if (!db) {
      return { content: [{ type: 'text', text: '❌ DB 파일을 열 수 없습니다.' }] };
    }
    try {
      const row = buildId
        ? db.prepare('SELECT * FROM builds WHERE id = ?').get(buildId)
        : db.prepare('SELECT * FROM builds ORDER BY start_time DESC LIMIT 1').get();

      if (!row) {
        return { content: [{ type: 'text', text: '조회 결과가 없습니다.' }] };
      }

      const statusIcon = { Success: '✅', Failed: '❌', Running: '🔄', Canceled: '⛔' }[row.status] || '❓';
      const dur = row.duration_seconds != null ? `${row.duration_seconds}초` : '진행 중';

      return {
        content: [{
          type: 'text',
          text: [
            `${statusIcon} 빌드 상태: **${row.status}**`,
            `• BuildID  : ${row.id}`,
            `• Platform : ${row.platform} / ${row.config}`,
            `• 시작     : ${row.start_time}`,
            `• 종료     : ${row.end_time || '아직 진행 중'}`,
            `• 소요시간 : ${dur}`,
            row.log_file ? `• 로그경로 : ${row.log_file}` : '',
          ].filter(Boolean).join('\n'),
        }],
      };
    } finally {
      db.close();
    }
  },
);

// ════════════════════════════════════════════════════════════════════════════
// 도구 3: cancel_build — 빌드 강제 취소
// ════════════════════════════════════════════════════════════════════════════
server.registerTool(
  'cancel_build',
  {
    title:       '빌드 취소',
    description: '현재 진행 중인 빌드를 강제로 취소합니다.',
    inputSchema: {},
  },
  async () => {
    if (!(await isBackendAlive())) {
      return { content: [{ type: 'text', text: '❌ 백엔드 서버(:3001)에 연결할 수 없습니다.' }] };
    }
    const r = await apiCall('POST', '/api/build/cancel');
    if (r.status === 200) {
      return { content: [{ type: 'text', text: `⛔ 빌드 취소 요청을 전송했습니다.\n${JSON.stringify(r.body)}` }] };
    }
    return { content: [{ type: 'text', text: `❌ 취소 실패 (HTTP ${r.status}): ${JSON.stringify(r.body)}` }] };
  },
);

// ════════════════════════════════════════════════════════════════════════════
// 도구 4: confirm_revert — 로컬 변경사항 Revert 후 빌드 재개
// ════════════════════════════════════════════════════════════════════════════
server.registerTool(
  'confirm_revert',
  {
    title:       'Revert 후 빌드 재개',
    description: '빌드 시작 시 로컬 변경사항이 감지되어 대기 중일 때, Revert를 승인하고 빌드를 재개합니다.',
    inputSchema: {},
  },
  async () => {
    if (!(await isBackendAlive())) {
      return { content: [{ type: 'text', text: '❌ 백엔드 서버(:3001)에 연결할 수 없습니다.' }] };
    }
    const r = await apiCall('POST', '/api/build/confirm');
    if (r.status === 200) {
      return { content: [{ type: 'text', text: `✅ Revert 승인 완료. 빌드를 재개합니다.\n${JSON.stringify(r.body)}` }] };
    }
    return { content: [{ type: 'text', text: `❌ 실패 (HTTP ${r.status}): ${JSON.stringify(r.body)}` }] };
  },
);

// ════════════════════════════════════════════════════════════════════════════
// 도구 5: reset_build_lock — 빌드 락 강제 해제
// ════════════════════════════════════════════════════════════════════════════
server.registerTool(
  'reset_build_lock',
  {
    title:       '빌드 락 강제 해제',
    description: '빌드가 비정상 종료되어 새 빌드를 시작할 수 없을 때 상태를 강제로 초기화합니다.',
    inputSchema: {},
  },
  async () => {
    if (!(await isBackendAlive())) {
      return { content: [{ type: 'text', text: '❌ 백엔드 서버(:3001)에 연결할 수 없습니다.' }] };
    }
    const r = await apiCall('POST', '/api/build/reset');
    return {
      content: [{
        type: 'text',
        text: r.status === 200
          ? `✅ 빌드 락 해제 완료. wasLocked=${r.body.wasLocked}`
          : `❌ 실패 (HTTP ${r.status}): ${JSON.stringify(r.body)}`,
      }],
    };
  },
);

// ════════════════════════════════════════════════════════════════════════════
// 도구 6: list_git_refs — 브랜치/태그 목록 조회
// ════════════════════════════════════════════════════════════════════════════
server.registerTool(
  'list_git_refs',
  {
    title:       'Git 브랜치·태그 목록',
    description: '프로젝트 저장소의 로컬·리모트 브랜치와 태그 목록을 조회합니다.',
    inputSchema: {
      projectPath: z.string().optional()
        .describe('Git 저장소 경로 (생략 시 서버 기본 프로젝트 경로)'),
    },
  },
  async ({ projectPath }) => {
    if (!(await isBackendAlive())) {
      return { content: [{ type: 'text', text: '❌ 백엔드 서버(:3001)에 연결할 수 없습니다.' }] };
    }
    const qs = projectPath ? `?path=${encodeURIComponent(projectPath)}` : '';
    const r  = await apiCall('GET', `/api/git/refs${qs}`);
    if (r.status !== 200) {
      return { content: [{ type: 'text', text: `❌ Git 조회 실패 (HTTP ${r.status}): ${JSON.stringify(r.body)}` }] };
    }
    const { branches, tags, currentBranch } = r.body;

    const localBranches  = branches.filter(b => !b.remote);
    const remoteBranches = branches.filter(b =>  b.remote);

    const lines = [
      `📌 현재 브랜치: **${currentBranch}**`,
      '',
      `## 로컬 브랜치 (${localBranches.length}개)`,
      ...localBranches.map(b =>
        `• ${b.isCurrent ? '★ ' : '  '}${b.name}  [${b.hash}]  ${b.time}  — ${b.message || ''}`.trim()
      ),
    ];

    if (remoteBranches.length > 0) {
      lines.push('', `## 리모트 전용 브랜치 (${remoteBranches.length}개)`);
      lines.push(...remoteBranches.map(b =>
        `• [remote] ${b.name}  [${b.hash}]  ${b.time}  — ${b.message || ''}`.trim()
      ));
    }

    if (tags.length > 0) {
      lines.push('', `## 태그 (${tags.length}개)`);
      lines.push(...tags.slice(0, 20).map(t =>
        `• ${t.name}  [${t.hash}]  ${t.time}`.trim()
      ));
      if (tags.length > 20) lines.push(`  ... 외 ${tags.length - 20}개`);
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },
);

// ════════════════════════════════════════════════════════════════════════════
// 도구 7: get_build_history — 빌드 이력 조회
// ════════════════════════════════════════════════════════════════════════════
server.registerTool(
  'get_build_history',
  {
    title:       '빌드 이력 조회',
    description: '최근 빌드 이력을 조회합니다. 플랫폼·상태로 필터링할 수 있습니다.',
    inputSchema: {
      limit: z.number().int().min(1).max(50).optional().default(10)
        .describe('조회할 최대 건수 (기본값 10, 최대 50)'),
      platform: z.enum(['Win64', 'Win64Server', 'Android', 'IOS']).optional()
        .describe('특정 플랫폼 필터 (생략 시 전체)'),
      status: z.enum(['Success', 'Failed', 'Running', 'Canceled']).optional()
        .describe('특정 상태 필터 (생략 시 전체)'),
    },
  },
  async ({ limit, platform, status }) => {
    const db = openDb();
    if (!db) {
      return { content: [{ type: 'text', text: '❌ DB 파일을 열 수 없습니다.' }] };
    }
    try {
      const conditions = [];
      const params     = [];
      if (platform) { conditions.push('platform = ?'); params.push(platform); }
      if (status)   { conditions.push('status = ?');   params.push(status);   }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const rows  = db.prepare(
        `SELECT * FROM builds ${where} ORDER BY start_time DESC LIMIT ?`
      ).all(...params, limit ?? 10);

      if (rows.length === 0) {
        return { content: [{ type: 'text', text: '조건에 맞는 빌드 이력이 없습니다.' }] };
      }

      const statusIcon = { Success: '✅', Failed: '❌', Running: '🔄', Canceled: '⛔' };
      const lines = [
        `## 빌드 이력 (${rows.length}건)`,
        '',
        ...rows.map((r, i) => {
          const icon = statusIcon[r.status] || '❓';
          const dur  = r.duration_seconds != null ? `${r.duration_seconds}s` : '-';
          return `${i + 1}. ${icon} **${r.status}**  ${r.platform}/${r.config}  ${dur}  ${r.start_time?.slice(0, 16) || ''}  ID:${r.id.slice(0, 8)}`;
        }),
      ];

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } finally {
      db.close();
    }
  },
);

// ════════════════════════════════════════════════════════════════════════════
// 도구 8: get_analytics — 통계 조회
// ════════════════════════════════════════════════════════════════════════════
server.registerTool(
  'get_analytics',
  {
    title:       '빌드 통계',
    description: '총 빌드 수, 성공률, 플랫폼별 분포 등 집계 통계를 조회합니다.',
    inputSchema: {},
  },
  async () => {
    const db = openDb();
    if (!db) {
      return { content: [{ type: 'text', text: '❌ DB 파일을 열 수 없습니다.' }] };
    }
    try {
      const total    = db.prepare("SELECT COUNT(*) as c FROM builds").get().c;
      const success  = db.prepare("SELECT COUNT(*) as c FROM builds WHERE status='Success'").get().c;
      const failed   = db.prepare("SELECT COUNT(*) as c FROM builds WHERE status='Failed'").get().c;
      const canceled = db.prepare("SELECT COUNT(*) as c FROM builds WHERE status='Canceled'").get().c;
      const running  = db.prepare("SELECT COUNT(*) as c FROM builds WHERE status='Running'").get().c;
      const rate     = total > 0 ? ((success / total) * 100).toFixed(1) : '0.0';

      const platformStats = db.prepare(
        "SELECT platform, COUNT(*) as cnt FROM builds GROUP BY platform ORDER BY cnt DESC"
      ).all();

      const avgDur = db.prepare(
        "SELECT AVG(duration_seconds) as avg FROM builds WHERE status='Success' AND duration_seconds IS NOT NULL"
      ).get();

      const lines = [
        `## 빌드 통계 요약`,
        `• 총 빌드    : ${total}회`,
        `• 성공       : ${success}회`,
        `• 실패       : ${failed}회`,
        `• 취소       : ${canceled}회`,
        `• 진행 중    : ${running}회`,
        `• 성공률     : ${rate}%`,
        avgDur.avg ? `• 평균소요시간: ${Math.round(avgDur.avg)}초 (성공 빌드 기준)` : '',
        '',
        `## 플랫폼별 빌드 수`,
        ...platformStats.map(p => `• ${p.platform}: ${p.cnt}회`),
      ].filter(l => l !== undefined);

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } finally {
      db.close();
    }
  },
);

// ════════════════════════════════════════════════════════════════════════════
// 도구 9: read_build_log — 빌드 로그 파일 읽기 및 분석
// ════════════════════════════════════════════════════════════════════════════
server.registerTool(
  'read_build_log',
  {
    title:       '빌드 로그 읽기',
    description: '저장된 빌드 로그 파일을 읽습니다. BuildID 지정 시 해당 로그를 자동으로 찾습니다.',
    inputSchema: {
      buildId: z.string().optional()
        .describe('로그를 읽을 BuildID (생략 시 가장 최근 빌드)'),
      tailLines: z.number().int().min(10).max(500).optional().default(100)
        .describe('로그 끝부분 줄 수 (기본값 100, 최대 500)'),
      filterErrors: z.boolean().optional().default(false)
        .describe('true: Error/Warning 라인만 필터링'),
    },
  },
  async ({ buildId, tailLines, filterErrors }) => {
    const db = openDb();
    if (!db) {
      return { content: [{ type: 'text', text: '❌ DB 파일을 열 수 없습니다.' }] };
    }

    let logFile;
    try {
      const row = buildId
        ? db.prepare('SELECT log_file, status, platform, config FROM builds WHERE id = ?').get(buildId)
        : db.prepare('SELECT log_file, status, platform, config FROM builds ORDER BY start_time DESC LIMIT 1').get();

      if (!row) {
        return { content: [{ type: 'text', text: '빌드 이력이 없습니다.' }] };
      }
      logFile = row.log_file;

      if (!logFile || !fs.existsSync(logFile)) {
        return { content: [{ type: 'text', text: `로그 파일이 존재하지 않습니다: ${logFile || '(경로 없음)'}` }] };
      }

      const content = fs.readFileSync(logFile, 'utf8');
      let lines     = content.split('\n');

      if (filterErrors) {
        lines = lines.filter(l => /: Error:|: Warning:|^\[Error\]|\[STDERR\]/i.test(l));
      }

      const total = lines.length;
      const n     = tailLines ?? 100;
      const sliced = lines.slice(-n);

      return {
        content: [{
          type: 'text',
          text: [
            `## 빌드 로그  (${row.platform}/${row.config} · ${row.status})`,
            `📄 ${logFile}`,
            `표시: 마지막 ${sliced.length}줄 / 전체 ${total}줄${filterErrors ? ' (Error/Warning 필터)' : ''}`,
            '```',
            sliced.join('\n'),
            '```',
          ].join('\n'),
        }],
      };
    } finally {
      db.close();
    }
  },
);

// ════════════════════════════════════════════════════════════════════════════
// 도구 10: read_issue_report — Issue 리포트 읽기
// ════════════════════════════════════════════════════════════════════════════
server.registerTool(
  'read_issue_report',
  {
    title:       'Issue 리포트 읽기',
    description: '빌드 완료 후 자동 생성된 Warning/Error 필터링 리포트(Markdown)를 읽습니다.',
    inputSchema: {
      buildId: z.string().optional()
        .describe('리포트를 읽을 BuildID (생략 시 가장 최근 빌드)'),
      projectPath: z.string().optional()
        .describe('UE 프로젝트 경로 (생략 시 DB 로그 경로에서 자동 추론)'),
    },
  },
  async ({ buildId, projectPath }) => {
    const db = openDb();
    if (!db) {
      return { content: [{ type: 'text', text: '❌ DB 파일을 열 수 없습니다.' }] };
    }
    try {
      const row = buildId
        ? db.prepare('SELECT * FROM builds WHERE id = ?').get(buildId)
        : db.prepare('SELECT * FROM builds ORDER BY start_time DESC LIMIT 1').get();

      if (!row) {
        return { content: [{ type: 'text', text: '빌드 이력이 없습니다.' }] };
      }

      // log_file 경로에서 issue 폴더 경로 추론
      // 예: .../Saved/Builds/Win64/Development/Log/build_xxx.log
      //  → .../Saved/Builds/Win64/Development/Issue/
      let issueDir = null;
      if (row.log_file) {
        const logDir = path.dirname(row.log_file);
        issueDir = path.join(path.dirname(logDir), 'Issue');
      } else if (projectPath) {
        issueDir = path.join(projectPath, 'Saved', 'Builds', row.platform, row.config, 'Issue');
      }

      if (!issueDir || !fs.existsSync(issueDir)) {
        return { content: [{ type: 'text', text: `Issue 폴더를 찾을 수 없습니다: ${issueDir || '(경로 추론 불가)'}` }] };
      }

      const files = fs.readdirSync(issueDir)
        .filter(f => f.startsWith('issue_') && f.endsWith('.md'))
        .sort()
        .reverse();

      if (files.length === 0) {
        return { content: [{ type: 'text', text: `Issue 리포트 파일이 없습니다. (${issueDir})` }] };
      }

      const latestFile    = path.join(issueDir, files[0]);
      const reportContent = fs.readFileSync(latestFile, 'utf8');

      return {
        content: [{
          type: 'text',
          text: [
            `## Issue 리포트  (${row.platform}/${row.config})`,
            `📄 ${latestFile}`,
            '',
            reportContent,
          ].join('\n'),
        }],
      };
    } finally {
      db.close();
    }
  },
);

// ════════════════════════════════════════════════════════════════════════════
// 도구 11: get_server_status — 백엔드 서버 및 빌드 환경 상태 확인
// ════════════════════════════════════════════════════════════════════════════
server.registerTool(
  'get_server_status',
  {
    title:       '서버 상태 확인',
    description: '백엔드 서버 생존 여부와 현재 진행 중인 빌드가 있는지 확인합니다.',
    inputSchema: {},
  },
  async () => {
    const alive = await isBackendAlive();
    const lines = [
      `## UE Web Builder 서버 상태`,
      `• 백엔드 서버 (:${BACKEND_PORT}): ${alive ? '🟢 온라인' : '🔴 오프라인'}`,
    ];

    if (alive) {
      const db = openDb();
      if (db) {
        try {
          const running = db.prepare("SELECT COUNT(*) as c FROM builds WHERE status='Running'").get().c;
          const latest  = db.prepare("SELECT * FROM builds ORDER BY start_time DESC LIMIT 1").get();
          lines.push(`• 진행 중 빌드: ${running > 0 ? `🔄 ${running}개 실행 중` : '없음'}`);
          if (latest) {
            const icon = { Success: '✅', Failed: '❌', Running: '🔄', Canceled: '⛔' }[latest.status] || '❓';
            lines.push(`• 최근 빌드   : ${icon} ${latest.status}  ${latest.platform}/${latest.config}  ${latest.start_time?.slice(0, 16) || ''}`);
          }
        } finally {
          db.close();
        }
      }
    } else {
      lines.push('');
      lines.push('ℹ️  백엔드를 시작하려면: cd backend && node index.js');
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },
);

// ─── 시작 ────────────────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio 모드에서는 console.log가 MCP 프로토콜을 오염시키므로 stderr만 사용
  process.stderr.write('[UE-MCP] UE Web Builder MCP Server started (stdio)\n');
}

main().catch((err) => {
  process.stderr.write(`[UE-MCP] Fatal error: ${err.message}\n`);
  process.exit(1);
});
