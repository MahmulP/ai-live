# AI Live TikTok

Host AI untuk TikTok LIVE. Aplikasi ini membaca komentar live, menyaring spam, lalu menyusun jawaban dengan Claude dalam logat Batak/Medan. Jawaban itu diucapkan lewat TTS oleh **Ucok**, karakter chibi 3D berselendang ulos, yang mulutnya bergerak mengikuti suara. Ucok juga berekspresi: mata senang dan hati beterbangan saat ada gift, melambai saat ada follow, dan memiringkan kepala saat ditanya. Halaman avatar di-capture dengan OBS lalu di-stream ke TikTok.

```
TikTok LIVE (chat, gift, follow)
   │  tiktok-live-connector
   ▼
Filter spam ──► Antrian prioritas (gift > pertanyaan > chat > follow)
   ▼
Claude (persona + 16 baris obrolan terakhir), streaming per kalimat
   ▼
TTS per kalimat (Azure / ElevenLabs / suara browser)
   ▼  WebSocket /ws
Halaman avatar (Three.js): putar audio, mulut ikut volume, waveform, subtitle
   ▼  OBS Browser Source 1080×1920
TikTok LIVE Studio / RTMP
```

## Mulai cepat

Butuh Node.js 20.12 atau lebih baru.

```bash
npm install
```

Coba dulu tanpa API key apa pun. Mode demo membalas dengan kalimat contoh dan memakai suara browser:

```bash
npm run demo
```

Buka http://localhost:5173/?debug, klik "Klik untuk mengaktifkan suara" kalau muncul, lalu kirim komentar lewat **Panel tes**.

### Pakai Claude sungguhan

```bash
cp .env.example .env
```

Isi `ANTHROPIC_API_KEY` di `.env`, lalu jalankan:

```bash
npm run dev
```

### Sambungkan ke TikTok LIVE

Isi `TIKTOK_USERNAME` (tanpa `@`) di `.env`, mulai live di TikTok, lalu jalankan server. Kalau akunnya belum live, server mengecek ulang setiap 30 detik.

## Suara (TTS)

Claude hanya menghasilkan teks; Anthropic tidak menyediakan text-to-speech. Suaranya dibuat oleh layanan lain:

| `TTS_PROVIDER` | Kualitas | Catatan |
|---|---|---|
| `edge` | Natural | **Gratis, tanpa API key.** Suara neural Microsoft Edge "Read Aloud" (`id-ID-ArdiNeural` pria, `id-ID-GadisNeural` wanita). Ini endpoint tidak resmi, jadi bisa sesekali menolak (error 429, sudah dicoba ulang otomatis) atau berhenti total kalau Microsoft memblokirnya. Untuk siaran jangka panjang, pindah ke `azure` (suara yang sama, versi resmi). |
| `elevenlabs` | Paling natural | Bisa memilih, mendesain, atau mengkloning suara, termasuk logat Batak asli. Berbayar per karakter. |
| `azure` | Natural | Azure AI Speech, ada free tier. Suaranya sama dengan `edge`, agak seperti penyiar. |
| `browser` | Kaku | Suara bawaan browser atau OS, hanya untuk tes. OBS **tidak** punya suara ini, jadi di OBS avatar bergerak tanpa suara. |

Untuk `edge`, atur kecepatan dan nada lewat `EDGE_RATE` (misalnya `+5%`) dan `EDGE_PITCH` (misalnya `+2Hz`). Nada sedikit dinaikkan membuat suaranya terdengar lebih muda dan ceria.

Audionya diputar lewat Web Audio di halaman avatar, jadi OBS bisa merekam suaranya dan gerak mulut tetap sinkron.

### Suara natural dengan ElevenLabs

1. Daftar di elevenlabs.io, lalu buat API key di **Developers → API Keys**.
2. Pilih suaranya, salah satu dari tiga cara berikut:
   - **Voice Library**: saring bahasa *Indonesian*, cari suara pria muda yang ceria, lalu **Add to My Voices**.
   - **Voice Design**: buat suara dari deskripsi, misalnya *"pria muda Indonesia dari Medan, logat Batak, ceria dan hangat"*. Seberapa kental logatnya tergantung hasil generate, jadi coba beberapa kali.
   - **Voice Cloning**: rekam 1–2 menit suara orang Batak sungguhan yang sedang mengobrol santai. Cara ini paling efektif untuk mendapatkan logat yang asli. **Wajib dengan izin orangnya.**
