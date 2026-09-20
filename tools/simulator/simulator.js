#!/usr/bin/env node
/**
 * Device simulator — meniru stasiun cuaca sungguhan yang mengirim payload
 * sesuai spesifikasi Bagian F.1.
 *
 * Ditulis sebagai JavaScript polos tanpa dependensi apa pun (memakai `fetch`
 * bawaan Node 18+), supaya reviewer bisa menjalankannya dengan satu perintah
 * tanpa `npm install` di folder ini.
 *
 * Skenario:
 *
 *   normal         Tiap device mengirim satu payload tiap interval, terus-menerus.
 *   offline-batch  Device "mati" beberapa menit, menumpuk pembacaan di buffer,
 *                  lalu mengirimnya sekaligus sebagai batch.
 *   duplicate      Payload yang sama persis dikirim tiga kali, meniru device
 *                  yang tidak menerima ACK lalu mengulang.
 *   demo           Menjalankan ketiganya sekali jalan dan mencetak ringkasan.
 *                  Inilah cara tercepat membuktikan idempotensi bekerja.
 *
 * Contoh:
 *   node tools/simulator/simulator.js --scenario demo
 *   node tools/simulator/simulator.js --scenario normal --interval 10
 *   node tools/simulator/simulator.js --scenario offline-batch --minutes 180
 */

'use strict';

const { readFileSync } = require('node:fs');
const { join } = require('node:path');

// ---------------------------------------------------------------------------
// Konfigurasi
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));

const BASE_URL = (
  args['base-url'] ||
  process.env.SIMULATOR_API_BASE_URL ||
  'http://localhost:3001'
).replace(/\/$/, '');

const SCENARIO = args.scenario || 'demo';
const INTERVAL_SECONDS = Number(args.interval || process.env.SIMULATOR_INTERVAL_SECONDS || 60);
const OFFLINE_MINUTES = Number(args.minutes || 180);

const devices = JSON.parse(
  readFileSync(join(__dirname, 'devices.json'), 'utf8'),
).devices.filter((device) => !args.device || device.device_code === args.device);

