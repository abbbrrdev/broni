// ═══════════════════════════════════════════════════════════
//  A S T E R I S K   A R I   I N T E G R A T I O N
//
//  Полный аналог Twilio для Zadarma:
//  • Asterisk регистрируется в Zadarma по SIP
//  • Node.js управляет вызовом через ARI (REST + WebSocket)
//  • TTS: macOS say (dev) или любой HTTP TTS (prod)
//  • STT: Gemini audio transcription (тот же ключ)
// ═══════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import dgram from 'dgram';
import { createHmac, createHash } from 'crypto';
import { EventEmitter } from 'events';
import { callGemini, transcribeAudioWithGemini } from './gemini';
import { extractJson } from '../utils/json';
import { config } from '../config';
import { logger } from '../utils/logger';
import { prisma } from '../lib/db';
import type { Task } from '../lib/db';
import {
  generateVoiceResponse,
  analyzeCallOutcome,
} from '../modules/calls/calls.service';
import { broadcastWsEvent } from '../index';

// ─── Пути к аудио папкам (монтируются в Asterisk) ─────────
const SOUNDS_DIR = path.resolve('./asterisk/sounds');
const RECORDINGS_DIR = path.resolve('./asterisk/recordings');

// ─── ARI конфигурация ─────────────────────────────────────
const ARI_HOST = process.env.ASTERISK_ARI_HOST || 'localhost';
const ARI_PORT = process.env.ASTERISK_ARI_PORT || '8088';
const ARI_USER = process.env.ASTERISK_ARI_USER || 'ari_admin';
const ARI_PASS = process.env.ASTERISK_ARI_PASS || 'changeme';
const ARI_APP = 'ai-agent';
const ARI_BASE = `http://${ARI_HOST}:${ARI_PORT}/ari`;
const ARI_AUTH = Buffer.from(`${ARI_USER}:${ARI_PASS}`).toString('base64');

// ─── Zadarma API конфиг ────────────────────────────────
const ZADARMA_KEY = process.env.ZADARMA_API_KEY || '';
const ZADARMA_SECRET = process.env.ZADARMA_API_SECRET || '';
const ZADARMA_SIP_ID = process.env.ZADARMA_SIP_ID || '';
// Задержка перед приветствием: даём Zadarma время соединить внешний номер
const CALLBACK_BRIDGE_DELAY_MS = 12_000;

// ─── Активные звонки ──────────────────────────────────────
interface ActiveCall {
  taskId: string;
  task: Task;
  greetingSoundName: string;
  greetingCompleted: boolean;
  callbackMode?: boolean; // true = входящий от Zadarma Callback API
}
const activeCalls = new Map<string, ActiveCall>(); // channelId → info
const pendingCalls = new Map<string, ActiveCall>(); // taskId → info
const callbackQueue: ActiveCall[] = [];              // очередь callback mode

// ─── ARI события (EventEmitter) ───────────────────────────
const ariEvents = new EventEmitter();
ariEvents.setMaxListeners(100);
let wsConnected = false;

// Callback API removed: moving to standard ARI Outbound Calls for zero-latency connection.