3. Buka suaranya, klik **Copy voice ID**, lalu isi `.env`:

   ```
   TTS_PROVIDER=elevenlabs
   ELEVENLABS_API_KEY=...
   ELEVENLABS_VOICE_ID=...
   ```

4. Dengarkan dulu tanpa live:

   ```bash
   npm run tts -- "Horas kawan! Apa kabar kau malam ini?"
   ```

   Perintah ini menyimpan `logs/tts-test.mp3`, memutarnya (di macOS), dan menampilkan berapa lama prosesnya.

Pengaturan di `.env`:

| Variabel | Default | Efek |
|---|---|---|
| `ELEVENLABS_MODEL` | `eleven_v4_turbo` | Natural dan cepat (~100ms), cocok untuk live. `eleven_v4` paling ekspresif tapi lebih lambat. `eleven_flash_v2_5` paling cepat dan murah. |
| `ELEVENLABS_STABILITY` | `0.45` | Turunkan (misalnya 0.3) supaya intonasinya lebih naik-turun dan hidup. Naikkan kalau suaranya terdengar tidak stabil. |
| `ELEVENLABS_SIMILARITY` | `0.75` | Seberapa mirip dengan suara aslinya. |
| `ELEVENLABS_STYLE` | `0` | Melebih-lebihkan gaya bicara; di atas 0 menambah latensi. |
| `ELEVENLABS_SPEED` | `1` | Kecepatan bicara. |

Setiap kalimat dikirim bersama kalimat sebelumnya (`previous_text`), jadi intonasi antarkalimat dalam satu jawaban tetap menyambung. Pengucapan juga dikunci ke bahasa Indonesia, supaya kata seperti "Horas" atau "mauliate" tidak dibaca dengan logat bahasa lain.

## Biaya

**AI hanya dipakai untuk membalas chat.** Ucapan terima kasih gift, sambutan follow, sapaan penonton yang baru masuk, dan basa-basi saat chat sepi diambil dari kalimat template di `src/server/templates.ts`. Semuanya gratis, langsung keluar, dan tidak pernah diulang berturut-turut. Kalimat template tetap dicatat ke riwayat obrolan AI, jadi kalau Ucok bertanya "kelen nonton dari kota mana?" lalu ada yang menjawab "Medan", AI tahu konteksnya.

Biaya per balasan chat (diukur di effort `low`, prompt sekitar 2.000 token dengan persona ter-cache):

| `AI_MODEL` | Per balasan chat | 5.000 chat/hari (ramai terus) |
|---|---|---|
| `claude-haiku-5-5` + `AI_THINKING=off` (disarankan untuk 24 jam) | ~$0,00015 | ~$0,75/hari |
| `claude-sonnet-5-5` + `AI_THINKING=off` | ~$0,0022 | ~$11/hari |
| `claude-opus-5-5` | ~$0,0045 | ~$22/hari |

Permintaan pertama setelah server menyala (atau setelah chat sepi lebih dari 5 menit) sedikit lebih mahal, karena persona ditulis ulang ke cache. Di Opus, bagian itu sekitar $0,007; di Haiku hampir nol. Suara `edge` gratis, dan suara untuk kalimat yang berulang disimpan di cache supaya tidak meminta ke Edge lagi.

Pengaman biaya:

- **`MAX_DAILY_USD`**: kalau biaya hari ini mencapai batas, Ucok bilang "awak istirahat balas chat dulu ya", lalu chat tidak dibalas sampai tengah malam. Gift, sapaan, dan basa-basi tetap jalan karena gratis, jadi live 24 jam tidak pernah benar-benar diam. Totalnya tersimpan di `logs/spend.json`, jadi restart server tidak mereset hitungan. `0` berarti tanpa batas.
- **Basa-basi hanya kalau ada yang nonton.** Ucok membuka obrolan sendiri (`IDLE_TALK_SECONDS`) hanya kalau TikTok LIVE tersambung, jumlah penontonnya lebih dari 0, dan ada halaman avatar yang terbuka.
- **Menyapa penonton baru** (`GREET_JOINS_SECONDS`, default 60): paling sering sekali per menit, dengan tiga nama terbaru sekaligus. Penonton yang keluar lalu masuk lagi dalam 10 menit tidak disapa dua kali. Chat dan gift selalu didahulukan.
- Setiap balasan chat mencatat token dan biayanya di log server, dan panel tes menampilkan "Biaya hari ini".

## Siaran 24 jam dari server Linux (Docker)

Dua container yang otomatis menyala lagi kalau crash atau server restart:

