// Forest Monitor: immediate threshold-triggered 2-second audio upload (RAM-only, no LittleFS)
// and GPS monitoring over Wi-Fi.
#include <Arduino.h>
#include <Preferences.h>
#include <TinyGPS++.h>
#include <WiFi.h>
#include <esp_err.h>
#include <esp_mac.h>
#include <esp_random.h>
#include <math.h>
#include "cJSON.h"
#include "driver/gpio.h"
#include "driver/i2s_std.h"
#include "esp_heap_caps.h"
#include "esp_http_client.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "ClockSync.h"

#include "node_config.h"

// Sound trigger settings (less sensitive than -60 dBFS)
constexpr float START_THRESHOLD_DBFS = -45.0f;
// Increase to 3-5 if you later want to ignore tiny 20 ms clicks/pops (1 = immediate on first breach)
constexpr uint8_t TRIGGER_BLOCKS_REQUIRED = 1;

constexpr uint32_t QUIET_REPORT_MS = 60000;
constexpr uint32_t RETRY_MS = 10000;

constexpr int kSampleRate = 22050;
constexpr int kBlockFrames = 441;  // 20 ms per block
constexpr int kBlocksPerPage = 10;
constexpr int kPageCount = 10;
constexpr int kSamplesPerPage = kBlocksPerPage * kBlockFrames;
constexpr size_t kBytesPerPage = kSamplesPerPage * sizeof(int16_t);
constexpr size_t kPcmBytes = kPageCount * kBytesPerPage;
static_assert(kPcmBytes == 88200, "Two seconds of mono 16-bit PCM required");

constexpr uint64_t kMaxEventId = 9007199254740991ULL;

struct GpsReading {
  int64_t parsedUs = 0;
  bool fix = false;
  bool hasTime = false;
  double latitude = 0;
  double longitude = 0;
  uint16_t year = 0;
  uint8_t month = 0;
  uint8_t day = 0;
  uint8_t hour = 0;
  uint8_t minute = 0;
  uint8_t second = 0;
  uint16_t millis = 0;
  char utc[16] = {};     // Format: hh:mm:ss:mmm
  char isoUtc[28] = {};  // Format: YYYY-MM-DDTHH:MM:SS.mmmZ
};

struct PcmLevel {
  int64_t sum = 0;
  int64_t squared = 0;
  uint32_t count = 0;
  int minimum = 32767;
  int maximum = -32768;

  void add(int16_t value) {
    sum += value;
    squared += int64_t(value) * value;
    ++count;
    if (value < minimum) minimum = value;
    if (value > maximum) maximum = value;
  }

  float dbfs() const {
    if (!count) return -120.0f;
    const double mean = double(sum) / count;
    const double variance = double(squared) / count - mean * mean;
    return variance > 0 ? float(20.0 * log10(sqrt(variance) / 32768.0)) : -120.0f;
  }
};

// ---------------------------------------------------------------------------
// One-Shot Boot GPS Lock + Millisecond UTC Formatting (hh:mm:ss:mmm)
// ---------------------------------------------------------------------------
HardwareSerial gpsPort(2);
TinyGPSPlus decoder;
GpsReading bootGps;
bool bootGpsLocked = false;
bool bootLocationSent = false;
uint32_t lastBootLocAttempt = 0;
portMUX_TYPE gpsLock = portMUX_INITIALIZER_UNLOCKED;

struct RmcFields {
  TinyGPSCustom clock, status, lat, northSouth;
  TinyGPSCustom lon, eastWest, date;
  explicit RmcFields(const char* name)
      : clock(decoder, name, 1),
        status(decoder, name, 2),
        lat(decoder, name, 3),
        northSouth(decoder, name, 4),
        lon(decoder, name, 5),
        eastWest(decoder, name, 6),
        date(decoder, name, 9) {}
};

RmcFields gp("GPRMC"), gn("GNRMC");

bool sixDigits(const char* text) {
  if (strlen(text) < 6) return false;
  for (int i = 0; i < 6; ++i) {
    if (text[i] < '0' || text[i] > '9') return false;
  }
  return true;
}

