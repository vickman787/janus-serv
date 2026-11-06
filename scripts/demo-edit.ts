import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, copyFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const rawDir = join(root, '.data', 'demo-raw');
const voiceDir = join(root, '.data', 'demo-voice');
const editDir = join(root, '.data', 'demo-edit');
const delivery = join(root, 'demo-delivery');
const ffmpeg = 'ffmpeg';
const ffprobe = 'ffprobe';

if (!existsSync(rawDir)) throw new Error('Raw recording directory is missing');
const sourceName = readdirSync(rawDir).filter(name => name.endsWith('.webm')).sort((a, b) => statSync(join(rawDir, b)).mtimeMs - statSync(join(rawDir, a)).mtimeMs)[0];
if (!sourceName) throw new Error('No raw WebM recording found');
const source = join(rawDir, sourceName);
rmSync(editDir, { recursive: true, force: true });
mkdirSync(editDir, { recursive: true });
mkdirSync(delivery, { recursive: true });

const scenes = [
  { id: 'dashboard', source: [14.6, 28.8], audio: 'voice-01.mp3', text: "Janus is a recovery cockpit for Sui handovers. It restores signed intent from Walrus Memory, compares it with fresh Sui testnet evidence, and blocks unsafe actions. This is an isolated testnet run." },
  { id: 'cockpit', source: [30.2, 43.0], audio: 'voice-02.mp3', text: "Here the handover is complete. Remembered state and live chain state agree, and the deterministic verdict reports verified acceptance effects. The model never controls this verdict." },
  { id: 'transactions', source: [42.0, 51.0], audio: 'voice-03.mp3', text: "Three confirmed testnet transactions, propose, successor change, and acceptance, are verified from their known digests." },
  { id: 'copilot', source: [52.0, 63.6], audio: 'voice-04.mp3', text: "Recovery Copilot sends a minimized, source labeled bundle to Dolphin for interpretation, then to SERV Reasoning for a structured plan. Both are advisory." },
  { id: 'findings', source: [62.0, 74.0], audio: 'voice-05.mp3', text: "On a completed handover, it returns only inspect and wait. Every finding cites a validated source ID, from the checkpoint and live state to the transaction evidence." },
  { id: 'stale', source: [80.0, 92.0], audio: 'voice-06.mp3', text: "Earlier assessments stay visible. This ready state plan is now stale because the handover completed, so Janus asks for revalidation instead of silently reusing it." },
  { id: 'close', source: [52.0, 66.0], audio: 'voice-07.mp3', text: "Dolphin and SERV cannot sign, submit, or override the verdict. Sui, Walrus, Tatum, and the wallet pipeline stay deterministic. Janus, with OpenServ Recovery Copilot." },
] as const;

function probeDuration(path: string): number {
  const result = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ffprobe failed for ${path}: ${result.stderr}`);
  return Number(result.stdout.trim());
}
function run(args: string[], cwd = editDir) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${args.join(' ')}\n${result.stderr}`);
}

let cursor = 0;
const clips: string[] = [];
const captionEvents: Array<{ start: number; end: number; text: string }> = [];
for (const [index, scene] of scenes.entries()) {
  const audioPath = join(voiceDir, scene.audio);
  const audioDuration = probeDuration(audioPath);
  const duration = Number((audioDuration + 0.45).toFixed(2));
  const [start, end] = scene.source;
  if (end - start + 0.01 < duration) throw new Error(`${scene.id} source is too short for its narration`);
  const clip = `clip-${String(index + 1).padStart(2, '0')}.mp4`;
  run([
    '-ss', String(start), '-i', source, '-i', audioPath,
    '-filter_complex', '[0:v]fps=30,scale=1920:1080,setsar=1,tpad=stop_mode=clone:stop_duration=2[v];[1:a]aresample=48000,apad=pad_dur=0.45[a]',
    '-map', '[v]', '-map', '[a]', '-t', String(duration),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', clip,
  ]);
  clips.push(clip);

  const words = scene.text.split(/\s+/);
  const chunks: string[] = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length > 74 && current) { chunks.push(current.trim()); current = word; }
    else current = `${current} ${word}`.trim();
  }
  if (current) chunks.push(current.trim());
  const totalChars = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  let sceneCursor = cursor;
  for (const chunk of chunks) {
    const span = Math.max(1.2, (chunk.length / totalChars) * (audioDuration + 0.15));
    captionEvents.push({ start: sceneCursor, end: Math.min(cursor + duration - 0.05, sceneCursor + span), text: chunk });
    sceneCursor += span;
  }
  cursor += duration;
}

writeFileSync(join(editDir, 'concat.txt'), clips.map(clip => `file '${clip}'`).join('\n'));
run(['-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c', 'copy', 'concat.mp4']);

