#pragma once

#include <Arduino.h>
#include "esp_http_client.h"
#include "esp_timer.h"

class ClockSync {
 public:
  template <size_t BaseSize, size_t TokenSize>
  void poll(bool connected, const char (&baseUrl)[BaseSize], const char* nodeId,
            const char (&token)[TokenSize]) {
    if (!connected) {
      count_ = nextSample_ = 0;
      nextProbeUs_ = 0;
      return;
    }
    if (esp_timer_get_time() < nextProbeUs_) return;

    char url[BaseSize + sizeof("/clock")];
    snprintf(url, sizeof(url), "%s/clock", baseUrl);
    char auth[TokenSize + sizeof("Bearer ")];
    snprintf(auth, sizeof(auth), "Bearer %s", token);

    Exchange exchange;
    esp_http_client_config_t config{};
    config.url = url;
    config.method = HTTP_METHOD_GET;
    config.timeout_ms = 350;
    config.disable_auto_redirect = true;
    config.event_handler = onClockResponse;
    config.user_data = &exchange;
    auto client = esp_http_client_init(&config);
    if (client) {
      const bool ok = esp_http_client_set_header(client, "Authorization", auth) == ESP_OK &&
                      esp_http_client_set_header(client, "X-Node-ID", nodeId) == ESP_OK &&
                      esp_http_client_perform(client) == ESP_OK &&
                      esp_http_client_get_status_code(client) == 204;
      esp_http_client_cleanup(client);
      if (ok) record(exchange);
    }
    nextProbeUs_ = esp_timer_get_time() + 4000000;
  }

  bool writeCaptureHeaders(esp_http_client_handle_t client, int64_t localStartUs) const {
    if (!setTimeHeader(client, "X-Audio-Start-Us", localStartUs)) return false;

    const Sample* best = nullptr;
    int64_t bestAge = 0;
    for (size_t i = 0; i < count_; ++i) {
      const Sample& sample = samples_[i];
      const int64_t delta = localStartUs - sample.localMidpointUs;
      const int64_t age = delta < 0 ? -delta : delta;
      if (age > kMaxSampleAgeUs) continue;
      if (!best || sample.roundTripUs < best->roundTripUs ||
          (sample.roundTripUs == best->roundTripUs && age < bestAge)) {
        best = &sample;
        bestAge = age;
      }
    }
    if (!best || localStartUs + best->offsetUs < 0) return true;

    return esp_http_client_set_header(client, "X-Audio-Pi-Clock-Id", clockId_) == ESP_OK &&
           setTimeHeader(client, "X-Audio-Pi-Start-Us", localStartUs + best->offsetUs) &&
           setTimeHeader(client, "X-Audio-Sync-Rtt-Us", best->roundTripUs) &&
           setTimeHeader(client, "X-Audio-Sync-Age-Us", bestAge);
  }

 private:
  static constexpr size_t kSampleCount = 5;
  static constexpr int64_t kMaxSampleAgeUs = 15000000;
  static constexpr int64_t kMaxRoundTripUs = 100000;
  static constexpr int64_t kMaxWireTimeUs = 9007199254740991LL;

  struct Exchange {
    int64_t localSendUs = -1;
    int64_t piReceiveUs = -1;
    int64_t piSendUs = -1;
    int64_t localReceiveUs = -1;
    char clockId[33] = {};
  };

  struct Sample {
    int64_t localMidpointUs;
    int64_t offsetUs;
    int64_t roundTripUs;
  };

  char clockId_[33] = {};
  Sample samples_[kSampleCount] = {};
  size_t count_ = 0;
  size_t nextSample_ = 0;
  int64_t nextProbeUs_ = 0;

  static bool setTimeHeader(esp_http_client_handle_t client, const char* name, int64_t us) {
    char value[24];
    snprintf(value, sizeof(value), "%lld", static_cast<long long>(us));
    return esp_http_client_set_header(client, name, value) == ESP_OK;
  }

  static int64_t readTime(const char* value) {
    const size_t length = strnlen(value, 17);
    if (!length || length > 16) return -1;
    int64_t timeUs = 0;
    for (size_t i = 0; i < length; ++i) {
      if (value[i] < '0' || value[i] > '9') return -1;
      timeUs = timeUs * 10 + (value[i] - '0');
    }
    return timeUs <= kMaxWireTimeUs ? timeUs : -1;
  }

  static esp_err_t onClockResponse(esp_http_client_event_t* event) {
    auto& exchange = *static_cast<Exchange*>(event->user_data);
    if (event->event_id == HTTP_EVENT_ON_CONNECTED) {
      exchange.localSendUs = esp_timer_get_time();
    }
    if (event->event_id != HTTP_EVENT_ON_HEADER) return ESP_OK;
    if (exchange.localReceiveUs < 0) exchange.localReceiveUs = esp_timer_get_time();
    if (strcasecmp(event->header_key, "X-Pi-Receive-Us") == 0) {
      exchange.piReceiveUs = readTime(event->header_value);
    } else if (strcasecmp(event->header_key, "X-Pi-Send-Us") == 0) {
      exchange.piSendUs = readTime(event->header_value);
    } else if (strcasecmp(event->header_key, "X-Pi-Clock-Id") == 0 &&
               strnlen(event->header_value, 33) == 32 &&
               strspn(event->header_value, "0123456789abcdef") == 32) {
      memcpy(exchange.clockId, event->header_value, sizeof(exchange.clockId));
    }
    return ESP_OK;
  }

  void record(const Exchange& exchange) {
    if (!exchange.clockId[0] || exchange.localSendUs < 0 ||
        exchange.localReceiveUs < exchange.localSendUs || exchange.piReceiveUs < 0 ||
        exchange.piSendUs < exchange.piReceiveUs) return;

    const int64_t localElapsed = exchange.localReceiveUs - exchange.localSendUs;
    const int64_t roundTrip = localElapsed - (exchange.piSendUs - exchange.piReceiveUs);
    if (roundTrip < 0 || roundTrip > kMaxRoundTripUs) return;
    const bool newClock = !count_ || strcmp(clockId_, exchange.clockId) != 0;
    if (newClock) {
      memcpy(clockId_, exchange.clockId, sizeof(clockId_));
      count_ = nextSample_ = 0;
      Serial.printf("[CLOCK] Pi time available, round trip %lld us\n",
                    static_cast<long long>(roundTrip));
    }

    const int64_t offset = ((exchange.piReceiveUs - exchange.localSendUs) +
                            (exchange.piSendUs - exchange.localReceiveUs)) / 2;
    samples_[nextSample_] = {exchange.localSendUs + localElapsed / 2, offset, roundTrip};
    nextSample_ = (nextSample_ + 1) % kSampleCount;
    if (count_ < kSampleCount) ++count_;
  }
};