int daysInMonth(int year, int month) {
  static const int kDays[] = {0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
  if (month == 2 && (year % 4 == 0 && (year % 100 != 0 || year % 400 == 0))) return 29;
  return kDays[month];
}

void formatUtcWithDelta(GpsReading& reading, int64_t deltaMs) {
  if (!reading.hasTime) {
    reading.utc[0] = '\0';
    reading.isoUtc[0] = '\0';
    return;
  }
  if (deltaMs < 0) deltaMs = 0;

  const int64_t totalMs = int64_t(reading.millis) + deltaMs;
  const int ms = int(totalMs % 1000);
  const int64_t totalSec = int64_t(reading.second) + totalMs / 1000;
  const int sec = int(totalSec % 60);
  const int64_t totalMin = int64_t(reading.minute) + totalSec / 60;
  const int min = int(totalMin % 60);
  const int64_t totalHr = int64_t(reading.hour) + totalMin / 60;
  const int hr = int(totalHr % 24);
  int64_t day = int64_t(reading.day) + totalHr / 24;
  int mon = reading.month;
  int yr = reading.year;

  while (day > daysInMonth(yr, mon)) {
    day -= daysInMonth(yr, mon);
    if (++mon > 12) {
      mon = 1;
      ++yr;
    }
  }

  reading.year = uint16_t(yr);
  reading.month = uint8_t(mon);
  reading.day = uint8_t(day);
  reading.hour = uint8_t(hr);
  reading.minute = uint8_t(min);
  reading.second = uint8_t(sec);
  reading.millis = uint16_t(ms);

  // Format: hh:mm:ss:mmm (3-digit milliseconds, 000-999)
  snprintf(reading.utc, sizeof(reading.utc), "%02d:%02d:%02d:%03d", hr, min, sec, ms);
  snprintf(reading.isoUtc, sizeof(reading.isoUtc), "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ", yr, mon,
           int(day), hr, min, sec, ms);
}

bool acceptRmc(RmcFields& fields) {
  if (!fields.status.isUpdated()) return false;

  const bool active = strcmp(fields.status.value(), "A") == 0;
  const char ns = fields.northSouth.value()[0];
  const char ew = fields.eastWest.value()[0];

  GpsReading next;
  next.parsedUs = esp_timer_get_time();
  next.fix = active && fields.lat.value()[0] && fields.lon.value()[0] && (ns == 'N' || ns == 'S') &&
             (ew == 'E' || ew == 'W') && decoder.location.isValid() &&
             decoder.location.age() <= 1000;
  if (next.fix) {
    next.latitude = decoder.location.lat();
    next.longitude = decoder.location.lng();
  }

  const char* date = fields.date.value();
  const char* clock = fields.clock.value();
  if (strlen(date) == 6 && sixDigits(date) && sixDigits(clock) && decoder.date.isValid() &&
      decoder.time.isValid()) {
    const int y = decoder.date.year();
    const int m = decoder.date.month();
    const int d = decoder.date.day();
    const int h = decoder.time.hour();
    const int minute = decoder.time.minute();
    const int s = decoder.time.second();
    const int ms = int(decoder.time.centisecond()) * 10;

    if (y >= 2026 && y <= 2099 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m) &&
        h < 24 && minute < 60 && s < 60 && ms >= 0 && ms < 1000) {
      next.hasTime = true;
      next.year = uint16_t(y);
      next.month = uint8_t(m);
      next.day = uint8_t(d);
      next.hour = uint8_t(h);
      next.minute = uint8_t(minute);
      next.second = uint8_t(s);
      next.millis = uint16_t(ms);
      formatUtcWithDelta(next, 0);
    }
  }

  if (!next.fix || !next.hasTime) return false;

  portENTER_CRITICAL(&gpsLock);
  bootGps = next;
  bootGpsLocked = true;
  portEXIT_CRITICAL(&gpsLock);
  return true;
}