- **backend**: server Ucok (chat, AI, suara, halaman avatar).
- **streamer**: Chromium tanpa layar (Xvfb) membuka halaman avatar, suaranya masuk ke speaker virtual (PulseAudio), lalu `ffmpeg` mengirim gambar dan suara ke TikTok lewat RTMP.

Butuh **stream key** TikTok (biasanya untuk akun 18+ dengan sekitar 1.000 follower; tidak semua akun dan wilayah dapat). Tanpa stream key, pakai Windows dengan TikTok LIVE Studio (lihat bagian OBS di bawah).

### Server

- 4 vCPU, 8 GB RAM, Ubuntu 24.04. VPS tanpa GPU merender avatar memakai CPU.
- Lokasi Jakarta atau Singapura.
- **Kuota bandwidth minimal 1 TB/bulan.** Siaran 2,5 Mbps tanpa henti menghabiskan sekitar 27 GB per hari.

### Pasang

1. Install Docker di VPS:

   ```bash
   curl -fsSL https://get.docker.com | sh
   ```

2. Salin folder project dari komputer kamu ke VPS (termasuk `.env`):

   ```bash
   rsync -av --exclude node_modules --exclude dist --exclude logs ./ user@IP-VPS:~/ucok/
   ```

3. Di VPS, isi `TIKTOK_USERNAME` di `~/ucok/.env`, lalu jalankan:

   ```bash
   cd ~/ucok && docker compose up -d --build
   ```

   Avatar sudah jalan, tapi belum disiarkan sampai stream key diisi.

4. Buka **livecenter.tiktok.com/producer**, isi judul, klik **Save & Go LIVE**, lalu salin **Server URL** dan **Stream Key** di bagian bawah halaman. Masukkan keduanya:

   ```bash
   ./scripts/set-stream-key.sh "rtmp://...server-url..." "stream-key-kamu"
   ```

   Skrip ini menyimpan key ke `.env` (hanya bisa dibaca pemiliknya) dan me-restart streamer saja. Key tidak pernah ditampilkan di log.

### Sehari-hari

| Perlu | Perintah |
|---|---|
| Lihat siaran tersambung atau tidak | `docker compose logs -f streamer` |
| Lihat chat, balasan, dan biaya | `docker compose logs -f backend` |
| Pemakaian CPU | `docker stats` |
| Sesi live berakhir, key berganti | `./scripts/set-stream-key.sh "<Server URL>" "<Stream Key>"` |
| Ubah `.env` | `docker compose up -d` (container yang terpengaruh dibuat ulang) |
| Ubah persona | `docker compose restart backend` |
| Update kode | rsync lagi, lalu `docker compose up -d --build` |
| Panel tes `?debug` | `ssh -L 8787:localhost:8787 user@IP-VPS`, lalu buka http://localhost:8787/?debug di komputer kamu |

Port aplikasi hanya terbuka untuk VPS itu sendiri (`127.0.0.1`), karena panel tes bisa dipakai menyuntik chat palsu. Jangan dibuka ke internet; pakai SSH tunnel seperti di tabel.

Tanpa GPU, avatar 3D dirender oleh CPU. Karena itu avatar digambar 15 fps (`STREAM_RENDER_FPS`), sementara siarannya tetap 30 fps. Hasil ukur di 8 core: streamer sekitar 190% CPU (Chromium ~130%, ffmpeg ~55%), naik menjadi ~250% di 20 fps dan ~290% di 30 fps. Kalau `docker stats` menunjukkan CPU hampir penuh dan siaran patah-patah, turunkan `STREAM_RENDER_FPS=12`, lalu jalankan `docker compose up -d`. Kalau CPU masih longgar, naikkan ke 24.

Koneksi yang putus sebentar disambung ulang otomatis dengan key yang sama. Tapi kalau TikTok mengakhiri sesi live-nya, kamu perlu klik Go LIVE lagi di LIVE Center dan memasukkan key yang baru.

## Siaran lewat OBS

1. Jalankan `npm start`. Perintah ini mem-build halaman lalu menyajikannya di http://localhost:8787.
2. Di OBS, buat **Settings → Video** dengan Base dan Output Resolution **1080×1920**.
3. Tambahkan source **Browser**: URL `http://localhost:8787`, Width 1080, Height 1920, centang **Control audio via OBS**.
4. Kirim ke TikTok dengan salah satu cara berikut:
   - **Stream key** (kalau akunmu punya akses): OBS → Settings → Stream → Custom, isi Server URL dan Stream Key dari TikTok.
   - **TikTok LIVE Studio**: nyalakan **Start Virtual Camera** di OBS, lalu pilih kamera "OBS Virtual Camera" di LIVE Studio. Audio OBS perlu dirutekan ke LIVE Studio, misalnya lewat Monitor audio atau perangkat audio virtual.