// ─── ARI REST helper ──────────────────────────────────────
async function ari(
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  params?: Record<string, string>,
): Promise<Record<string, unknown>> {
  const url = new URL(`${ARI_BASE}${endpoint}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Basic ${ARI_AUTH}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`ARI ${method} ${endpoint} → ${res.status}: ${text}`);
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

// ─── Подключение ARI WebSocket ────────────────────────────
export function connectAri(): void {
  const wsUrl = `ws://${ARI_HOST}:${ARI_PORT}/ari/events?api_key=${ARI_USER}:${ARI_PASS}&app=${ARI_APP}&subscribeAll=false`;

  const connect = () => {
    logger.info('Asterisk', `Connecting to ARI WebSocket…`);
    const ws = new WebSocket(wsUrl);

    ws.addEventListener('open', () => {
      wsConnected = true;
      logger.info('Asterisk', '✅ ARI WebSocket connected');
    });

    ws.addEventListener('message', (ev: MessageEvent) => {
      try {
        const event = JSON.parse(ev.data as string) as Record<string, unknown>;
        const type = event.type as string;
        ariEvents.emit(type, event);

        if (type === 'StasisStart') handleStasisStart(event);
        if (type === 'StasisEnd') handleStasisEnd(event);
      } catch { /* ignore parse errors */ }
    });

    ws.addEventListener('close', () => {
      wsConnected = false;
      logger.warn('Asterisk', 'ARI WebSocket disconnected — reconnecting in 5s');
      setTimeout(connect, 5000);
    });

    ws.addEventListener('error', (e) => {
      logger.error('Asterisk', 'ARI WebSocket error', e);
    });
  };

  connect();
}

import { streamEdgeTTS } from '../utils/edge-tts-stream';

// ─── TTS: Microsoft Edge Neural (Streaming) ──────────────
async function textToSpeech(text: string, filename: string): Promise<void> {
  const wavPath = path.join(SOUNDS_DIR, `${filename}.wav`);

  // Вызываем наш стриминг клиент. Promise разрешится сразу после 
  // получения первого чанка аудио от ffmpeg, так что задержка ~0.1 сек!
  await streamEdgeTTS(text, wavPath);

  logger.info('TTS', `Streaming TTS to ${filename}.wav started...`);
}

// ─── STT: Vosk Streaming Server ───────────────────────────────
export class VoskStreamer extends EventEmitter {
  private ws: WebSocket | null = null;
  private fd: number | null = null;
  private pos = 0;
  private interval: Timer | null = null;
  private transcript = '';
  private resolveFinal: ((res: string) => void) | null = null;

  constructor(private filePath: string) {
    super();
  }

  public start() {
    const VOSK_HOST = process.env.VOSK_HOST || 'localhost';
    this.ws = new WebSocket(`ws://${VOSK_HOST}:2700`);
    
    this.ws.addEventListener('open', () => {
      // Пытаемся открыть файл каждые 100мс (Asterisk может создать его с небольшой задержкой)
      const tryOpen = setInterval(() => {
        if (fs.existsSync(this.filePath) && this.fd === null) {
          this.fd = fs.openSync(this.filePath, 'r');
          clearInterval(tryOpen);
          
          this.interval = setInterval(() => {
            if (this.fd !== null && this.ws?.readyState === WebSocket.OPEN) {
              const stat = fs.statSync(this.filePath);
              if (stat.size > this.pos) {
                const buf = Buffer.alloc(stat.size - this.pos);
                fs.readSync(this.fd, buf, 0, buf.length, this.pos);
                this.pos = stat.size;
                this.ws.send(new Uint8Array(buf));
              }
            }
          }, 200); // Читаем и стримим каждые 200мс!
        }
      }, 100);
      
      // Страховка от бесконечного ожидания
      setTimeout(() => clearInterval(tryOpen), 5000);
    });

    this.ws.addEventListener('message', (event: MessageEvent) => {
      try {
        const resp = JSON.parse(event.data.toString());
        if (resp.text) {
          logger.info('STT', `Vosk reply: ${JSON.stringify(resp)}`);
          this.transcript += resp.text + ' ';
        } else if (resp.partial) {
          this.emit('partial', resp.partial);
        }
      } catch (e) {
        logger.error('STT', `Vosk parse error: ${event.data}`);
      }
    });

    this.ws.addEventListener('close', () => {
      if (this.resolveFinal) {
        this.resolveFinal(this.transcript.trim());
      }
    });

    this.ws.addEventListener('error', (err: Event) => {
      logger.error('STT', 'Vosk stream error', err);
    });
  }

  public async stop(): Promise<string> {
    return new Promise((resolve) => {
      this.resolveFinal = resolve;
      if (this.interval) clearInterval(this.interval);
      
      // Дочитываем остатки
      if (this.fd !== null) {
        try {
          const stat = fs.statSync(this.filePath);
          if (stat.size > this.pos) {
            const buf = Buffer.alloc(stat.size - this.pos);
            fs.readSync(this.fd, buf, 0, buf.length, this.pos);
            if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(new Uint8Array(buf));
          }
          fs.closeSync(this.fd);
        } catch (e) {}
      }

      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send('{"eof" : 1}'); // Vosk закроет сокет и вернет финальный результат
      } else {
        resolve(this.transcript.trim());
      }
    });
  }
}