void gpsTask(void*) {
  for (;;) {
    while (gpsPort.available()) {
      if (decoder.encode(gpsPort.read())) {
        if (acceptRmc(gp) || acceptRmc(gn)) {
          portENTER_CRITICAL(&gpsLock);
          const GpsReading locked = bootGps;
          portEXIT_CRITICAL(&gpsLock);
          Serial.printf("[GPS] Boot fix locked (%.6f, %.6f | UTC %s); stopping GPS polling.\n",
                        locked.latitude, locked.longitude, locked.isoUtc);
          gpsPort.end();
          vTaskDelete(nullptr);
          return;
        }
      }
    }
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

bool startGps() {
  gpsPort.setRxBufferSize(2048);
  gpsPort.begin(9600, SERIAL_8N1, 16, -1);
  return xTaskCreate(gpsTask, "gps", 4096, nullptr, 2, nullptr) == pdPASS;
}

GpsReading gpsAtSnapshot() {
  portENTER_CRITICAL(&gpsLock);
  const bool locked = bootGpsLocked;
  GpsReading reading = bootGps;
  const int64_t snapshotUs = esp_timer_get_time();
  portEXIT_CRITICAL(&gpsLock);

  if (!locked) return GpsReading{};

  const int64_t deltaMs = (snapshotUs - reading.parsedUs) / 1000LL;
  formatUtcWithDelta(reading, deltaMs);
  return reading;
}

// ---------------------------------------------------------------------------
// Microphone & Immediate-Trigger 2-Second Capture (RAM only)
// ---------------------------------------------------------------------------
constexpr int kDiscardBlocks = 15;  // 300 ms warmup
constexpr int kCaptureBlocks = kBlocksPerPage * kPageCount;
constexpr int kBlockUs = kBlockFrames * 1000000LL / kSampleRate;

QueueHandle_t stamps = nullptr;
SemaphoreHandle_t dropped = nullptr;
int32_t stereo[kBlockFrames * 2];
int16_t blockSamples[kBlockFrames];  // Static to keep captureTask stack light

bool IRAM_ATTR noteBlock(i2s_chan_handle_t, i2s_event_data_t*, void*) {
  const int64_t endUs = esp_timer_get_time();
  BaseType_t wake = pdFALSE;
  if (xQueueSendFromISR(stamps, &endUs, &wake) != pdTRUE) {
    xSemaphoreGiveFromISR(dropped, &wake);
  }
  return wake == pdTRUE;
}

bool IRAM_ATTR noteDrop(i2s_chan_handle_t, i2s_event_data_t*, void*) {
  BaseType_t wake = pdFALSE;
  xSemaphoreGiveFromISR(dropped, &wake);
  return wake == pdTRUE;
}

esp_err_t openMicrophone(i2s_chan_handle_t& channel) {
  i2s_chan_config_t hardware = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);
  hardware.dma_desc_num = 6;
  hardware.dma_frame_num = kBlockFrames;
  esp_err_t err = i2s_new_channel(&hardware, nullptr, &channel);
  if (err != ESP_OK) return err;

  i2s_std_config_t mic{};
  mic.clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(kSampleRate);
  mic.slot_cfg =
      I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_STEREO);
  mic.gpio_cfg.mclk = I2S_GPIO_UNUSED;
  mic.gpio_cfg.bclk = GPIO_NUM_32;
  mic.gpio_cfg.ws = GPIO_NUM_25;
  mic.gpio_cfg.dout = I2S_GPIO_UNUSED;
  mic.gpio_cfg.din = GPIO_NUM_27;

  i2s_event_callbacks_t callbacks{};
  callbacks.on_recv = noteBlock;
  callbacks.on_recv_q_ovf = noteDrop;

  err = i2s_channel_init_std_mode(channel, &mic);
  if (err == ESP_OK) err = i2s_channel_register_event_callback(channel, &callbacks, nullptr);
  if (err == ESP_OK) err = i2s_channel_enable(channel);
  if (err != ESP_OK) {
    i2s_del_channel(channel);
    channel = nullptr;
  }
  return err;
}

// One 88.2 KB RAM buffer leaves headroom for Wi-Fi on ESP32-WROOM without PSRAM.
constexpr uint8_t kClipBuffers = 1;
int16_t* clipPages[kClipBuffers][kPageCount]{};

QueueHandle_t freeClips = nullptr;
QueueHandle_t readyClips = nullptr;
QueueHandle_t audioStatus = nullptr;
SemaphoreHandle_t manualRequest = nullptr;

