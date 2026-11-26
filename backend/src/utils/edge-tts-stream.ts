import WebSocket from 'ws';
import { randomBytes, createHash } from 'crypto';
import { spawn } from 'child_process';
import { logger } from './logger';

const CHROMIUM_FULL_VERSION = '143.0.3650.75';
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WINDOWS_FILE_TIME_EPOCH = 11644473600n;

function generateSecMsGecToken() {
  const ticks = BigInt(Math.floor((Date.now() / 1000) + Number(WINDOWS_FILE_TIME_EPOCH))) * 10000000n;
  const roundedTicks = ticks - (ticks % 3000000000n);
  const strToHash = `${roundedTicks}${TRUSTED_CLIENT_TOKEN}`;
  const hash = createHash('sha256');
  hash.update(strToHash, 'ascii');
  return hash.digest('hex').toUpperCase();
}

export async function streamEdgeTTS(text: string, outputPath: string): Promise<void> {
  const voice = 'ru-RU-DmitryNeural';
  const lang = 'ru-RU';
  const outputFormat = 'audio-24khz-48kbitrate-mono-mp3';

  const wsUrl = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${generateSecMsGecToken()}&Sec-MS-GEC-Version=1-${CHROMIUM_FULL_VERSION}`;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, {
      host: 'speech.platform.bing.com',
      origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      headers: {
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache',
        'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_FULL_VERSION.split('.')[0]}.0.0.0 Safari/537.36 Edg/${CHROMIUM_FULL_VERSION.split('.')[0]}.0.0.0`,
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    let resolved = false;

    // Стриминг MP3 напрямую в FFMPEG, который пишет в 8kHz WAV
    const ffmpeg = spawn('ffmpeg', [
      '-y',
      '-i', 'pipe:0',          // Читаем из stdin
      '-ar', '8000',           // Строго 8kHz для Asterisk WAV!
      '-ac', '1',
      '-c:a', 'pcm_s16le',
      '-f', 'wav',             // Стандартный WAV формат
      outputPath
    ]);

    const checkInterval = setInterval(() => {
      try {
        const stat = require('fs').statSync(outputPath);
        if (stat.size > 44 && !resolved) { // 44 байта — это WAV заголовок
          resolved = true;
          clearInterval(checkInterval);
          resolve();
        }
      } catch (e) {}
    }, 50);

    ffmpeg.on('error', (err) => logger.error('TTS', 'FFMPEG Stream error', err));

    const timeout = setTimeout(() => {
      ws.close();
      ffmpeg.kill();
      clearInterval(checkInterval);
      if (!resolved) reject(new Error('EdgeTTS Stream Timeout'));
    }, 15000);

    ws.on('open', () => {
      const configMsg = `Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"${outputFormat}"}}}}`;
      ws.send(configMsg);

      const requestId = randomBytes(16).toString('hex');
      const ssmlMsg = `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${lang}"><voice name="${voice}"><prosody rate="default" pitch="default" volume="default">${text}</prosody></voice></speak>`;
      ws.send(ssmlMsg);
    });

    ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        const separator = 'Path:audio\r\n';
        const strData = data.toString('utf8', 0, 500); 
        const idx = strData.indexOf(separator);
        if (idx !== -1) {
          const audioData = data.subarray(idx + separator.length);
          ffmpeg.stdin.write(audioData); // Кидаем чанк в FFMPEG!
        }
      } else {
        const msg = data.toString('utf8');
        if (msg.includes('Path:turn.end')) {
          ffmpeg.stdin.end(); // Закрываем stdin, FFMPEG завершит файл
          ws.close();
          clearTimeout(timeout);
          clearInterval(checkInterval);
          if (!resolved) {
             resolved = true;
             resolve();
          }
        }
      }
    });

    ws.on('error', (err: any) => {
      logger.error('TTS', 'Stream error', err);
      ffmpeg.kill();
      clearInterval(checkInterval);
      if (!resolved) reject(err);
      ws.close();
    });
  });
}