// ─── Call FSM (Машина состояний звонка) ─────────────────────
type CallState = 'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING' | 'SPEAKING_FINAL' | 'HANGUP';

class CallFSM {
  private state: CallState = 'IDLE';
  private channelId: string;
  private taskId: string;
  private task: Task;
  private turnCount = 0;
  private maxTurns = 15;
  private silentCount = 0;
  private maxSilentTurns = 3;
  private errorCount = 0;
  private maxErrors = 2;
  private isAlive = true;
  private currentPlaybackId: string | null = null;
  private currentRecordingName: string | null = null;
  private sttRecordPath: string | null = null;
  private snoopChannelId: string | null = null;
  
  private bargeInStreamer: VoskStreamer | null = null;
  private bargeInRecordingName: string | null = null;
  
  // Для передачи частичного текста с bargeIn-сессии в основную
  private bargeInTranscriptBuffer = '';
  
  constructor(
    channelId: string, 
    taskId: string, 
    task: Task, 
    private greetingSoundName: string, 
    private greetingCompleted: boolean
  ) {
    this.channelId = channelId;
    this.taskId = taskId;
    this.task = task;
    this.handleEvent = this.handleEvent.bind(this);
    
    ariEvents.on('ChannelDestroyed', this.handleEvent);
    ariEvents.on('PlaybackFinished', this.handleEvent);
    ariEvents.on('RecordingFinished', this.handleEvent);
  }

  private cleanup() {
    this.isAlive = false;
    this.sttRecordPath = null;
    ariEvents.off('ChannelDestroyed', this.handleEvent);
    ariEvents.off('PlaybackFinished', this.handleEvent);
    ariEvents.off('RecordingFinished', this.handleEvent);
  }

  private async handleEvent(event: any) {
    if (!this.isAlive) return;

    const eventType = event.type;
    
    if (eventType === 'ChannelDestroyed' && event.channel?.id === this.channelId) {
      logger.info('Asterisk', `📵 [FSM] Собеседник повесил трубку (${this.channelId})`);
      this.transition('HANGUP');
      return;
    }

    if (eventType === 'PlaybackFinished' && event.playback?.id === this.currentPlaybackId) {
      this.currentPlaybackId = null;
      if (this.state === 'SPEAKING') {
         this.transition('LISTENING');
      } else if (this.state === 'SPEAKING_FINAL') {
         this.transition('HANGUP');
      }
      return;
    }

    if (eventType === 'RecordingFinished') {
      if (event.recording?.name === this.bargeInRecordingName) {
        this.bargeInRecordingName = null;
        if (this.bargeInStreamer) {
          this.bargeInStreamer.stop().then(text => {
            if (text.trim()) this.bargeInTranscriptBuffer += text + ' ';
          });
          this.bargeInStreamer = null;
        }
        // Если мы всё ещё говорим (и не прервали playback), просто перезапускаем слушателя
        if (this.state === 'SPEAKING' && this.currentPlaybackId) {
          this.startBargeInRecording();
        }
        return;
      }

      if (event.recording?.name === this.currentRecordingName) {
        this.currentRecordingName = null;
        if (this.state === 'LISTENING') {
           this.transition('THINKING');
        }
        return;
      }
    }
  }