struct ClipReady {
  uint8_t slot = 0;
  bool forced = false;
  int64_t firstSampleUs = 0;
  GpsReading gps;
  float triggerDbfs = -120.0f;
  float dbfs = -120.0f;
  int minimum = 0;
  int maximum = 0;
};

int uploadAudioFromRam(uint64_t id, const ClipReady& clip, bool sendLocation);

struct AudioStatus {
  float dbfs = -120.0f;
  uint32_t droppedClips = 0;
  bool active = false;
};

bool allocateRecording() {
  freeClips = xQueueCreate(kClipBuffers, sizeof(uint8_t));
  readyClips = xQueueCreate(kClipBuffers, sizeof(ClipReady));
  audioStatus = xQueueCreate(1, sizeof(AudioStatus));
  manualRequest = xSemaphoreCreateBinary();
  stamps = xQueueCreate(8, sizeof(int64_t));
  dropped = xSemaphoreCreateBinary();
  if (!freeClips || !readyClips || !audioStatus || !manualRequest || !stamps || !dropped) {
    return false;
  }
  for (uint8_t slot = 0; slot < kClipBuffers; ++slot) {
    for (auto& page : clipPages[slot]) {
      page = static_cast<int16_t*>(
          heap_caps_malloc(kBytesPerPage, MALLOC_CAP_8BIT | MALLOC_CAP_INTERNAL));
      if (!page) return false;
    }
    xQueueSend(freeClips, &slot, 0);
  }
  return true;
}

bool readMicrophoneBlock(i2s_chan_handle_t channel, int64_t& endUs) {
  size_t got = 0;
  return i2s_channel_read(channel, stereo, sizeof(stereo), &got, 350) == ESP_OK &&
         got == sizeof(stereo) && xQueueReceive(stamps, &endUs, pdMS_TO_TICKS(80)) == pdTRUE &&
         xSemaphoreTake(dropped, 0) != pdTRUE;
}

void captureSession() {
  i2s_chan_handle_t channel = nullptr;
  xQueueReset(stamps);
  xSemaphoreTake(dropped, 0);

  bool ok = openMicrophone(channel) == ESP_OK;
  for (int block = 0; ok && block < kDiscardBlocks; ++block) {
    int64_t endUs = 0;
    ok = readMicrophoneBlock(channel, endUs);
  }

  static uint32_t droppedClips = 0;
  PcmLevel idleLevel;
  int idleBlocks = 0;
  uint8_t loudStreak = 0;

  while (ok) {
    int64_t endUs = 0;
    if (!readMicrophoneBlock(channel, endUs)) {
      ok = false;
      break;
    }

    // Measure this 20 ms slice
    PcmLevel blockLevel;
    for (int i = 0; i < kBlockFrames; ++i) {
      const int16_t value = static_cast<int16_t>(stereo[2 * i] >> 16);
      blockSamples[i] = value;
      blockLevel.add(value);
      idleLevel.add(value);
    }
    ++idleBlocks;

    const float blockDbfs = blockLevel.dbfs();
    const bool forced = xSemaphoreTake(manualRequest, 0) == pdTRUE;

    if (blockDbfs >= START_THRESHOLD_DBFS) {
      if (loudStreak < TRIGGER_BLOCKS_REQUIRED) ++loudStreak;
    } else {
      loudStreak = 0;
    }

    const bool triggered = forced || (loudStreak >= TRIGGER_BLOCKS_REQUIRED);
    if (!triggered) {
      // Report quiet ambient level once every 2 seconds (100 blocks)
      if (idleBlocks >= kCaptureBlocks) {
        const AudioStatus status{idleLevel.dbfs(), droppedClips, false};
        xQueueOverwrite(audioStatus, &status);
        idleLevel = PcmLevel{};
        idleBlocks = 0;
      }
      continue;
    }

    // Threshold breached: immediately capture 2 seconds starting with this block
    loudStreak = 0;
    idleLevel = PcmLevel{};
    idleBlocks = 0;

    uint8_t slot = 0;
    if (xQueueReceive(freeClips, &slot, 0) != pdTRUE) {
      // Previous clip is still uploading from RAM; drop rather than storing on flash
      ++droppedClips;
      if (forced) xSemaphoreGive(manualRequest);
      const AudioStatus status{blockDbfs, droppedClips, true};
      xQueueOverwrite(audioStatus, &status);
      continue;
    }

    ClipReady clip;
    clip.slot = slot;
    clip.forced = forced;
    clip.firstSampleUs = endUs - kBlockUs;
    clip.gps = gpsAtSnapshot();
    clip.triggerDbfs = blockDbfs;

    // Copy the triggering 20 ms slice as block 0 so the start of the sound isn't lost
    memcpy(clipPages[slot][0], blockSamples, kBlockFrames * sizeof(int16_t));
    PcmLevel clipLevel = blockLevel;

    // Record the remaining 99 blocks (1.98 seconds) directly into RAM
    for (int block = 1; block < kCaptureBlocks; ++block) {
      if (!readMicrophoneBlock(channel, endUs)) {
        ok = false;
        break;
      }
      int16_t* destination =
          clipPages[slot][block / kBlocksPerPage] + (block % kBlocksPerPage) * kBlockFrames;
      for (int i = 0; i < kBlockFrames; ++i) {
        const int16_t value = static_cast<int16_t>(stereo[2 * i] >> 16);
        clipLevel.add(value);
        destination[i] = value;
      }
    }

    if (!ok) {
      xQueueSend(freeClips, &slot, 0);
      break;
    }

    clip.dbfs = clipLevel.dbfs();
    clip.minimum = clipLevel.minimum;
    clip.maximum = clipLevel.maximum;

    if (xQueueSend(readyClips, &clip, 0) != pdTRUE) {
      xQueueSend(freeClips, &slot, 0);
      ++droppedClips;
      if (forced) xSemaphoreGive(manualRequest);
    }

    const AudioStatus status{clip.dbfs, droppedClips, true};
    xQueueOverwrite(audioStatus, &status);
  }

  if (channel) {
    i2s_channel_disable(channel);
    i2s_del_channel(channel);
  }
}

