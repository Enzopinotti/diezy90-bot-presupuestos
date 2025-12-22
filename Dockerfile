FROM node:20-slim

# Instalar dependencias del sistema: ffmpeg (audio), tesseract (OCR), y libs para Chrome/Puppeteer
RUN apt-get update && apt-get install -y \
    wget gnupg ca-certificates \
    ffmpeg \
    tesseract-ocr \
    tesseract-ocr-spa \
    fonts-liberation \
    libasound2 libatk1.0-0 libatk-bridge2.0-0 libc6 \
    libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 \
    libglib2.0-0 libgdk-pixbuf2.0-0 libgtk-3-0 libnspr4 \
    libnss3 libx11-6 libx11-xcb1 libxcomposite-dev libxcursor1 \
    libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 \
    libxss1 libxtst6 \
    && rm -rf /var/lib/apt/lists/*

# Instalar Google Chrome (versión estable)
RUN wget -qO /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && \
    apt-get update && \
    apt-get install -y /tmp/chrome.deb --no-install-recommends && \
    rm /tmp/chrome.deb

# Directorio de la app
WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY . .

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

EXPOSE 3000
CMD ["npm", "run", "start"]