  public async start() {
    fs.mkdirSync(SOUNDS_DIR, { recursive: true });
    fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
    
    // Запускаем Snoop-канал для полной записи разговора (Tx + Rx)
    try {
      const snoop = await ari('POST', `/channels/${this.channelId}/snoop`, undefined, {
        app: 'ai-agent',
        spy: 'both',
        snoopId: `snoop_${this.channelId}`
      }) as any;
      this.snoopChannelId = snoop.id;
      
      // Ждем, пока канал snoop инициализируется в Stasis, чтобы избежать 409 Channel not in Stasis
      await new Promise(r => setTimeout(r, 200));

      const recName = `full_call_${this.taskId}`;
      await ari('POST', `/channels/${snoop.id}/record`, undefined, {
        name: recName,
        format: 'wav',
        ifExists: 'overwrite'
      });
      
      // Сразу сохраняем путь в базу (будет доступен по API)
      if (!this.taskId.startsWith('inb_')) {
        await prisma.task.update({
          where: { id: this.taskId },
          data: { recordingUrl: `/api/recordings/${recName}.wav` }
        });
      } else {
        // Для B2B сохраняем временно в памяти, doHangup заберет это для CallLog
        this.task.recordingUrl = `/api/recordings/${recName}.wav`;
      }
      logger.info('Asterisk', `🎙️ Started full call recording: ${recName}.wav`);
    } catch (err) {
      logger.error('Asterisk', 'Failed to start Snoop recording', err);
    }

    if (!this.greetingCompleted) {
      logger.info('Asterisk', `▶️ [FSM] Playing pre-generated greeting`);
      this.state = 'SPEAKING';
      this.startBargeInRecording();
      try {
        await ari('POST', `/channels/${this.channelId}/answer`).catch(() => {});
        const playback = await ari('POST', `/channels/${this.channelId}/play`, undefined, { media: `sound:recordings/${this.greetingSoundName}` });
        this.currentPlaybackId = (playback as any).id;
      } catch (e) {
        this.transition('HANGUP');
      }
    } else {
      this.transition('LISTENING');
    }
  }

  private async transition(newState: CallState) {
    if (!this.isAlive && newState !== 'HANGUP') return;
    logger.info('Asterisk', `🔄 [FSM] ${this.state} -> ${newState}`);
    this.state = newState;

    try {
      switch (newState) {
        case 'LISTENING':
          await this.doListen();
          break;
        case 'THINKING':
          await this.doThink();
          break;
        case 'HANGUP':
          await this.doHangup();
          break;
      }
    } catch (e: any) {
      if (e?.message?.includes('404')) {
        logger.info('Asterisk', `📵 [FSM] Канал уже закрыт (404)`);
      } else {
        logger.error('Asterisk', `[FSM] Error in state ${newState}`, e);
      }
      if (newState !== 'HANGUP') this.transition('HANGUP');
    }
  }

  private async startBargeInRecording() {
     this.bargeInRecordingName = `bargein_${this.channelId}_${this.turnCount}`;
     const format = 'sln16';
     
     try {
       await ari('POST', `/channels/${this.channelId}/record`, undefined, {
           name: this.bargeInRecordingName,
           format: format,
           maxSilenceSeconds: '2',
           ifExists: 'overwrite'
       });
       
       const filepath = path.join(RECORDINGS_DIR, `${this.bargeInRecordingName}.${format}`);
       this.bargeInStreamer = new VoskStreamer(filepath);
       
       this.bargeInStreamer.on('partial', (text: string) => {
           // Ждем осмысленной фразы (хотя бы 3 буквы, чтобы отсеять шумы)
           if (this.state === 'SPEAKING' && text.length > 3) {
               logger.info('Asterisk', `🛑 [FSM] BARGE-IN DETECTED: "${text}"`);
               if (this.currentPlaybackId) {
                   ari('DELETE', `/playbacks/${this.currentPlaybackId}`).catch(() => {});
                   this.currentPlaybackId = null;
               }
               // Останавливаем запись
               ari('DELETE', `/recordings/live/${this.bargeInRecordingName}`).catch(()=>{});
               
               // Принудительно переводим FSM в режим слушания, чтобы ИИ дал клиенту договорить
               this.transition('LISTENING');
           }
       });
       
       this.bargeInStreamer.start();
       
     } catch (e: any) {
       if (!e?.message?.includes('404')) {
         logger.error('Asterisk', 'Failed to start barge-in recording', e);
       }
     }
  }

