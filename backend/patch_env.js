const fs = require('fs');
const file = 'F:/wz/UE_CICD/UE_Web_Builder/backend/index.js';
let content = fs.readFileSync(file, 'utf8');

const target = "JAVA_HOME:            process.env.JAVA_HOME        || 'C:\\\\Android\\\\jdk-17-new',";
const replacement = "JAVA_HOME:            'C:\\\\Android\\\\jdk-17-new',\n      _JAVA_OPTIONS:        '-Djava.net.preferIPv4Stack=true',";

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(file, content, 'utf8');
    console.log("Successfully patched index.js");
} else {
    console.error("Target string not found in index.js");
    process.exit(1);
}