void captureTask(void*) {
  for (;;) {
    captureSession();
    Serial.println("Microphone interrupted; retrying in 10 seconds.");
    vTaskDelay(pdMS_TO_TICKS(RETRY_MS));
  }
}

// ---------------------------------------------------------------------------
// Event ID Counter (tiny 8-byte counter in NVS; no audio files stored on flash)
// ---------------------------------------------------------------------------
Preferences counters;
uint64_t lastEventId = 0;

bool startEventCounter() {
  if (!counters.begin("forest-monitor")) return false;
  if (counters.isKey(NODE_ID)) {
    lastEventId = counters.getULong64(NODE_ID, 0);
    if (lastEventId == 0 || lastEventId > kMaxEventId) return false;
  }
  return true;
}

uint64_t nextEventId() {
  if (lastEventId >= kMaxEventId) return 0;
  const uint64_t next = lastEventId + 1;
  counters.putULong64(NODE_ID, next);
  lastEventId = next;
  return next;
}

// ---------------------------------------------------------------------------
// Direct HTTP Upload (straight from RAM to Raspberry Pi)
// ---------------------------------------------------------------------------
bool writeAll(esp_http_client_handle_t client, const void* data, size_t bytes) {
  const char* source = static_cast<const char*>(data);
  while (bytes > 0) {
    const int written = esp_http_client_write(client, source, bytes);
    if (written <= 0) return false;
    source += written;
    bytes -= written;
  }
  return true;
}

bool acknowledged(const char* reply, const char* expectedId) {
  cJSON* root = cJSON_ParseWithOpts(reply, nullptr, true);
  if (!root) return false;
  const cJSON* accepted = cJSON_GetObjectItemCaseSensitive(root, "accepted");
  const cJSON* id = cJSON_GetObjectItemCaseSensitive(root, "event_id");
  const bool matched =
      cJSON_IsTrue(accepted) && cJSON_IsString(id) && strcmp(id->valuestring, expectedId) == 0;
  cJSON_Delete(root);
  return matched;
}

void attachClockHeader(esp_http_client_handle_t client, bool& ok) {
  if (!ok) return;
  const GpsReading clockGps = gpsAtSnapshot();
  if (clockGps.hasTime && clockGps.year >= 2026 && clockGps.isoUtc[0]) {
    ok = esp_http_client_set_header(client, "X-GPS-UTC", clockGps.isoUtc) == ESP_OK;
  }
}

