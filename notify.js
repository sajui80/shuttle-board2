/* 퇴근 셔틀 V2 — 자동 알림 발송기
   GitHub Actions가 평일 두 번 실행합니다.
     MODE=remind  → 16:30(IST) 미입력자에게만
     MODE=summary → 17:00(IST) 전원에게 마감 현황
   이 파일은 직접 실행하지 않습니다. */

const fs = require('fs');
const admin = require('firebase-admin');

const MODE   = (process.env.MODE || 'remind').trim();
const TARGET = MODE === 'summary' ? '17:00' : '16:30';
const TZ     = 'Asia/Kolkata';
const APP_URL = 'https://sajui80.github.io/shuttle-board2/';
const ANCHOR_MONDAY = Date.UTC(2026, 6, 20);   // 4주 기사 로테이션 기준일

const DEFAULT_CARS = [
  { id: 1, time: '17:40' }, { id: 2, time: '18:30' },
  { id: 3, time: '19:00' }, { id: 4, time: '20:00' }
];
const DEFAULT_DRIVERS = [
  { name: 'Kailash' }, { name: 'Devender' }, { name: 'Tarun' }, { name: 'Amit' }
];

const log = (...a) => console.log('[알림]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function istDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());                                    // YYYY-MM-DD
}
function istWeekday() {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(new Date());
}
function msUntil(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const now = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(new Date()).split(':').map(Number);
  return ((h * 3600 + m * 60) - (now[0] * 3600 + now[1] * 60 + now[2])) * 1000;
}
function weeksSinceAnchor(todayStr) {
  const d = new Date(todayStr + 'T00:00:00Z');
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));   // 그 주 월요일
  const weeks = Math.floor((d.getTime() - ANCHOR_MONDAY) / (7 * 86400000));
  return ((weeks % 4) + 4) % 4;
}
function driverFor(slotIdx, drivers, todayStr) {
  const i = ((slotIdx - weeksSinceAnchor(todayStr)) % drivers.length + drivers.length) % drivers.length;
  return drivers[i] || { name: '-' };
}

(async () => {
  const today = istDate();
  const wd = istWeekday();

  if (['Sat', 'Sun'].includes(wd)) { log('주말 — 발송하지 않습니다.'); return; }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) { console.error('FIREBASE_SERVICE_ACCOUNT 시크릿이 없습니다.'); process.exit(1); }

  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  const db = admin.firestore();
  const fcm = admin.messaging();

  // 휴무일 확인
  const cfg = (await db.doc('config/app').get()).data() || {};
  if ((cfg.holidays || []).includes(today) || cfg.tempHolidayDate === today) {
    log(`${today} 는 휴무일 — 발송하지 않습니다.`); return;
  }

  // 목표 시각까지 대기 (GitHub Actions 실행 지연을 흡수)
  const wait = msUntil(TARGET);
  if (wait > 0 && wait <= 45 * 60 * 1000) {
    log(`${TARGET}(IST) 까지 ${Math.round(wait / 1000)}초 대기`);
    await sleep(wait);
  } else if (wait < 0) {
    log(`${TARGET} 이 이미 지났습니다 (${Math.round(-wait / 60000)}분 초과). 즉시 발송합니다.`);
  }

  // 데이터 수집
  const cars    = cfg.cars    || DEFAULT_CARS;
  const drivers = cfg.drivers || DEFAULT_DRIVERS;
  const capacity = cfg.capacity || 5;

  const users   = (await db.collection('users').get()).docs.map(d => ({ id: d.id, ...d.data() }));
  const board   = (await db.doc('board/' + today).get()).data() || {};
  const entries = board.entries || {};
  const leaves  = (await db.collection('leaves').get()).docs.map(d => d.data());
  const onLeave = new Set(leaves.filter(l => l.start <= today && today <= l.end).map(l => l.uid));

  const counts = cars.map((c, i) => ({
    ...c,
    idx: i,
    n: Object.values(entries).filter(e => e.car === c.id).length
  }));
  const summaryLine = counts.map(c => `${c.id}호차 ${c.n}/${capacity}`).join(' · ');

  // 발송 대상
  let targets, buildMsg;

  if (MODE === 'remind') {
    targets = users.filter(u =>
      u.fcmToken && u.notifEnabled !== false && !entries[u.id] && !onLeave.has(u.id));
    buildMsg = () => ({
      title: '🚌 퇴근 셔틀 미입력 안내',
      body : '17시 마감까지 30분 남았습니다. 탑승 또는 미이용을 등록해 주세요.',
      tag  : 'shuttle-remind'
    });
    log(`미입력자 ${targets.length}명 / 전체 ${users.length}명`);
  } else {
    targets = users.filter(u => u.fcmToken && u.notifEnabled !== false);
    buildMsg = (u) => {
      const mine = entries[u.id];
      let head;
      if (mine) {
        const car = cars.find(c => c.id === mine.car) || {};
        const dr  = driverFor(cars.findIndex(c => c.id === mine.car), drivers, today);
        head = `내 차량 ${mine.car}호차 ${car.time || ''} · 기사 ${dr.name}`;
      } else if (onLeave.has(u.id)) {
        head = '오늘은 미이용으로 등록되어 있습니다.';
      } else {
        head = '미입력 상태입니다.';
      }
      return { title: '🕔 오늘 퇴근 셔틀 마감 현황', body: `${head}\n${summaryLine}`, tag: 'shuttle-summary' };
    };
    // 마감 시점 스냅샷 저장
    await db.doc('history/' + today).set({
      date: today, entries, counts, savedAt: Date.now(),
      leaves: leaves.filter(l => l.start <= today && today <= l.end)
    });
    log('마감 현황 저장 완료 —', summaryLine);
  }

  // 발송
  let ok = 0, fail = 0;
  for (const u of targets) {
    const m = buildMsg(u);
    try {
      await fcm.send({
        token: u.fcmToken,
        data: { title: m.title, body: m.body, tag: m.tag },
        webpush: { headers: { Urgency: 'high' }, fcmOptions: { link: APP_URL } }
      });
      ok++;
    } catch (e) {
      fail++;
      const code = (e && e.errorInfo && e.errorInfo.code) || e.code || '';
      if (code.includes('registration-token-not-registered') || code.includes('invalid-argument')) {
        await db.doc('users/' + u.id).update({ fcmToken: admin.firestore.FieldValue.delete() }).catch(() => {});
        log(`${u.name} — 만료된 토큰 정리`);
      } else {
        log(`${u.name} — 발송 실패: ${code || e.message}`);
      }
    }
  }
  log(`발송 완료 — 성공 ${ok}건, 실패 ${fail}건`);

  // 실행 기록 (레포 활동을 유지해 예약 실행이 중단되지 않게 함)
  try {
    const month = today.slice(0, 7);
    const file  = `logs/${month}.md`;
    fs.mkdirSync('logs', { recursive: true });
    const line = `- ${today} ${TARGET} · ${MODE === 'remind' ? '미입력 안내' : '마감 현황'} · 대상 ${targets.length}명 · 성공 ${ok} 실패 ${fail}\n`;
    fs.appendFileSync(file, fs.existsSync(file) ? line : `# ${month} 알림 발송 기록\n\n${line}`);
  } catch (e) { log('기록 저장 생략:', e.message); }
})().catch(e => { console.error('오류:', e); process.exit(1); });