const assTime = (value: number) => {
  const hours = Math.floor(value / 3600), minutes = Math.floor((value % 3600) / 60), seconds = value % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}`;
};
const srtTime = (value: number) => {
  const hours = Math.floor(value / 3600), minutes = Math.floor((value % 3600) / 60), seconds = Math.floor(value % 60), ms = Math.round((value % 1) * 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
};
const escapeAss = (text: string) => text.replace(/[{}]/g, '').replace(/\n/g, '\\N');
const ass = [
  '[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1920', 'PlayResY: 1080', 'WrapStyle: 2', 'ScaledBorderAndShadow: yes', '',
  '[V4+ Styles]',
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  'Style: Default,Segoe UI,34,&H00FFFFFF,&H000000FF,&H00101010,&H90000000,0,0,0,0,100,100,0,0,1,2,1,2,80,80,58,1', '',
  '[Events]',
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ...captionEvents.map(event => `Dialogue: 0,${assTime(event.start)},${assTime(event.end)},Default,,0,0,0,,${escapeAss(event.text)}`),
].join('\n');
writeFileSync(join(editDir, 'captions.ass'), ass, 'utf8');
writeFileSync(join(editDir, 'captions.srt'), captionEvents.map((event, index) => `${index + 1}\n${srtTime(event.start)} --> ${srtTime(event.end)}\n${event.text}\n`).join('\n'), 'utf8');

run(['-i', 'concat.mp4', '-vf', 'ass=captions.ass', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', 'final.mp4']);

const bold = "fontfile='C\\:/Windows/Fonts/segoeuib.ttf'";
const regular = "fontfile='C\\:/Windows/Fonts/segoeui.ttf'";
const endFilter = [
  `drawtext=${bold}:text='OPENSERV RECOVERY COPILOT':fontcolor=0xAAB9FF:fontsize=28:x=(w-text_w)/2:y=390`,
  `drawtext=${bold}:text='Janus + OpenServ':fontcolor=white:fontsize=78:x=(w-text_w)/2:y=470`,
  `drawtext=${regular}:text='Source-linked recovery analysis on Sui':fontcolor=0xD5DBE8:fontsize=36:x=(w-text_w)/2:y=590`,
  `drawtext=${regular}:text='Sui Testnet | Walrus Memory | Tatum':fontcolor=0xAAB9FF:fontsize=28:x=(w-text_w)/2:y=680`,
  `drawtext=${regular}:text='Isolated demo - advisory assessment - synthetic narration':fontcolor=0x8D97AA:fontsize=24:x=(w-text_w)/2:y=745`,
].join(',');
run(['-f', 'lavfi', '-i', 'color=c=0x0b0d12:s=1920x1080:r=30:d=3.6', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
  '-vf', endFilter, '-shortest', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', 'end.mp4']);
writeFileSync(join(editDir, 'final-concat.txt'), "file 'final.mp4'\nfile 'end.mp4'");
run(['-f', 'concat', '-safe', '0', '-i', 'final-concat.txt', '-c', 'copy', 'final-with-card.mp4']);

const finalPath = join(delivery, 'Janus-OpenServ-Recovery-Copilot-Demo.mp4');
copyFileSync(join(editDir, 'final-with-card.mp4'), finalPath);
copyFileSync(join(editDir, 'captions.srt'), join(delivery, 'Captions.srt'));
writeFileSync(join(delivery, 'Voiceover.txt'), scenes.map(scene => scene.text).join('\n\n'), 'utf8');
writeFileSync(join(delivery, 'Description.txt'), [
  'Janus + OpenServ Recovery Copilot — isolated Sui testnet demo',
  '',
  'Janus is a Sui handover recovery cockpit. This demo shows a completed testnet handover, deterministic evidence from Walrus Memory and Tatum, and the advisory Recovery Copilot using Dolphin Network and SERV Reasoning.',
  '',
  'Track: Dolphin',
  'Providers: Dolphin Network (deepseek-ai/DeepSeek-V4.1-Flash) and SERV Reasoning (gpt-5.4-mini)',
  'Network: Sui testnet; Walrus Memory mainnet test namespaces',
  'Narration: synthetic voice generated with ElevenLabs (Daniel voice, eleven_v4).',
  '',
  'The model output is advisory. Application validation rejected unsupported references and prohibited wallet-review advice during testing. All transactions and results shown are from an isolated testnet run with disposable wallets; no production or mainnet transaction is depicted.',
  '',
  'Project: Janus — Walrus edition prior work plus the new OpenServ Recovery Copilot feature.',
].join('\n'), 'utf8');

const check = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration,size', '-show_entries', 'stream=codec_name,width,height,r_frame_rate,channels', '-of', 'json', finalPath], { encoding: 'utf8' });
console.log(JSON.stringify({ source, finalPath, duration: probeDuration(finalPath), check: check.stdout ? JSON.parse(check.stdout) : null }, null, 2));