ClockSync clockSync;

int uploadAudioFromRam(uint64_t id, const ClipReady& clip, bool sendLocation) {
  char url[sizeof(PI_BASE_URL) + sizeof("/upload")];
  snprintf(url, sizeof(url), "%s/upload", PI_BASE_URL);
  char auth[sizeof(NODE_TOKEN) + sizeof("Bearer ")];
  snprintf(auth, sizeof(auth), "Bearer %s", NODE_TOKEN);
  char eventId[21];
  snprintf(eventId, sizeof(eventId), "%llu", (unsigned long long)id);
  char lat[24], lng[24];
  const GpsReading& gps = clip.gps;
  snprintf(lat, sizeof(lat), "%.8f", gps.latitude);
  snprintf(lng, sizeof(lng), "%.8f", gps.longitude);

  esp_http_client_config_t config{};
  config.url = url;
  config.method = HTTP_METHOD_POST;
  config.timeout_ms = 15000;
  config.disable_auto_redirect = true;

  esp_http_client_handle_t client = esp_http_client_init(&config);
  if (!client) return -1;

  const bool includeFix = sendLocation && gps.fix;
  bool ok = esp_http_client_set_header(client, "Authorization", auth) == ESP_OK &&
            esp_http_client_set_header(client, "X-Event-ID", eventId) == ESP_OK &&
            esp_http_client_set_header(client, "Content-Type", "application/octet-stream") ==
                ESP_OK &&
            esp_http_client_set_header(client, "X-Node-ID", NODE_ID) == ESP_OK &&
            esp_http_client_set_header(client, "X-Sample-Rate", "22050") == ESP_OK &&
            esp_http_client_set_header(client, "X-GPS-Fix", includeFix ? "1" : "0") == ESP_OK;

  if (includeFix && ok) {
    ok = esp_http_client_set_header(client, "X-GPS-Lat", lat) == ESP_OK &&
         esp_http_client_set_header(client, "X-GPS-Lng", lng) == ESP_OK;
  }
  attachClockHeader(client, ok);
  ok = ok && clockSync.writeCaptureHeaders(client, clip.firstSampleUs);

  ok = ok && esp_http_client_open(client, (int)kPcmBytes) == ESP_OK;

  // Stream all 10 RAM pages directly to the Pi without touching flash
  for (int page = 0; page < kPageCount && ok; ++page) {
    ok = writeAll(client, clipPages[clip.slot][page], kBytesPerPage);
  }

  int status = -1;
  if (ok && esp_http_client_fetch_headers(client) >= 0) {
    status = esp_http_client_get_status_code(client);
    char reply[512];
    const int received = esp_http_client_read_response(client, reply, sizeof(reply) - 1);
    reply[received > 0 ? received : 0] = '\0';
    if (received > 0) Serial.println(reply);
    if (status == 200 &&
        (received <= 0 || received == (int)sizeof(reply) - 1 || !acknowledged(reply, eventId))) {
      status = -2;
    }
  }

  esp_http_client_cleanup(client);
  return status;
}