if (devices.length === 0) {
  console.error(`Device "${args.device}" tidak ada di devices.json`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Keadaan per device
// ---------------------------------------------------------------------------

/**
 * Setiap device menyimpan keadaannya sendiri, persis seperti firmware
 * sungguhan: nomor urut yang bertambah, pencacah hujan yang hanya naik, dan
 * tegangan baterai yang perlahan turun.
 */
const state = new Map(
  devices.map((device) => [
    device.device_code,
    {
      seq: Math.floor(Math.random() * 10000),
      rainCounter: 1000 + Math.floor(Math.random() * 500),
      batteryV: 4.05,
      uptimeS: Math.floor(Math.random() * 100000),
    },
  ]),
);

// ---------------------------------------------------------------------------
// Pembangkit pembacaan
// ---------------------------------------------------------------------------

/**
 * Menyusun satu sampel pembacaan.
 *
 * Perhatikan dua hal yang sengaja ditiru dari perangkat sungguhan:
 *
 *  1. `rain_counter` mengirim NILAI KUMULATIF, bukan curah hujan. Backend yang
 *     bertugas mengubahnya menjadi milimeter per interval.
 *  2. Sensor yang sedang error TIDAK ikut dikirim, sehingga panjang array
 *     `readings` berubah-ubah — persis seperti catatan di spesifikasi payload.
 */
function buildSample(deviceCode, timestamp) {
  const deviceState = state.get(deviceCode);
  deviceState.seq += 1;
  deviceState.uptimeS += INTERVAL_SECONDS;
  deviceState.batteryV = Math.max(3.4, deviceState.batteryV - 0.00002);

  const hourWib = ((timestamp.getUTCHours() + 7) % 24) + timestamp.getUTCMinutes() / 60;
  const sun = Math.max(0, Math.sin(((hourWib - 6) / 12) * Math.PI));

  // Hujan sore hari khas tropis.
  if (hourWib >= 14 && hourWib <= 18 && Math.random() < 0.25) {
    deviceState.rainCounter += Math.floor(Math.random() * 5) + 1;
  }

  const readings = [
    { s: 'temp_air', v: round(23 + 7 * sun + (Math.random() - 0.5) * 1.5, 1) },
    { s: 'humidity', v: round(90 - 35 * sun + (Math.random() - 0.5) * 6, 1) },
    { s: 'pressure', v: round(1008 + (Math.random() - 0.5) * 2, 1) },
    { s: 'wind_speed', v: round(Math.max(0, 1.5 + 3 * sun + (Math.random() - 0.5) * 2), 1) },
    { s: 'wind_dir', v: Math.floor(Math.random() * 360) },
    { s: 'rain_counter', v: deviceState.rainCounter },
    { s: 'solar_rad', v: round(sun * 900, 1) },
  ];

  // Sekali-sekali satu sensor "error" dan tidak ikut dikirim. Ini yang membuat
  // array bisa lebih pendek, dan backend harus menganggapnya normal.
  if (Math.random() < 0.05) {
    readings.splice(Math.floor(Math.random() * readings.length), 1);
  }

  return {
    ts: Math.floor(timestamp.getTime() / 1000),
    seq: deviceState.seq,
    battery_v: round(deviceState.batteryV, 2),
    rssi: -60 - Math.floor(Math.random() * 35),
    readings,
  };
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// ---------------------------------------------------------------------------
// Pengiriman
// ---------------------------------------------------------------------------

async function post(device, path, body) {
  const response = await fetch(`${BASE_URL}/api/v1${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Inilah kredensial device: bagian publik dan rahasia digabung titik.
      'X-Device-Key': `${device.key_id}.${device.secret}`,
    },
    body: JSON.stringify(body),
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = { parse_error: true };
  }

  return { status: response.status, payload };
}

/** Mencetak hasil dalam satu baris ringkas. */
function report(label, deviceCode, result) {
  const data = result.payload && result.payload.data;
  let summary = '';

  if (data && data.accepted !== undefined) {
    summary = `accepted=${data.accepted} duplicated=${data.duplicated} rejected=${data.rejected}`;
  } else if (data && data.device_time) {
    // Heartbeat menjawab bentuk yang berbeda: ia tidak membawa pembacaan.
    summary = `device_time=${data.device_time}`;
  } else if (result.payload && result.payload.error) {
    summary = `${result.payload.error.code}: ${result.payload.error.message}`;
  }

  console.log(`  [${result.status}] ${label.padEnd(22)} ${deviceCode}  ${summary}`);
}

/**
 * Menyelaraskan pencacah hujan dengan nilai terakhir yang sudah ada di server.
 *
 * Tanpa ini, simulator memulai pencacah dari angka acak yang tidak ada
 * hubungannya dengan data historis. Backend akan menafsirkan lompatannya
 * sebagai hujan ratusan milimeter dalam satu interval - perilaku yang
 * sebenarnya BENAR (begitulah tipping bucket bekerja), tetapi membuat data
 * peragaan terlihat kacau.
 *
 * Perangkat sungguhan tidak punya masalah ini karena pencacahnya memang
 * berlanjut dari keadaan terakhirnya sendiri.
 */
async function syncRainCounters() {
  try {
    const response = await fetch(`${BASE_URL}/api/v1/dashboard/overview`);
    if (!response.ok) {
      return;
    }

    const overview = await response.json();
    const byCode = new Map(overview.data.map((row) => [row.device_code, row.id]));

    for (const device of devices) {
      const deviceId = byCode.get(device.device_code);
      if (!deviceId) {
        continue;
      }

      const latest = await fetch(`${BASE_URL}/api/v1/devices/${deviceId}/readings/latest`);
      if (!latest.ok) {
        continue;
      }

      const payload = await latest.json();
      const rain = payload.data.find((row) => row.sensor_type === 'rain_counter');

      if (rain && typeof rain.raw_value === 'number') {
        state.get(device.device_code).rainCounter = rain.raw_value;
      }
    }
  } catch {
    // Server belum siap atau endpoint tidak tersedia: simulator tetap jalan
    // dengan pencacah awalnya sendiri.
  }
}

// ---------------------------------------------------------------------------
// Skenario
// ---------------------------------------------------------------------------

/** Pengiriman normal: satu payload per device per interval. */
async function scenarioNormal() {
  console.log(
    `Skenario NORMAL — ${devices.length} device mengirim tiap ${INTERVAL_SECONDS} detik. ` +
      'Tekan Ctrl+C untuk berhenti.\n',
  );

  const tick = async () => {
    const now = new Date();
    for (const device of devices) {
      const sample = buildSample(device.device_code, now);
      const result = await post(device, '/ingest/telemetry', {
        device_id: device.device_code,
        fw: '1.4.2',
        ...sample,
      });
      report('telemetry', device.device_code, result);
    }
  };

  await tick();
  setInterval(() => {
    void tick();
  }, INTERVAL_SECONDS * 1000);
}

/**
 * Device offline lalu mengirim data yang tertahan.
 *
 * Payload buffered sengaja dikirim dalam urutan ACAK, bukan kronologis, untuk
 * membuktikan backend benar-benar mengurutkannya sendiri sebelum menghitung
 * delta pencacah hujan.
 */
async function scenarioOfflineBatch() {
  console.log(
    `Skenario OFFLINE-BATCH — tiap device menumpuk ${OFFLINE_MINUTES} menit pembacaan, ` +
      'lalu mengirimnya sekaligus dalam urutan acak.\n',
  );

  for (const device of devices) {
    const now = Date.now();
    const batch = [];

    for (let minutesAgo = OFFLINE_MINUTES; minutesAgo >= 1; minutesAgo -= 1) {
      batch.push(buildSample(device.device_code, new Date(now - minutesAgo * 60_000)));
    }

    // Acak urutannya.
    for (let i = batch.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [batch[i], batch[j]] = [batch[j], batch[i]];
    }

    const result = await post(device, '/ingest/telemetry/batch', {
      device_id: device.device_code,
      fw: '1.4.2',
      batch,
    });

    report(`batch ${batch.length} record`, device.device_code, result);
  }
}

/**
 * Payload yang sama dikirim tiga kali.
 *
 * Hasil yang diharapkan: pengiriman pertama accepted=N duplicated=0, dua
 * berikutnya accepted=0 duplicated=N — dan KETIGANYA dijawab 200, bukan error.
 * Device mengulang justru karena belum menerima ACK; menjawab 4xx akan
 * membuatnya mengulang selamanya.
 */
async function scenarioDuplicate() {
  console.log('Skenario DUPLICATE — payload identik dikirim 3 kali.\n');

  for (const device of devices) {
    // Timestamp digeser mundur 90 detik supaya tidak bertabrakan dengan
    // payload yang dikirim langkah lain dalam skenario demo. Tanpa ini,
    // kiriman PERTAMA pun sudah terhitung duplikat dan peragaannya jadi
    // membingungkan - walaupun perilaku backend-nya sebenarnya benar.
    const sample = buildSample(device.device_code, new Date(Date.now() - 90_000));
    const payload = { device_id: device.device_code, fw: '1.4.2', ...sample };

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const result = await post(device, '/ingest/telemetry', payload);
      report(`kiriman ke-${attempt}`, device.device_code, result);
    }
  }
}

/** Heartbeat sekali untuk tiap device. */
async function sendHeartbeats() {
  for (const device of devices) {
    const deviceState = state.get(device.device_code);
    const result = await post(device, '/ingest/heartbeat', {
      device_id: device.device_code,
      ts: Math.floor(Date.now() / 1000),
      fw: '1.4.2',
      battery_v: round(deviceState.batteryV, 2),
      rssi: -70,
      uptime_s: deviceState.uptimeS,
    });
    report('heartbeat', device.device_code, result);
  }
}

/** Menjalankan seluruh skenario sekali jalan sebagai peragaan. */
async function scenarioDemo() {
  console.log(`Target API: ${BASE_URL}\n`);

  console.log('1/4 Heartbeat');
  await sendHeartbeats();

  console.log('\n2/4 Telemetri normal');
  for (const device of devices) {
    const sample = buildSample(device.device_code, new Date());
    const result = await post(device, '/ingest/telemetry', {
      device_id: device.device_code,
      fw: '1.4.2',
      ...sample,
    });
    report('telemetry', device.device_code, result);
  }

  console.log('\n3/4 Duplikat (idempotensi)');
  await scenarioDuplicate();

  console.log('\n4/4 Data buffered, urutan acak');
  await scenarioOfflineBatch();

  console.log('\nSelesai.');
}

// ---------------------------------------------------------------------------

async function main() {
  const scenarios = {
    normal: scenarioNormal,
    'offline-batch': scenarioOfflineBatch,
    duplicate: scenarioDuplicate,
    demo: scenarioDemo,
  };

  const run = scenarios[SCENARIO];
  if (run) {
    await syncRainCounters();
  }
  if (!run) {
    console.error(
      `Skenario "${SCENARIO}" tidak dikenal. Pilihan: ${Object.keys(scenarios).join(', ')}`,
    );
    process.exit(1);
  }

  await run();
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        result[key] = next;
        i += 1;
      } else {
        result[key] = true;
      }
    }
  }
  return result;
}

main().catch((error) => {
  console.error('Simulator gagal:', error.message);
  process.exit(1);
});