  private async doListen() {
    this.turnCount++;
    if (this.turnCount > this.maxTurns) {
      logger.info('Asterisk', `[FSM] Достигнут лимит ходов (${this.maxTurns}), завершаем`);
      
      const byeSoundName = `ast_${this.channelId}_limit`;
      await textToSpeech('Извините, у нас заканчивается время разговора. До свидания!', byeSoundName);
      if (!this.isAlive) return;
      this.state = 'SPEAKING_FINAL';
      const pb = await ari('POST', `/channels/${this.channelId}/play`, undefined, { media: `sound:recordings/${byeSoundName}` });
      this.currentPlaybackId = (pb as any).id;
      return;
    }

    this.currentRecordingName = `rec_${this.channelId}_${this.turnCount}`;
    this.sttRecordPath = path.join(RECORDINGS_DIR, `${this.currentRecordingName}.wav`);
    
    logger.info('Asterisk', `🎙️ [FSM] Listening... (Trigger on 1s silence)`);
    await ari('POST', `/channels/${this.channelId}/record`, undefined, {
      name: this.currentRecordingName, format: 'wav',
      maxDurationSeconds: '20', maxSilenceSeconds: '1',
      beep: 'false', ifExists: 'overwrite',
    });
  }

  private async doThink() {
    let text = '';
    if (this.sttRecordPath) {
      // Используем мощный Gemini STT вместо локального Vosk для точного понимания
      text = await transcribeAudioWithGemini(this.sttRecordPath);
      this.sttRecordPath = null;
    }
    
    // Подклеиваем текст, который мы могли поймать во время barge-in
    if (this.bargeInTranscriptBuffer) {
       text = this.bargeInTranscriptBuffer + text;
       this.bargeInTranscriptBuffer = '';
    }
    text = text.trim();
    
    if (!text || text.trim().length < 2) {
      this.silentCount++;
      logger.warn('Asterisk', `[FSM] Тишина или короткий звук (${this.silentCount}/${this.maxSilentTurns})`);
      if (this.silentCount >= this.maxSilentTurns) {
        logger.info('Asterisk', '[FSM] 🔇 Слишком долго молчит — завершаем звонок');
        const byeSoundName = `ast_${this.channelId}_bye`;
        await textToSpeech('Извините, вас совершенно не слышно. Перезвоним позже. До свидания!', byeSoundName);
        if (!this.isAlive) return;
        this.state = 'SPEAKING_FINAL';
        const pb = await ari('POST', `/channels/${this.channelId}/play`, undefined, { media: `sound:recordings/${byeSoundName}` });
        this.currentPlaybackId = (pb as any).id;
        return;
      }
      
      // Озвучиваем подсказку вместо молчаливого возврата
      const retrySound = `ast_${this.channelId}_silence_${this.silentCount}`;
      await textToSpeech('Простите, я вас не услышал. Алло, вы меня слышите?', retrySound);
      if (!this.isAlive) return;
      this.state = 'SPEAKING';
      this.startBargeInRecording();
      const playback = await ari('POST', `/channels/${this.channelId}/play`, undefined, { media: `sound:recordings/${retrySound}` });
      this.currentPlaybackId = (playback as any).id;
      return;
    }

    this.silentCount = 0; // Сброс счетчика тишины
    logger.info('Asterisk', `👤 [FSM] User: "${text}"`);
    
    // Отправляем текст клиента в Dashboard
    broadcastWsEvent({
      type: 'client_speaking',
      text,
      companyId: this.task.userId,
      callId: this.channelId
    });
    
    // Запрос в ИИ
    try {
      const reply = await generateVoiceResponse(this.taskId, this.task, 'respond', text);
      const replyText = typeof reply === 'object' && reply.text ? reply.text : String(reply);
      logger.info('Asterisk', `🤖 [FSM] AI: "${replyText.substring(0, 80)}"`);

      // Отправляем ответ ИИ в Dashboard
      broadcastWsEvent({
        type: 'ai_speaking',
        text: replyText,
        companyId: this.task.userId,
        callId: this.channelId
      });

      // Генерация TTS
      const soundName = `ast_${this.channelId}_${this.turnCount}_ai`;
      await textToSpeech(replyText, soundName);

      if (!this.isAlive) return;

      if (reply.completed) {
         this.state = 'SPEAKING_FINAL'; // Сыграет фразу и повесит трубку
      } else {
         this.state = 'SPEAKING';
         this.startBargeInRecording();
      }

      const playback = await ari('POST', `/channels/${this.channelId}/play`, undefined, { media: `sound:recordings/${soundName}` });
      this.currentPlaybackId = (playback as any).id;

    } catch (e: any) {
      if (e?.message?.includes('404')) {
        logger.info('Asterisk', `📵 [FSM] Канал закрыт (404) во время ответа ИИ`);
      } else {
        logger.error('Asterisk', '[FSM] Ошибка Gemini, делаем recovery...', e);
      }
      this.errorCount++;
      
      if (this.errorCount >= this.maxErrors) {
          const finalErr = `ast_err_final_${this.channelId}`;
          await textToSpeech('К сожалению, у меня возникли технические неполадки. Я перезвоню вам позже. До свидания!', finalErr);
          if (!this.isAlive) return;
          this.state = 'SPEAKING_FINAL';
          const pb = await ari('POST', `/channels/${this.channelId}/play`, undefined, { media: `sound:recordings/${finalErr}` });
          this.currentPlaybackId = (pb as any).id;
          return;
      }

      // Graceful Recovery
      const errorSound = `ast_err_${this.channelId}`;
      await textToSpeech('Простите, я задумался. Можете повторить?', errorSound);
      if (!this.isAlive) return;
      this.state = 'SPEAKING';
      this.startBargeInRecording();
      const playback = await ari('POST', `/channels/${this.channelId}/play`, undefined, { media: `sound:recordings/${errorSound}` });
      this.currentPlaybackId = (playback as any).id;
    }
  }