int uploadLocation(uint64_t id, const GpsReading& gps, bool sendLocation) {
  char url[sizeof(PI_BASE_URL) + sizeof("/location")];
  snprintf(url, sizeof(url), "%s/location", PI_BASE_URL);
  char auth[sizeof(NODE_TOKEN) + sizeof("Bearer ")];
  snprintf(auth, sizeof(auth), "Bearer %s", NODE_TOKEN);
  char eventId[21];
  snprintf(eventId, sizeof(eventId), "%llu", (unsigned long long)id);
  char lat[24], lng[24];
  snprintf(lat, sizeof(lat), "%.8f", gps.latitude);
  snprintf(lng, sizeof(lng), "%.8f", gps.longitude);

  const bool includeFix = sendLocation && gps.fix;
  char position[160];
  const int positionSize = includeFix
      ? snprintf(position, sizeof(position),
                 R"({"node_id":"%s","gps_fix":true,"latitude":%s,"longitude":%s})", NODE_ID, lat,
                 lng)
      : snprintf(position, sizeof(position), R"({"node_id":"%s","gps_fix":false})", NODE_ID);
  if (positionSize < 0 || positionSize >= (int)sizeof(position)) return -1;

  esp_http_client_config_t config{};
  config.url = url;
  config.method = HTTP_METHOD_POST;
  config.timeout_ms = 15000;
  config.disable_auto_redirect = true;

  esp_http_client_handle_t client = esp_http_client_init(&config);
  if (!client) return -1;

  bool ok = esp_http_client_set_header(client, "Authorization", auth) == ESP_OK &&
            esp_http_client_set_header(client, "X-Event-ID", eventId) == ESP_OK &&
            esp_http_client_set_header(client, "Content-Type", "application/json") == ESP_OK;
  attachClockHeader(client, ok);

  ok = ok && esp_http_client_open(client, positionSize) == ESP_OK &&
       writeAll(client, position, positionSize);

  int status = -1;
  if (ok && esp_http_client_fetch_headers(client) >= 0) {
    status = esp_http_client_get_status_code(client);
    char reply[512];
    const int received = esp_http_client_read_response(client, reply, sizeof(reply) - 1);
    reply[received > 0 ? received : 0] = '\0';
    if (received > 0) Serial.println(reply);
    if (status == 200 &&
        (received <= 0 || received == (int)sizeof(reply) - 1 || !acknowledged(reply, eventId))) {
      status = -2;
    }
  }

  esp_http_client_cleanup(client);
  return status;
}