Jangan buka halaman dengan `?debug` di OBS, karena panel tes akan ikut tampil di siaran.

Hanya **satu** halaman yang bersuara, jadi suara tidak pernah dobel walaupun ada beberapa tab terbuka. Halaman siaran (tanpa `?debug`, yaitu yang dipakai OBS) selalu didahulukan; kalau sama-sama, halaman yang paling lama tersambung yang menang. Halaman lain tetap beranimasi tanpa suara. Status ini terlihat di baris "Suara" pada panel tes.

## Menyesuaikan

- **Kalimat template** (terima kasih gift, follow, sapaan, basa-basi): ubah daftarnya di `src/server/templates.ts`.
- **Kepribadian AI**: ubah `persona.md` (nama dari `AI_NAME`, topik live, logat, aturan). Defaultnya anak Medan berlogat Batak ("Horas!", "Bah!", "mantap kali", "mauliate godang"). Logatnya datang dari pilihan kata; intonasinya tetap mengikuti suara TTS yang dipilih.
- **Filter spam**: `src/server/moderation.ts`. Tambah kata terlarang lewat `EXTRA_BANNED_WORDS` di `.env`. Link, nomor HP, kata kasar, judi online, banjir karakter, dan copy-paste massal dihitung di counter SPAM BLOCK. Nama penonton yang mengandung kata kasar dibacakan sebagai "kawan".
- **Ritme**: `REPLY_GAP_SECONDS` (jeda antar-jawaban), `IDLE_TALK_SECONDS` (AI membuka obrolan saat chat sepi), `USER_COOLDOWN_SECONDS`.
- **Tampilan**: warna dan posisi elemen di `src/web/style.css`. Karakter dibangun dari bentuk dasar Three.js di `src/web/avatar.ts`; warna kulit, rambut, baju, dan ulos ada di `PALETTE` di bagian atas file.
- **Model Claude**: `AI_MODEL` (default `claude-opus-5-5`), `AI_EFFORT` (default `low` supaya cepat), dan `AI_THINKING` (`off` mematikan proses berpikir di Sonnet 5.5 dan Haiku 5.5). Untuk Opus 5.5, Opus 5, Sonnet 5.5, dan Fable 5.1, permintaan yang ditolak filter keamanan otomatis dicoba ulang di model fallback rekomendasi Anthropic (`fallbacks: "default"`).

## Struktur kode

```
src/server/index.ts       entry point, merangkai semua bagian
src/server/tiktok.ts      baca chat/gift/follow + auto-reconnect
src/server/moderation.ts  filter spam
src/server/queue.ts       antrian prioritas, buang chat basi (>30 detik)
src/server/brain.ts       Claude streaming per kalimat (+ DemoBrain)
src/server/tts.ts         Azure / ElevenLabs
src/server/director.ts    loop utama: pilih event → jawab → tunggu selesai bicara
src/server/hub.ts         WebSocket ke halaman avatar, memilih satu halaman yang bersuara
src/web/avatar.ts         karakter chibi + ekspresi
src/web/voice.ts          pemutar suara, level untuk gerak mulut
src/web/main.ts           koneksi server, balon dialog, waveform, panel tes
src/server/templates.ts   kalimat gift, follow, sapaan, basa-basi (tanpa AI)
docker-compose.yml        siaran 24 jam di server Linux
docker/streamer/          Chromium + PulseAudio + ffmpeg ke RTMP
scripts/set-stream-key.sh simpan stream key baru dan restart streamer
src/shared/protocol.ts    format pesan server ↔ halaman
persona.md                system prompt
```

```bash
npm test          # unit test filter, antrian, pemecah kalimat
npm run typecheck
```

## Batasan dan risiko

- **Pembaca chat tidak resmi.** TikTok tidak menyediakan API chat LIVE untuk umum. `tiktok-live-connector` adalah hasil reverse-engineering yang bergantung pada layanan signing Euler Stream (gratis dengan batas pemakaian, `TIKTOK_SIGN_API_KEY` untuk menaikkannya), dan bisa rusak kapan saja kalau TikTok mengubah protokolnya.
- **Aturan TikTok.** TikTok mewajibkan label konten AI dan membatasi LIVE yang dianggap tidak orisinal atau tidak real-time. Tes dulu di akun cadangan dan sampaikan dengan jelas bahwa host-nya AI.
- **Syarat LIVE dari PC** (stream key atau LIVE Studio) tergantung kelayakan akun.
