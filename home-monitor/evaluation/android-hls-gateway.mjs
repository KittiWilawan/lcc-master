import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { spawn } from 'node:child_process';

const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
const root = resolve(config.root);
const cases = JSON.parse(await readFile(resolve(root, 'cases.json'), 'utf8'));
let paused = false;
await mkdir(resolve(root, 'live'), { recursive: true });
const live = spawn(config.ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-y', '-re', '-stream_loop', '-1', '-i', config.liveVideo,
  '-an', '-vf', `scale=${config.maxDimension}:${config.maxDimension}:force_original_aspect_ratio=decrease`,
  '-r', String(config.frameRate), '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
  '-g', String(config.frameRate * config.segmentSeconds), '-sc_threshold', '0',
  '-f', 'hls', '-hls_time', String(config.segmentSeconds), '-hls_list_size', String(config.playlistSize),
  '-hls_flags', 'delete_segments+omit_endlist', '-hls_segment_filename', resolve(root, 'live', 'segment-%06d.ts'),
  resolve(root, 'live', 'live.m3u8'),
], { windowsHide: true, stdio: ['ignore', 'ignore', 'inherit'] });
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  live.kill();
  server.close();
  server.closeAllConnections();
}
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${config.host}:${config.port}`);
    if (url.pathname === '/shutdown' && req.method === 'POST') { res.once('finish', shutdown); res.end('stopped'); return; }
    if (url.pathname === '/pause' && req.method === 'POST') { paused = true; res.end('paused'); return; }
    if (url.pathname === '/resume' && req.method === 'POST') { paused = false; res.end('resumed'); return; }
    if (url.pathname === '/cases') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(cases)); return; }
    if (url.pathname === '/invalid.jpg') { res.setHeader('Content-Type', 'image/jpeg'); res.end('not an image'); return; }
    if (paused && url.pathname.startsWith('/live/')) { res.writeHead(503); res.end('test interruption'); return; }
    const path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (!path.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    const file = await stat(path);
    res.setHeader('Content-Type', extname(path) === '.m3u8' ? 'application/vnd.apple.mpegurl' : 'video/mp2t');
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Length', file.size);
    createReadStream(path).pipe(res);
  } catch { res.writeHead(404); res.end(); }
});
server.listen(config.port, config.host, () => process.stdout.write(JSON.stringify({ status: 'ready', port: config.port }) + '\n'));
server.once('error', (error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; shutdown(); });
live.once('error', (error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; shutdown(); });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, shutdown);
live.once('exit', (code) => { if (code && !stopping) { process.stderr.write('Replay encoder stopped unexpectedly\n'); process.exitCode = 1; shutdown(); } });