// ---------------------------------------------------------------------------
// Wi-Fi & Main Loop
// ---------------------------------------------------------------------------
void beginWifi() {
  // Give each boot a fresh local MAC so the Pi sees a new Wi-Fi session.
  uint8_t mac[6];
  esp_fill_random(mac, sizeof(mac));
  mac[0] = (mac[0] & 0xFC) | 0x02;

  const esp_err_t result = esp_iface_mac_addr_set(mac, ESP_MAC_WIFI_STA);
  if (result != ESP_OK) {
    Serial.printf("Could not set Wi-Fi MAC: %s\n", esp_err_to_name(result));
  }

  if (!WiFi.mode(WIFI_STA)) {
    Serial.println("Could not start Wi-Fi station mode.");
    return;
  }

  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  Serial.printf("Joining %s with MAC %s\n", WIFI_SSID, WiFi.macAddress().c_str());
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void wifiEvent(WiFiEvent_t event, WiFiEventInfo_t info) {
  if (event == ARDUINO_EVENT_WIFI_STA_GOT_IP) {
    Serial.printf("Wi-Fi connected: %s\n", WiFi.localIP().toString().c_str());
  } else if (event == ARDUINO_EVENT_WIFI_STA_DISCONNECTED) {
    Serial.printf("Wi-Fi disconnected (reason %u)\n", (unsigned)info.wifi_sta_disconnected.reason);
  }
}

bool monitoring = false;
bool heardLevel = false;
bool sessionActive = false;
bool contactSent = false;
uint32_t lastContact = 0;
uint32_t lastDropCount = 0;

void setup() {
  gpio_deep_sleep_hold_dis();
  gpio_hold_dis(GPIO_NUM_32);
  gpio_hold_dis(GPIO_NUM_25);

  Serial.begin(115200);
  delay(200);
  setCpuFrequencyMhz(80);
  Serial.printf("Continuous monitoring (RAM-only, threshold %.1f dBFS): %s\n",
                START_THRESHOLD_DBFS, NODE_ID);

  if ((strcmp(NODE_ID, "node_A") && strcmp(NODE_ID, "node_B") && strcmp(NODE_ID, "node_C")) ||
      strlen(NODE_TOKEN) < 32 || strcmp(WIFI_SSID, "YOUR_WIFI_NAME") == 0 ||
      strcmp(WIFI_PASSWORD, "YOUR_HOTSPOT_PASSWORD") == 0) {
    Serial.println("Configure the node credentials, then upload again.");
    while (true) delay(1000);
  }

  const bool buffersReady = allocateRecording();
  WiFi.persistent(false);
  WiFi.onEvent(wifiEvent);
  beginWifi();

  if (!buffersReady) {
    Serial.println("Audio buffer allocation failed.");
    return;
  }
  if (!startEventCounter()) {
    Serial.println("Event counter failed to initialize.");
    return;
  }
  if (!startGps()) {
    Serial.println("GPS task failed to start.");
    return;
  }

  monitoring = xTaskCreate(captureTask, "capture", 4096, nullptr, 3, nullptr) == pdPASS;
  Serial.println(monitoring ? "Listening. Press R to record." : "Audio task failed to start.");
}

void loop() {
  delay(10);
  const bool online = WiFi.status() == WL_CONNECTED;
  if (!monitoring) return;

  while (Serial.available()) {
    const int key = Serial.read();
    if (key == 'r' || key == 'R') xSemaphoreGive(manualRequest);
  }

  AudioStatus report;
  if (xQueueReceive(audioStatus, &report, 0) == pdTRUE) {
    heardLevel = true;
    sessionActive = report.active;
    Serial.printf("Audio %.1f dBFS (%s)\n", report.dbfs, report.active ? "triggered" : "quiet");
    if (report.droppedClips != lastDropCount) {
      lastDropCount = report.droppedClips;
      Serial.printf("Triggers missed while busy: %lu\n", (unsigned long)lastDropCount);
    }
  }

  // Immediately upload triggered 2-second clip straight from RAM, then release buffer
  ClipReady clip;
  if (xQueueReceive(readyClips, &clip, 0) == pdTRUE) {
    Serial.printf("[AUDIO] Trigger %.1f dBFS | Clip %.1f dBFS | UTC %s\n", clip.triggerDbfs,
                  clip.dbfs, clip.gps.utc[0] ? clip.gps.utc : "unknown");

    if (!online) {
      Serial.println("Wi-Fi offline; clip discarded (not stored on ESP32).");
    } else {
      const uint64_t eventId = nextEventId();
      if (eventId > 0) {
        const bool includeLocation = !bootLocationSent && clip.gps.fix;
        const int status = uploadAudioFromRam(eventId, clip, includeLocation);
        Serial.printf("Event %llu (audio), HTTP %d\n", (unsigned long long)eventId, status);
        if (status == 200) {
          contactSent = true;
          lastContact = millis();
          if (includeLocation) bootLocationSent = true;
        }
      }
    }

    // Free RAM buffer immediately so nothing stays in the ESP32
    xQueueSend(freeClips, &clip.slot, 0);
    return;
  }

  clockSync.poll(online, PI_BASE_URL, NODE_ID, NODE_TOKEN);
  const uint32_t now = millis();

  // Send boot GPS coordinates once after lock + Wi-Fi connection.
  if (online && !bootLocationSent) {
    const GpsReading gps = gpsAtSnapshot();
    if (gps.fix && (lastBootLocAttempt == 0 || now - lastBootLocAttempt >= RETRY_MS)) {
      lastBootLocAttempt = now;
      const uint64_t eventId = nextEventId();
      if (eventId > 0) {
        const int status = uploadLocation(eventId, gps, true);
        Serial.printf("Event %llu (boot GPS | UTC %s), HTTP %d\n", (unsigned long long)eventId,
                      gps.utc[0] ? gps.utc : "unknown", status);
        if (status == 200) {
          bootLocationSent = true;
          contactSent = true;
          lastContact = millis();
        }
      }
      return;
    }
  }

  // Periodic heartbeat while quiet (coordinates sent only once after boot).
  if (online && heardLevel && !sessionActive && QUIET_REPORT_MS &&
      (!contactSent || now - lastContact >= QUIET_REPORT_MS)) {
    const GpsReading gps = gpsAtSnapshot();
    const bool includeLocation = !bootLocationSent && gps.fix;
    const uint64_t eventId = nextEventId();
    if (eventId > 0) {
      const int status = uploadLocation(eventId, gps, includeLocation);
      Serial.printf("Event %llu (%s | UTC %s), HTTP %d\n", (unsigned long long)eventId,
                    includeLocation ? "boot GPS" : "heartbeat",
                    gps.utc[0] ? gps.utc : "unknown", status);
      if (status == 200) {
        contactSent = true;
        lastContact = millis();
        if (includeLocation) bootLocationSent = true;
      } else {
        // Wait before retrying heartbeat
        lastContact = millis() - (QUIET_REPORT_MS - RETRY_MS);
      }
    }
  }
}
