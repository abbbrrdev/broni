#!/usr/bin/env python3

import os
import sys
import json
import asyncio
import websockets
from vosk import Model, KaldiRecognizer

if len(sys.argv) > 1:
    model_path = sys.argv[1]
else:
    model_path = "model"

model = Model(model_path)

async def recognize(websocket):
    rec = KaldiRecognizer(model, 16000)
    
    while True:
        try:
            message = await websocket.recv()
            
            if isinstance(message, str) and 'eof' in message:
                await websocket.send(rec.FinalResult())
                break
                
            if rec.AcceptWaveform(message):
                await websocket.send(rec.Result())
            else:
                await websocket.send(rec.PartialResult())
                
        except websockets.exceptions.ConnectionClosed:
            break

async def main():
    async with websockets.serve(recognize, "0.0.0.0", 2700):
        print("Vosk Server running on port 2700...")
        await asyncio.Future()  # run forever

if __name__ == "__main__":
    asyncio.run(main())
