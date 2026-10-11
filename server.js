/**
 * server.js — 字卡传讯本地服务器（零依赖，不需要安装任何东西）
 *
 * 作用：
 *   在 http://localhost:8787 提供网站访问（同源访问，没有跨域问题）
 *
 * 启动方式：双击 start-server.bat，或在命令行运行 node server.js
 * 停止方式：在窗口里按 Ctrl+C，或直接关掉窗口
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8787;
const ROOT = __dirname;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.mp3': 'audio/mpeg',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.json': 'application/json; charset=utf-8',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.m4a': 'audio/mp4'
};

// 静态文件服务
function serveStatic(req, res) {
    let urlPath;
    try { urlPath = decodeURIComponent(req.url.split('?')[0]); } catch (e) { urlPath = '/'; }
    if (urlPath === '/') urlPath = '/index.html';
    const filePath = path.join(ROOT, urlPath);
    // 防止目录穿越攻击
    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403); res.end('Forbidden');
        return;
    }
    fs.readFile(filePath, function (err, data) {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('404 Not Found');
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
    });
}

http.createServer(function (req, res) {
    serveStatic(req, res);
}).listen(PORT, function () {
    console.log('==============================================');
    console.log('  字卡传讯本地服务已启动');
    console.log('');
    console.log('  请在浏览器打开:  http://localhost:' + PORT);
    console.log('');
    console.log('  停止服务：按 Ctrl+C 或直接关闭本窗口');
    console.log('==============================================');
});