  private async doHangup() {
    this.cleanup();
    if (this.snoopChannelId) {
      await ari('DELETE', `/channels/${this.snoopChannelId}`).catch(() => {});
    }
    this.isAlive = false;
    await ari('DELETE', `/channels/${this.channelId}`).catch(() => {});
    
    broadcastWsEvent({
      type: 'call_end',
      companyId: this.task.userId,
      callId: this.channelId
    });

    // Анализируем результат
    const outcome = await analyzeCallOutcome(this.taskId, this.task);
    logger.info('Asterisk', `📊 [FSM] Outcome: ${outcome.status} — ${outcome.summary}`);

    // Сохраняем в БД
    if (this.taskId.startsWith('inb_')) {
      // Это входящий B2B звонок, сохраняем в CallLog
      const companyId = this.task.userId; // Мы сохраним ID компании в userId при создании фейк-таски
      const clientPhone = this.task.originalText.replace('Входящий звонок от клиента ', '');
      
      try {
        await prisma.callLog.create({
          data: {
            companyId,
            clientPhone,
            direction: 'INBOUND',
            audioRecordUrl: this.task.recordingUrl,
            transcript: outcome.summary, // Можно в будущем писать полный транскрипт
            status: outcome.status,
          }
        });
      } catch (err) {
        logger.error('Asterisk', 'Failed to save CallLog', err);
      }
    } else {
      // Это исходящий B2C звонок, обновляем Task
      // @ts-ignore: IDE cache issue for dynamically generated Prisma types
      await prisma.task.update({
        where: { id: this.task.id },
        data: {
          callOutcome: outcome.status,
          callSummary: outcome.summary,
          status: (outcome.status === 'BOOKED' ? 'COMPLETED' : outcome.status === 'REJECTED' ? 'REJECTED' : 'CALL_COMPLETED') as any
        } as any
      }).catch(err => logger.error('Asterisk', 'Failed to update Task', err));
    }

    // ── Очистка временных файлов ──
    setTimeout(() => {
      try {
        fs.readdirSync(SOUNDS_DIR).forEach(f => {
          if (f.startsWith(`ast_${this.channelId}`) || f.startsWith(`ast_${this.taskId}`)) {
            fs.unlinkSync(path.join(SOUNDS_DIR, f));
          }
        });
        fs.readdirSync(RECORDINGS_DIR).forEach(f => {
          if (f.startsWith(`rec_${this.channelId}`) || f.startsWith(`bargein_${this.channelId}`)) {
            fs.unlinkSync(path.join(RECORDINGS_DIR, f));
          }
        });
        logger.info('Asterisk', `🧹 Очищены временные файлы звонка ${this.channelId}`);
      } catch (e) {
        logger.error('Asterisk', 'Failed to cleanup audio files', e);
      }
    }, 10_000); // Удаляем через 10 секунд после завершения
  }
}

