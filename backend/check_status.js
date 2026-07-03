const db = require('better-sqlite3')('build_history.db');
const rows = db.prepare('SELECT id, platform, config, status, start_time FROM builds ORDER BY start_time DESC LIMIT 5').all();
console.log(JSON.stringify(rows, null, 2));
