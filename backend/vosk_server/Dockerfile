FROM python:3.9-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    wget unzip curl libatomic1 && \
    rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir vosk websockets

# Download the highly optimized 45MB Russian model
RUN wget -q https://alphacephei.com/vosk/models/vosk-model-small-ru-0.22.zip && \
    unzip vosk-model-small-ru-0.22.zip && \
    mv vosk-model-small-ru-0.22 /model && \
    rm vosk-model-small-ru-0.22.zip

COPY asr_server.py /opt/vosk-server/asr_server.py

CMD ["python3", "/opt/vosk-server/asr_server.py", "/model"]