// ─── ARI Event: Звонок поднят (StasisStart) ───────────────
async function handleStasisStart(event: Record<string, unknown>): Promise<void> {
  const channel = (event as any).channel;
  const channelId: string = channel?.id;
  const args = ((event as any).args as string[]) || [];

  let call = activeCalls.get(channelId);

  if (!call) {
    if (args[0] === 'inbound') {
      const dialedNumber = args[1]; // exten (SIP number)
      const callerPhone = args[2];  // caller id

      logger.info('Asterisk', `📥 Inbound call detected to ${dialedNumber} from ${callerPhone}`);

      const company = await prisma.company.findUnique({
        where: { sipNumber: dialedNumber }
      });

      if (!company || !company.isActive) {
        logger.warn('Asterisk', `Unknown or inactive company for SIP number: ${dialedNumber}`);
        ari('DELETE', `/channels/${channelId}`).catch(() => {});
        return;
      }

      const taskId = `inb_${Date.now()}`;
      const fakeTask = {
        id: taskId,
        userId: company.id, // сохраняем ID компании
        taskName: 'Входящий звонок B2B',
        originalText: `Входящий звонок от клиента ${callerPhone}`,
        placeName: company.name,
        additionalInfo: company.systemPrompt, // Используем для B2B промпта
        time: '',
        address: '',
      } as any;

      const greetingSoundName = `ast_${taskId}_greeting`;
      const greetingText = `Здравствуйте! Вы позвонили в ${company.name}. Чем я могу вам помочь?`;
      
      logger.info('Asterisk', `Generating greeting for B2B: ${greetingText}`);
      await textToSpeech(greetingText, greetingSoundName);

      broadcastWsEvent({
        type: 'call_start',
        companyId: company.id,
        callId: channelId,
        callerPhone,
      });

      broadcastWsEvent({
        type: 'ai_speaking',
        text: greetingText,
        companyId: company.id,
        callId: channelId
      });

      call = {
        taskId,
        task: fakeTask,
        greetingSoundName,
        greetingCompleted: false,
        callbackMode: false,
      };

      activeCalls.set(channelId, call);

    } else {
      const taskId = args[0];
      if (taskId) call = pendingCalls.get(taskId);
      if (call) {
        activeCalls.set(channelId, call);
        pendingCalls.delete(call.taskId);
      }
    }
  }

  if (!call) {
    logger.warn('Asterisk', `StasisStart for unknown channel ${channelId}`);
    return;
  }

  const channelState: string = (channel as any)?.state ?? '';
  logger.info('Asterisk', `📞 StasisStart: channelId=${channelId} state=${channelState} taskId=${call.taskId}`);

  const startConversation = () => {
    logger.info('Asterisk', `▶️ Starting FSM for conversation!`);
    const fsm = new CallFSM(
      channelId,
      call!.taskId,
      call!.task,
      call!.greetingSoundName,
      call!.greetingCompleted
    );
    fsm.start().catch((err: any) => logger.error('Asterisk', 'FSM start failed', err));
  };

  if (channelState === 'Up') {
    startConversation();
  } else {
    // Ждём пока трубку поднимут через простую подписку (тут можно обойтись без FSM, так как звонок еще не начался)
    const onStateChange = (e: any) => {
      if (e.channel?.id === channelId && e.channel?.state === 'Up') {
        ariEvents.off('ChannelStateChange', onStateChange);
        startConversation();
      }
    };
    ariEvents.on('ChannelStateChange', onStateChange);
    
    // Тайм-аут на ответ
    setTimeout(() => {
      ariEvents.off('ChannelStateChange', onStateChange);
      if (activeCalls.has(channelId)) {
        logger.warn('Asterisk', `⚠️ Channel ${channelId} never reached Up — no answer`);
        activeCalls.delete(channelId);
        ari('DELETE', `/channels/${channelId}`).catch(() => {});
      }
    }, 60_000);
  }
}

