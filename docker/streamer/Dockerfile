# Headless broadcaster: renders the avatar page in Chromium on a virtual screen
# and streams the screen plus its sound to TikTok over RTMP with ffmpeg.
FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium xvfb x11-utils pulseaudio pulseaudio-utils ffmpeg curl ca-certificates fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

# The page is plain HTTP inside the compose network (http://backend:8787); keep Chromium from upgrading it to HTTPS.
COPY chromium-policy.json /etc/chromium/policies/managed/ucok.json

# Xvfb, running as a normal user, can't create this directory itself.
RUN mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix

RUN useradd --create-home streamer
COPY start.sh /usr/local/bin/start-stream
RUN chmod 755 /usr/local/bin/start-stream

USER streamer
CMD ["start-stream"]