function handleStasisEnd(event: Record<string, unknown>): void {
  const channelId = (event as any).channel?.id as string;
  activeCalls.delete(channelId);
  logger.info('Asterisk', `📵 Channel ${channelId} ended`);
}

// ─── makeCall ─────────────────────────────────────────────
export async function initiateCall(taskId: string, targetNumber: string, task: Task): Promise<boolean> {
  if (!wsConnected) {
    logger.warn('Asterisk', '❌ ARI WebSocket not connected');
    return false;
  }

  const testNumber = process.env.TEST_PHONE_NUMBER;
  const dialNumber = testNumber || targetNumber;
  let cleanNumber = dialNumber.replace(/[\s\-\(\)]/g, '').replace(/^\+/, '');

  // Zadarma rule: PZnd outbound mobile calls in KZ must start with 8
  if (cleanNumber.startsWith('77') && cleanNumber.length === 11) {
    cleanNumber = '8' + cleanNumber.substring(1);
  }

  logger.info('Asterisk', testNumber
    ? `🧪 TEST MODE: ${cleanNumber} (вместо ${targetNumber})`
    : `📲 ${taskId} → ${cleanNumber}`);

  // ── Предварительная генерация приветствия ───────────────
  fs.mkdirSync(SOUNDS_DIR, { recursive: true });
  const user = await prisma.user.findUnique({ where: { id: task.userId } });
  const clientName = user?.name || 'Аноним';
  const taskDetails = [
    `Имя клиента: ${clientName}`,
    `Заведение: ${task.placeName}`, `Адрес: ${task.address || '—'}`,
    `Время: ${task.time || 'уточнить'}`, `Задача: ${task.taskName}`,
    task.additionalInfo ? `Детали: ${task.additionalInfo}` : '',
  ].filter(Boolean).join('\n');

  logger.info('Asterisk', '⏳ Pre-generating greeting…');
  const greeting = await generateVoiceResponse(taskId, task, 'start', taskDetails);
  const greetingText = typeof greeting === 'object' && greeting.text ? greeting.text : String(greeting);
  logger.info('Asterisk', `Greeting: "${greetingText.substring(0, 60)}…"`);
  const greetingSoundName = `ast_${taskId}_greeting`;
  await textToSpeech(greetingText, greetingSoundName);
  logger.info('Asterisk', '✅ Greeting ready — placing call now');

  const callData: ActiveCall = {
    taskId, task,
    greetingSoundName,
    greetingCompleted: greeting.completed ?? false,
    callbackMode: false,
  };

  // Сохраняем в pending (найдём по appArgs в StasisStart)
  pendingCalls.set(taskId, callData);

  try {
    const callerId = process.env.ZADARMA_SIP_ID || '100';
    await ari('POST', '/channels', undefined, {
      endpoint: `PJSIP/${cleanNumber}@zadarma`,
      app: ARI_APP,
      appArgs: taskId,
      callerId: callerId,
      timeout: '45',             // сколько секунд звонить
    });
    
    logger.info('Asterisk', `✅ Outbound call initiated via SIP (target: ${cleanNumber})`);
    return true;
  } catch (err) {
    pendingCalls.delete(taskId);
    logger.error('Asterisk', '❌ initiateCall via SIP failed', err);
    return false;
  }
}
