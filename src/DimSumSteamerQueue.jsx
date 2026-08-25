import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../convex/_generated/api';
import { Hourglass, ChefHat, X, Delete, Plus, Play, Pencil, Repeat, History, ChevronDown, ChevronUp, Maximize, Minimize } from 'lucide-react';

// Convex เป็น source of truth กลาง: useQuery จะอัปเดตทุกหน้าจอแบบ Real-time

const DEFAULT_DURATION = 600; // 10:00 เวลานึ่งเริ่มต้น ปรับได้ทีละรอบ
const RECOOK_DURATION = 180; // 03:00 เวลาเริ่มต้นสำหรับรายการแก้/นึ่งซ้ำ
const DURATION_STEP = 30; // +/- 30 วิ ต่อการกด
const MIN_DURATION = 60; // 1:00 ต่ำสุด
const MAX_DURATION = 1800; // 30:00 สูงสุด
const MIN_BASKETS = 1;
const MAX_BASKETS = 50;
const OVERDUE_LIMIT_AFTER_ZERO = 60; // เกินเวลาไป 1 นาที -> แดง
const LONG_WAIT_WARNING = 5 * 60; // รอเกิน 5 นาที -> กระพริบแดงเตือน
const AUTO_CLOSE_OVERDUE_SECONDS = 40 * 60; // เกินเวลาไปครบ 40 นาทีแล้วไม่มีคนเคลียร์ -> ปิดอัตโนมัติ
const UNSPECIFIED_TABLE = 'ไม่ระบุ';

function formatMMSS(totalSeconds) {
  const sign = totalSeconds < 0 ? '-' : '';
  const abs = Math.abs(totalSeconds);
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return `${sign}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function getPotStatus(elapsed, duration) {
  const remaining = duration - elapsed;
  if (remaining > 60) return 'blue';
  if (remaining > 0) return 'yellow';
  if (elapsed - duration <= OVERDUE_LIMIT_AFTER_ZERO) return 'green';
  return 'red';
}

const STATUS_STYLE = {
  blue: { bg: 'bg-sky-600', border: 'border-sky-400', text: 'text-white' },
  yellow: { bg: 'bg-amber-500', border: 'border-amber-300', text: 'text-slate-900' },
  green: { bg: 'bg-emerald-600', border: 'border-emerald-400', text: 'text-white' },
  red: { bg: 'bg-rose-600', border: 'border-rose-400', text: 'text-white' },
  purple: { bg: 'bg-purple-600', border: 'border-purple-400', text: 'text-white' },
  brown: { bg: 'bg-[#8B5A2B]', border: 'border-[#C89B6E]', text: 'text-white' },
};

const STATUS_LABEL = {
  blue: 'กำลังนึ่ง',
  yellow: 'ใกล้เสร็จแล้ว',
  green: 'เสร็จแล้ว — แตะเพื่อเสิร์ฟ',
  red: 'นึ่งเกินเวลา — แตะเพื่อเคลียร์',
  purple: 'กำลังนึ่งแก้',
  brown: 'กำลังนึ่ง (กลับบ้าน)',
};

function newId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function tableLabel(table) {
  return table === UNSPECIFIED_TABLE ? UNSPECIFIED_TABLE : `โต๊ะ ${table}`;
}

function dayBounds(timestamp) {
  const start = new Date(timestamp);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { dayStart: start.getTime(), dayEnd: end.getTime() };
}

export default function DimSumSteamerQueue() {
  const [numpadValue, setNumpadValue] = useState('');
  const [isFixOrder, setIsFixOrder] = useState(false); // ติ๊กตอนเพิ่มโต๊ะ = รายการแก้/นึ่งซ้ำ
  const [isTakeawayOrder, setIsTakeawayOrder] = useState(false); // ติ๊กตอนเพิ่มโต๊ะ = กลับบ้าน/ห่อกลับ
  const [now, setNow] = useState(Date.now()); // ตัวขับ countdown
  const [editingPotId, setEditingPotId] = useState(null); // id ของโต๊ะที่กำลังแก้ไขหมายเลข (modal)
  const [editValue, setEditValue] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [isNumpadHidden, setIsNumpadHidden] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [closeRequest, setCloseRequest] = useState(null);
  const [mutationError, setMutationError] = useState('');
  const autoClosePendingRef = useRef(new Set());

  const bounds = dayBounds(now);
  const cloudPots = useQuery(api.pots.getPots);
  const cloudHistory = useQuery(api.pots.getHistory, bounds);
  const createPotMutation = useMutation(api.pots.createPot);
  const adjustBasketsMutation = useMutation(api.pots.adjustBaskets);
  const adjustDurationMutation = useMutation(api.pots.adjustDuration);
  const startSteamingMutation = useMutation(api.pots.startSteaming);
  const editTableMutation = useMutation(api.pots.editTable);
  const removePotMutation = useMutation(api.pots.removePot);
  const completePotMutation = useMutation(api.pots.completePot);
  const autoClosePotMutation = useMutation(api.pots.autoClosePot);

  const pots = (cloudPots || []).map(({ _id, _creationTime, potId, ...rest }) => ({
    id: _id,
    potId,
    ...rest,
  }));
  const history = (cloudHistory || []).map(({ _id, _creationTime, potId, ...rest }) => ({
    id: _id,
    potId,
    ...rest,
  }));

  const runMutation = async (mutation, args) => {
    try {
      setMutationError('');
      return await mutation(args);
    } catch (error) {
      console.error(error);
      setMutationError(error?.message || 'บันทึกข้อมูลไม่สำเร็จ ระบบจะลองใหม่เมื่ออินเทอร์เน็ตกลับมา');
      return false;
    }
  };

  // ★ นาฬิกากลางตัวเดียว ขับทั้งหน้า — cleanup กัน timer ค้างตอน unmount
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // iPadOS 17 รองรับ Fullscreen API — ฟัง event เพื่อให้ข้อความบนปุ่มตรงกับสถานะจริง
  useEffect(() => {
    const syncFullscreenState = () => setIsFullscreen(Boolean(document.fullscreenElement || document.webkitFullscreenElement));
    document.addEventListener('fullscreenchange', syncFullscreenState);
    document.addEventListener('webkitfullscreenchange', syncFullscreenState);
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreenState);
      document.removeEventListener('webkitfullscreenchange', syncFullscreenState);
    };
  }, []);

  // เกินเวลา 40 นาที: ทุกเครื่องอาจเรียกพร้อมกันได้ แต่ mutation ตรวจสถานะใน transaction เดียว
  useEffect(() => {
    const toClose = pots.filter((p) => {
      if (p.status !== 'active' || !p.startedAt) return false;
      const elapsed = Math.floor((now - p.startedAt) / 1000);
      return elapsed - p.duration >= AUTO_CLOSE_OVERDUE_SECONDS;
    });
    toClose.forEach((pot) => {
      if (autoClosePendingRef.current.has(pot.id)) return;
      autoClosePendingRef.current.add(pot.id);
      runMutation(autoClosePotMutation, { id: pot.id }).finally(() => {
        autoClosePendingRef.current.delete(pot.id);
      });
    });
  }, [now, cloudPots, autoClosePotMutation]);

  // ---------- คิวรอ / เพิ่มโต๊ะ ----------
  const addTable = async () => {
    const table = numpadValue.trim();
    if (!table) return;
    const created = await runMutation(createPotMutation, {
      potId: newId('p'),
      table,
      duration: isFixOrder ? RECOOK_DURATION : DEFAULT_DURATION,
      isFix: isFixOrder,
      isTakeaway: isTakeawayOrder,
    });
    if (!created) return;
    setNumpadValue('');
    setIsFixOrder(false); // รีเซ็ตกลับปกติ ต้องติ๊กใหม่ทุกครั้งถ้าโต๊ะถัดไปเป็นรายการแก้อีก
    setIsTakeawayOrder(false);
  };

  // เพิ่มโต๊ะแบบยังไม่รู้เลขโต๊ะ -> เริ่มนึ่งไปก่อนได้เลย แล้วค่อยมาแก้เลขทีหลัง
  const addUnspecifiedTable = async () => {
    const created = await runMutation(createPotMutation, {
      potId: newId('p'),
      table: UNSPECIFIED_TABLE,
      duration: isFixOrder ? RECOOK_DURATION : DEFAULT_DURATION,
      isFix: isFixOrder,
      isTakeaway: isTakeawayOrder,
    });
    if (!created) return;
    setIsFixOrder(false);
    setIsTakeawayOrder(false);
  };

  const handleNumpadPress = (d) => {
    setNumpadValue((prev) => (prev.length >= 4 ? prev : prev + d));
  };

  const handleBackspace = () => setNumpadValue((prev) => prev.slice(0, -1));

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        const exitFullscreen = document.exitFullscreen || document.webkitExitFullscreen;
        if (exitFullscreen) await exitFullscreen.call(document);
      } else {
        const requestFullscreen = document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen;
        if (requestFullscreen) await requestFullscreen.call(document.documentElement);
      }
    } catch {
      // หาก browser ไม่อนุญาต (เช่น เปิดผ่าน in-app browser) ให้ใช้งานส่วนอื่นต่อได้ตามปกติ
    }
  };

  // ขอการยืนยันก่อนยกเลิกทุกครั้ง ป้องกันมือโดน X โดยไม่ตั้งใจ
  const removePot = (id) => {
    setCloseRequest({ id, type: 'cancel' });
  };

  const adjustBaskets = (id, delta) => {
    runMutation(adjustBasketsMutation, { id, delta });
  };

  const adjustDuration = (id, delta) => {
    runMutation(adjustDurationMutation, { id, delta });
  };

  // mutation ทำงานแบบ transaction: สองเครื่องกดพร้อมกันจะเริ่มได้เพียงครั้งเดียว
  const startSteaming = async (id) => {
    const started = await runMutation(startSteamingMutation, { id });
    if (!started) setMutationError('รายการนี้ถูกเริ่มนึ่งหรือยกเลิกจากอีกเครื่องแล้ว');
  };

  const clearPot = (id, status) => {
    if (status !== 'green' && status !== 'red') return;
    setCloseRequest({ id, type: 'complete', status });
  };

  const confirmClose = async () => {
    if (!closeRequest) return;
    const pot = pots.find((p) => p.id === closeRequest.id);
    if (pot) {
      if (closeRequest.type === 'complete') {
        await runMutation(completePotMutation, { id: pot.id });
      } else {
        await runMutation(removePotMutation, { id: pot.id });
      }
    }
    setCloseRequest(null);
  };

  // ---------- แก้ไขหมายเลขโต๊ะ (ทำได้แม้กำลังนึ่งอยู่ เวลานับถอยหลังไม่เปลี่ยน) ----------
  const openEditTable = (id) => {
    setEditingPotId(id);
    setEditValue('');
  };

  const closeEditTable = () => {
    setEditingPotId(null);
    setEditValue('');
  };

  const handleEditNumpadPress = (d) => {
    setEditValue((prev) => (prev.length >= 4 ? prev : prev + d));
  };

  const handleEditBackspace = () => setEditValue((prev) => prev.slice(0, -1));

  const confirmEditTable = async () => {
    const newTable = editValue.trim();
    if (!newTable) return;
    await runMutation(editTableMutation, { id: editingPotId, table: newTable });
    closeEditTable();
  };

  // ---------- แบ่งกลุ่ม + เรียงลำดับ ----------
  const reserved = pots.filter((p) => p.status === 'reserved').sort((a, b) => a.reservedAt - b.reservedAt);

  const active = pots
    .filter((p) => p.status === 'active')
    .map((p) => {
      const elapsed = Math.floor((now - p.startedAt) / 1000);
      return { pot: p, elapsed, remaining: p.duration - elapsed };
    })
    .sort((a, b) => a.remaining - b.remaining);
  const pendingPot = closeRequest ? pots.find((p) => p.id === closeRequest.id) : null;

  return (
    <div className="app-root w-full min-h-screen md:h-screen md:min-h-[640px] bg-slate-950 text-slate-100 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden select-none">
      {(cloudPots === undefined || mutationError) && (
        <div
          className={`fixed top-2 left-1/2 -translate-x-1/2 z-[70] rounded-full px-3 py-1.5 text-xs font-bold shadow-lg ${
            mutationError ? 'bg-rose-600 text-white' : 'bg-amber-400 text-slate-950'
          }`}
        >
          {mutationError || 'กำลังเชื่อมต่อ Convex…'}
        </div>
      )}
      {/* ===== ซ้าย: คิวรอ (เต็มความกว้างบนมือถือ, 30% บนจอใหญ่) ===== */}
      <div className="left-col w-full md:w-[30%] md:h-full flex flex-col border-b-4 md:border-b-0 md:border-r-4 border-slate-800 bg-slate-900">
        <div className="left-col-header px-5 py-4 border-b-2 border-slate-800 flex items-center gap-2 shrink-0">
          <Hourglass size={20} className="text-slate-400" />
          <h2 className="text-lg font-bold tracking-wide text-slate-200">คิวรอ</h2>
          <span className="ml-auto text-sm font-mono bg-slate-800 px-2 py-1 rounded-md text-slate-300">
            {reserved.length}
          </span>
          <button
            onClick={() => setIsNumpadHidden((hidden) => !hidden)}
            className="hide-keypad-btn flex items-center gap-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 active:bg-slate-600 px-2.5 py-2 rounded-lg border border-slate-700"
            aria-label={isNumpadHidden ? 'แสดงแป้นตัวเลข' : 'ซ่อนแป้นตัวเลข'}
          >
            {isNumpadHidden ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            {isNumpadHidden ? 'แสดงแป้น' : 'ซ่อนแป้น'}
          </button>
        </div>
        <p className="left-col-subtitle px-5 pt-3 text-[11px] text-slate-500">เรียงจากโต๊ะที่รอนานสุดไว้บนสุด</p>

        <div className="queue-list max-h-[50vh] md:max-h-none md:flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
          {reserved.length === 0 && (
            <div className="text-slate-600 text-sm text-center mt-10">
              ยังไม่มีโต๊ะรอคิว
              <br />
              เพิ่มหมายเลขโต๊ะด้านล่าง
            </div>
          )}
          {reserved.map((pot, idx) => {
            const waitSeconds = Math.floor((now - pot.reservedAt) / 1000);
            const isOverWait = waitSeconds > LONG_WAIT_WARNING;
            return (
              <div
                key={pot.id}
                className={`reserved-card relative rounded-2xl p-3 flex flex-col gap-2 bg-slate-800 border-2 ${
                  isOverWait
                    ? 'border-rose-500 pulse-red'
                    : pot.isFix
                    ? 'border-purple-500'
                    : pot.isTakeaway
                    ? 'border-[#8B5A2B]'
                    : idx === 0
                    ? 'border-emerald-500'
                    : 'border-slate-700'
                }`}
              >
                <button
                  onClick={() => removePot(pot.id)}
                  className="absolute -top-2 -right-2 bg-slate-700 hover:bg-rose-600 rounded-full p-1 border border-slate-600"
                  aria-label="ยกเลิก"
                >
                  <X size={14} />
                </button>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="table-number text-2xl font-black tracking-wide">{tableLabel(pot.table)}</span>
                    {pot.isFix && (
                      <span className="text-[10px] font-bold bg-purple-900/60 text-purple-200 px-1.5 py-0.5 rounded-md">
                        แก้
                      </span>
                    )}
                    {pot.isTakeaway && (
                      <span className="text-[10px] font-bold bg-[#8B5A2B]/60 text-amber-100 px-1.5 py-0.5 rounded-md">
                        กลับบ้าน
                      </span>
                    )}
                  </div>
                  <span className={`text-xs font-mono ${isOverWait ? 'text-rose-400 font-bold' : 'text-slate-400'}`}>
                    รอ {formatMMSS(waitSeconds)}
                  </span>
                </div>
                {idx === 0 && (
                  <span className="self-start text-[10px] font-bold tracking-wider bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-md -mt-1">
                    รอนานสุด
                  </span>
                )}
                <div className="adjust-row flex items-center justify-between bg-slate-900/60 rounded-lg px-2.5 py-1.5">
                  <span className="text-xs text-slate-300 font-semibold">เข่ง</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => adjustBaskets(pot.id, -1)}
                      disabled={pot.baskets <= MIN_BASKETS}
                      className="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-sm font-bold"
                    >
                      −
                    </button>
                    <span className="w-5 text-center text-sm font-mono font-bold">{pot.baskets}</span>
                    <button
                      onClick={() => adjustBaskets(pot.id, 1)}
                      disabled={pot.baskets >= MAX_BASKETS}
                      className="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-sm font-bold"
                    >
                      +
                    </button>
                  </div>
                </div>
                <div className="adjust-row flex items-center justify-between bg-slate-900/60 rounded-lg px-2.5 py-1.5">
                  <span className="text-xs text-slate-300 font-semibold">เวลานึ่ง</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => adjustDuration(pot.id, -DURATION_STEP)}
                      disabled={pot.duration <= MIN_DURATION}
                      className="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-sm font-bold"
                    >
                      −
                    </button>
                    <span className="w-12 text-center text-sm font-mono font-bold tabular-nums">
                      {formatMMSS(pot.duration)}
                    </span>
                    <button
                      onClick={() => adjustDuration(pot.id, DURATION_STEP)}
                      disabled={pot.duration >= MAX_DURATION}
                      className="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-sm font-bold"
                    >
                      +
                    </button>
                  </div>
                </div>
                <button
                  onClick={() => startSteaming(pot.id)}
                  className="start-btn w-full bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 rounded-lg py-2 flex items-center justify-center gap-1.5 font-bold text-sm"
                >
                  <Play size={16} /> เริ่มนึ่ง
                </button>
              </div>
            );
          })}
        </div>

        {/* Numpad */}
        {!isNumpadHidden && <div className="numpad-panel shrink-0 border-t-2 border-slate-800 p-4 bg-slate-900">
          <div className="mb-3">
            <div className="numpad-display bg-slate-800 rounded-lg px-4 py-3 text-3xl font-mono font-bold text-center border-2 border-slate-700 min-h-[56px] flex items-center justify-center">
              {numpadValue || <span className="text-slate-600 text-lg font-sans">ใส่หมายเลขโต๊ะ</span>}
            </div>
          </div>
          <label className="numpad-checkbox flex items-center gap-2 mb-2 px-1 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isFixOrder}
              onChange={(e) => setIsFixOrder(e.target.checked)}
              className="w-5 h-5 rounded accent-purple-500 cursor-pointer"
            />
            <span className="text-sm font-semibold text-purple-300">รายการแก้ (นึ่งซ้ำ)</span>
          </label>
          <label className="numpad-checkbox flex items-center gap-2 mb-3 px-1 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isTakeawayOrder}
              onChange={(e) => setIsTakeawayOrder(e.target.checked)}
              className="w-5 h-5 rounded accent-[#8B5A2B] cursor-pointer"
            />
            <span className="text-sm font-semibold text-[#C89B6E]">กลับบ้าน (ห่อกลับ)</span>
          </label>
          <div className="numpad-grid grid grid-cols-3 gap-2">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <button
                key={d}
                onClick={() => handleNumpadPress(d)}
                className="bg-slate-800 hover:bg-slate-700 active:bg-slate-600 rounded-lg py-4 text-xl font-bold border border-slate-700"
              >
                {d}
              </button>
            ))}
            <button
              onClick={handleBackspace}
              className="bg-slate-800 hover:bg-slate-700 active:bg-slate-600 rounded-lg py-4 flex items-center justify-center border border-slate-700"
              aria-label="ลบตัวเลข"
            >
              <Delete size={18} />
            </button>
            <button
              onClick={() => handleNumpadPress('0')}
              className="bg-slate-800 hover:bg-slate-700 active:bg-slate-600 rounded-lg py-4 text-xl font-bold border border-slate-700"
            >
              0
            </button>
            <button
              onClick={addTable}
              disabled={!numpadValue.trim()}
              className="bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:bg-slate-800 disabled:text-slate-600 rounded-lg py-4 flex items-center justify-center border border-emerald-500 disabled:border-slate-700"
              aria-label="เพิ่มโต๊ะเข้าคิวรอ"
            >
              <Plus size={18} />
            </button>
          </div>
          <button
            onClick={addUnspecifiedTable}
            className="unspecified-btn w-full mt-2 bg-slate-700 hover:bg-slate-600 active:bg-slate-800 border border-slate-600 rounded-lg py-2.5 text-xs font-semibold text-slate-300"
          >
            ไม่ระบุโต๊ะ (เริ่มนึ่งก่อน ใส่เลขทีหลัง)
          </button>
        </div>
        }
      </div>

      {/* ===== ขวา: เตานึ่ง (เต็มความกว้างบนมือถือ, 70% บนจอใหญ่) ===== */}
      <div className="right-col w-full md:w-[70%] md:h-full flex flex-col bg-slate-950">
        <div className="right-col-header px-4 md:px-6 py-4 border-b-2 border-slate-800 flex items-center gap-2 shrink-0 flex-wrap">
          <ChefHat size={20} className="text-slate-400" />
          <h2 className="text-lg font-bold tracking-wide text-slate-200">เตานึ่ง</h2>
          <span className="text-sm font-mono bg-slate-800 px-2 py-1 rounded-md text-slate-300">{active.length}</span>
          <button
            onClick={() => setShowHistory(true)}
            className="history-btn flex items-center gap-1 text-xs font-semibold bg-slate-800 hover:bg-slate-700 px-2.5 py-1.5 rounded-md border border-slate-700"
          >
            <History size={14} /> ประวัติวันนี้ ({history.length})
          </button>
          <button
            onClick={toggleFullscreen}
            className="fullscreen-btn flex items-center gap-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 active:bg-slate-600 px-2.5 py-1.5 rounded-md border border-slate-700"
            aria-label={isFullscreen ? 'ออกจากเต็มจอ' : 'เปิดเต็มจอ'}
          >
            {isFullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
            {isFullscreen ? 'ออกเต็มจอ' : 'เต็มจอ'}
          </button>
          <div className="legend-row ml-auto flex items-center gap-3 text-xs font-mono flex-wrap justify-end">
            <LegendDot color="bg-sky-600" label="กำลังนึ่ง" />
            <LegendDot color="bg-amber-500" label="ใกล้เสร็จ" />
            <LegendDot color="bg-purple-600" label="นึ่งแก้" />
            <LegendDot color="bg-[#8B5A2B]" label="กลับบ้าน" />
            <LegendDot color="bg-emerald-600" label="เสร็จแล้ว" />
            <LegendDot color="bg-rose-600" label="เกินเวลา" />
          </div>
        </div>
        <p className="right-col-subtitle px-4 md:px-6 pt-3 text-[11px] text-slate-500">เรียงจากเตาที่เหลือเวลาน้อยที่สุดไว้บนสุด ไล่ลงมา</p>

        <div className="steam-grid-wrap md:flex-1 md:overflow-y-auto p-4 md:p-6 pt-3">
          <div className="steam-grid grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
            {active.length === 0 && (
              <div className="text-slate-600 text-sm text-center mt-10 col-span-3">
                ยังไม่มีเตาไหนกำลังนึ่ง
                <br />
                กด &quot;เริ่มนึ่ง&quot; จากคิวรอด้านซ้ายเพื่อเริ่ม
              </div>
            )}
            {active.map(({ pot, elapsed, remaining }) => {
              const status = getPotStatus(elapsed, pot.duration);
              const isPurple = pot.isFix && (status === 'blue' || status === 'yellow'); // นึ่งแก้ที่ยังไม่เสร็จ/ไม่เกินเวลา -> ม่วง
              const isBrown = !isPurple && pot.isTakeaway && (status === 'blue' || status === 'yellow'); // กลับบ้านที่ยังไม่เสร็จ/ไม่เกินเวลา -> น้ำตาล
              const style = isPurple ? STATUS_STYLE.purple : isBrown ? STATUS_STYLE.brown : STATUS_STYLE[status];
              const label = isPurple ? STATUS_LABEL.purple : isBrown ? STATUS_LABEL.brown : STATUS_LABEL[status];
              const pastZero = elapsed > pot.duration;
              const timeText = pastZero
                ? formatMMSS(-(elapsed - pot.duration))
                : formatMMSS(Math.max(remaining, 0));
              const clickable = status === 'green' || status === 'red';
              return (
                <div
                  key={pot.id}
                  onClick={() => clearPot(pot.id, status)}
                  className={`steam-tile relative ${style.bg} ${style.border} ${style.text} border-2 rounded-2xl min-h-[132px] transition-colors ${
                    status === 'red' ? 'pulse-red' : ''
                  } ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openEditTable(pot.id);
                    }}
                    className="absolute bottom-3 left-3 bg-slate-700 hover:bg-sky-600 active:bg-sky-700 rounded-full w-10 h-10 flex items-center justify-center border border-slate-600 z-10"
                    aria-label="แก้ไขหมายเลขโต๊ะ"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removePot(pot.id);
                    }}
                    className="absolute -top-2 -right-2 bg-slate-700 hover:bg-rose-600 rounded-full p-1 border border-slate-600 z-10"
                    aria-label="ยกเลิก"
                  >
                    <X size={14} />
                  </button>
                  <div className="steam-card-content absolute inset-0 flex flex-col items-center justify-center gap-1 px-5 md:px-6 text-center">
                    <div className="flex items-center gap-1.5 flex-wrap justify-center">
                      <span className="table-number text-2xl font-black tracking-wide">{tableLabel(pot.table)}</span>
                      <span className="basket-count text-sm font-bold bg-black/20 px-2 py-1 rounded-md">{pot.baskets} เข่ง</span>
                      {pot.isFix && (
                        <span className="text-[10px] font-bold bg-black/20 px-1.5 py-0.5 rounded-md">แก้</span>
                      )}
                      {pot.isTakeaway && (
                        <span className="text-[10px] font-bold bg-black/20 px-1.5 py-0.5 rounded-md">กลับบ้าน</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {pot.wasMoved && <Repeat size={14} className="opacity-90" />}
                      <span className="timer-text text-3xl font-mono font-bold tabular-nums">{timeText}</span>
                    </div>
                    <span className={`status-text text-[10px] font-bold tracking-widest opacity-90 ${status === 'red' ? 'status-text-overdue' : ''}`}>{label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {editingPotId && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={closeEditTable}
        >
          <div
            className="bg-slate-900 border-2 border-slate-700 rounded-2xl p-4 w-full max-w-xs max-h-[92vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-semibold text-slate-300 mb-3 text-center">แก้ไขหมายเลขโต๊ะ (เวลานึ่งไม่เปลี่ยน)</p>
            <div className="bg-slate-800 rounded-lg px-4 py-3 text-3xl font-mono font-bold text-center border-2 border-slate-700 min-h-[56px] flex items-center justify-center mb-3">
              {editValue || <span className="text-slate-600 text-lg font-sans">ใส่หมายเลขโต๊ะ</span>}
            </div>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                <button
                  key={d}
                  onClick={() => handleEditNumpadPress(d)}
                  className="bg-slate-800 hover:bg-slate-700 active:bg-slate-600 rounded-lg py-3 text-lg font-bold border border-slate-700"
                >
                  {d}
                </button>
              ))}
              <button
                onClick={handleEditBackspace}
                className="bg-slate-800 hover:bg-slate-700 active:bg-slate-600 rounded-lg py-3 flex items-center justify-center border border-slate-700"
                aria-label="ลบตัวเลข"
              >
                <Delete size={16} />
              </button>
              <button
                onClick={() => handleEditNumpadPress('0')}
                className="bg-slate-800 hover:bg-slate-700 active:bg-slate-600 rounded-lg py-3 text-lg font-bold border border-slate-700"
              >
                0
              </button>
              <button
                onClick={closeEditTable}
                className="bg-slate-800 hover:bg-slate-700 active:bg-slate-600 rounded-lg py-3 flex items-center justify-center border border-slate-700"
                aria-label="ยกเลิกการแก้ไข"
              >
                <X size={16} />
              </button>
            </div>
            <button
              onClick={confirmEditTable}
              disabled={!editValue.trim()}
              className="w-full bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:bg-slate-800 disabled:text-slate-600 rounded-lg py-3 font-bold text-sm"
            >
              บันทึกหมายเลขโต๊ะ
            </button>
          </div>
        </div>
      )}

      {pendingPot && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setCloseRequest(null)}>
          <div className="bg-slate-900 border-2 border-slate-700 rounded-2xl p-5 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-bold text-center text-slate-100">
              {closeRequest.type === 'cancel' ? 'ยืนยันการยกเลิก?' : 'ยืนยันการปิดรายการ?'}
            </h3>
            <p className="mt-2 text-center text-slate-300 font-semibold">{tableLabel(pendingPot.table)}</p>
            <p className="mt-1 text-center text-sm text-slate-400">
              {closeRequest.type === 'cancel'
                ? 'รายการนี้จะถูกลบออกจากคิวหรือเตานึ่ง'
                : closeRequest.status === 'red'
                ? 'บันทึกเป็นรายการเกินเวลา แล้วนำออกจากเตานึ่ง'
                : 'บันทึกเป็นรายการเสิร์ฟแล้ว แล้วนำออกจากเตานึ่ง'}
            </p>
            <div className="grid grid-cols-2 gap-3 mt-5">
              <button onClick={() => setCloseRequest(null)} className="min-h-12 rounded-xl bg-slate-700 hover:bg-slate-600 font-bold">
                กลับไป
              </button>
              <button onClick={confirmClose} className="min-h-12 rounded-xl bg-rose-600 hover:bg-rose-500 active:bg-rose-700 font-bold">
                {closeRequest.type === 'cancel' ? 'ยืนยันยกเลิก' : 'ยืนยันปิด'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showHistory && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={() => setShowHistory(false)}
        >
          <div
            className="bg-slate-900 border-2 border-slate-700 rounded-2xl p-4 w-full max-w-md max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3 shrink-0">
              <p className="text-sm font-semibold text-slate-300">ประวัติวันนี้ ({history.length} โต๊ะ)</p>
              <button
                onClick={() => setShowHistory(false)}
                className="bg-slate-800 hover:bg-slate-700 rounded-full p-1.5 border border-slate-700"
                aria-label="ปิด"
              >
                <X size={16} />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 flex flex-col gap-2">
              {history.length === 0 && (
                <p className="text-slate-600 text-sm text-center mt-6">ยังไม่มีรายการที่เสิร์ฟวันนี้</p>
              )}
              {[...history].reverse().map((h) => (
                <div
                  key={`${h.id}-${h.servedAt}`}
                  className={`rounded-xl p-2.5 border-2 ${
                    h.autoClose ? 'border-rose-700 bg-rose-950/40' : 'border-slate-700 bg-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold">{tableLabel(h.table)}</span>
                    <span className="text-xs font-mono text-slate-400">
                      {new Date(h.servedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap mt-1 text-[10px] font-bold">
                    <span className="bg-black/30 px-1.5 py-0.5 rounded-md">{h.baskets} เข่ง</span>
                    <span className="bg-black/30 px-1.5 py-0.5 rounded-md">นึ่ง {formatMMSS(h.cookSeconds)}</span>
                    {h.isFix && (
                      <span className="bg-purple-900/60 text-purple-200 px-1.5 py-0.5 rounded-md">แก้</span>
                    )}
                    {h.isTakeaway && (
                      <span className="bg-[#8B5A2B]/60 text-amber-100 px-1.5 py-0.5 rounded-md">กลับบ้าน</span>
                    )}
                    {h.wasMoved && (
                      <span className="bg-sky-900/60 text-sky-200 px-1.5 py-0.5 rounded-md">ย้ายโต๊ะ</span>
                    )}
                    {h.autoClose ? (
                      <span className="bg-rose-900/60 text-rose-200 px-1.5 py-0.5 rounded-md">
                        ไม่มีคนเคลียร์ (ปิดอัตโนมัติ)
                      </span>
                    ) : (
                      h.wasOverdue && (
                        <span className="bg-rose-900/40 text-rose-300 px-1.5 py-0.5 rounded-md">เกินเวลา</span>
                      )
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulseRed {
          0%,
          100% {
            box-shadow: 0 0 0 0 rgba(244, 63, 94, 0.55);
          }
          50% {
            box-shadow: 0 0 0 8px rgba(244, 63, 94, 0);
          }
        }
        .pulse-red {
          animation: pulseRed 1.4s ease-in-out infinite;
        }
        .steam-card-content {
          min-width: 0;
        }
        .steam-tile .table-number {
          line-height: 1.1;
        }
        .steam-tile .status-text {
          max-width: 100%;
          overflow-wrap: anywhere;
        }
        /* Safari แบบไม่เต็มจอของ iPad มีพื้นที่แนวตั้งน้อยและแสดงเตา 3 คอลัมน์ */
        @media (min-width: 768px) and (orientation: landscape) and (min-aspect-ratio: 3 / 2) {
          .steam-grid-wrap {
            padding: 10px 14px !important;
          }
          .steam-grid {
            gap: 10px !important;
          }
          .steam-tile {
            min-height: 150px !important;
          }
          .steam-card-content {
            padding: 0 20px !important;
          }
          .steam-tile .table-number {
            font-size: 1.45rem !important;
          }
          .steam-tile .basket-count {
            font-size: 0.875rem !important;
            padding: 3px 7px !important;
          }
          .steam-tile .timer-text {
            font-size: 2.15rem !important;
          }
          .steam-tile .status-text {
            font-size: 0.75rem !important;
            line-height: 1.1 !important;
            letter-spacing: 0.02em !important;
          }
          .steam-tile .status-text-overdue {
            font-size: 0.65rem !important;
          }
        }
        /* iPad 4:3 แนวนอน (iPad รุ่นที่ 6 = 1024×768 CSS px)
           ให้พื้นที่ฝั่งรับคิวมากพอสำหรับกดจริง และลดแป้นเป็น 3 แถว */
        @media (min-width: 768px) and (min-height: 600px) and (orientation: landscape) and (max-aspect-ratio: 3 / 2) {
          .app-root {
            height: 100svh !important;
            min-height: 0 !important;
            overflow: hidden !important;
          }
          .left-col {
            width: 40% !important;
          }
          .right-col {
            width: 60% !important;
          }
          .left-col-header,
          .right-col-header {
            padding: 12px 16px !important;
          }
          .left-col-subtitle,
          .right-col-subtitle {
            display: none !important;
          }
          .queue-list {
            padding: 10px 14px !important;
            gap: 10px !important;
          }
          .reserved-card {
            padding: 12px !important;
            gap: 8px !important;
          }
          .reserved-card .adjust-row {
            padding: 6px 10px !important;
          }
          .reserved-card .adjust-row button {
            width: 44px !important;
            height: 44px !important;
            font-size: 1.35rem !important;
          }
          .reserved-card .start-btn {
            min-height: 48px !important;
            padding: 0 !important;
            font-size: 1rem !important;
          }
          .numpad-panel {
            padding: 10px 14px !important;
          }
          .numpad-display {
            min-height: 52px !important;
            padding: 8px !important;
            font-size: 1.5rem !important;
          }
          .numpad-checkbox {
            display: inline-flex !important;
            min-height: 40px !important;
            margin: 0 12px 8px 0 !important;
            padding: 0 4px !important;
            font-size: 0.78rem !important;
          }
          .numpad-checkbox input {
            width: 20px !important;
            height: 20px !important;
          }
          .hide-keypad-btn {
            min-height: 40px !important;
            padding: 0 10px !important;
          }
          .fullscreen-btn {
            min-height: 40px !important;
            padding: 0 10px !important;
          }
          .numpad-grid {
            grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
            gap: 8px !important;
          }
          .numpad-grid button {
            min-height: 50px !important;
            padding: 0 !important;
            font-size: 1.15rem !important;
          }
          /* 1 2 3 ลบ / 4 5 6 0 / 7 8 9 เพิ่ม — ใช้เพียงบน iPad 4:3 */
          .numpad-grid button:nth-child(4) { order: 5; }
          .numpad-grid button:nth-child(5) { order: 6; }
          .numpad-grid button:nth-child(6) { order: 7; }
          .numpad-grid button:nth-child(7) { order: 9; }
          .numpad-grid button:nth-child(8) { order: 10; }
          .numpad-grid button:nth-child(9) { order: 11; }
          .numpad-grid button:nth-child(10) { order: 4; }
          .numpad-grid button:nth-child(11) { order: 8; }
          .numpad-grid button:nth-child(12) { order: 12; }
          .unspecified-btn {
            min-height: 40px !important;
            margin-top: 8px !important;
            padding: 0 !important;
            font-size: 0.72rem !important;
          }
          .legend-row {
            width: 100% !important;
            margin-left: 0 !important;
            justify-content: flex-start !important;
            gap: 10px !important;
          }
          .steam-grid-wrap {
            padding: 10px 14px !important;
          }
          .steam-grid {
            grid-template-columns: minmax(0, 1fr) !important;
            gap: 10px !important;
          }
          .steam-tile {
            min-height: 140px !important;
            border-radius: 20px !important;
          }
          .steam-tile .table-number {
            font-size: 1.7rem !important;
          }
          .steam-tile .timer-text {
            font-size: 2.25rem !important;
          }
          .steam-tile .status-text {
            font-size: 1.25rem !important;
            line-height: 1.1 !important;
            letter-spacing: 0.04em !important;
          }
          .steam-tile .status-text-overdue {
            font-size: 0.625rem !important;
          }
          .steam-tile .basket-count {
            font-size: 1rem !important;
            padding: 4px 8px !important;
          }
        }
        /* มือถือถือแนวนอน (จอเตี้ย) — บังคับ layout ซ้าย-ขวาให้ fit พอดีจอ ไม่ต้องเลื่อนทั้งหน้า */
        @media (orientation: landscape) and (max-height: 500px) {
          .app-root {
            flex-direction: row !important;
            height: 100vh !important;
            min-height: 0 !important;
            overflow: hidden !important;
          }
          .left-col {
            width: 36% !important;
            height: 100% !important;
            overflow: hidden !important;
            border-bottom-width: 0 !important;
            border-right-width: 3px !important;
          }
          .left-col-header {
            padding: 8px 12px !important;
          }
          .left-col-header h2 {
            font-size: 0.9rem !important;
          }
          .left-col-subtitle,
          .right-col-subtitle {
            display: none !important;
          }
          .queue-list {
            flex: 1 1 auto !important;
            max-height: none !important;
            min-height: 0 !important;
            overflow-y: auto !important;
            padding: 6px 10px !important;
            gap: 6px !important;
          }
          .reserved-card {
            padding: 8px !important;
            gap: 5px !important;
            border-radius: 12px !important;
          }
          .reserved-card .table-number {
            font-size: 1.05rem !important;
          }
          .reserved-card .adjust-row {
            padding: 3px 8px !important;
          }
          .reserved-card .start-btn {
            padding: 5px !important;
            font-size: 0.72rem !important;
          }
          .numpad-panel {
            padding: 6px 10px !important;
          }
          .numpad-display {
            padding: 5px !important;
            font-size: 1.1rem !important;
            min-height: 30px !important;
            margin-bottom: 5px !important;
          }
          .numpad-checkbox {
            margin-bottom: 4px !important;
          }
          .numpad-grid {
            gap: 5px !important;
          }
          .numpad-grid button {
            padding: 7px 0 !important;
            font-size: 0.9rem !important;
          }
          .unspecified-btn {
            padding: 6px 0 !important;
            font-size: 0.62rem !important;
            margin-top: 4px !important;
          }
          .right-col {
            width: 64% !important;
            height: 100% !important;
          }
          .right-col-header {
            padding: 8px 12px !important;
          }
          .right-col-header h2 {
            font-size: 0.9rem !important;
          }
          .legend-row {
            gap: 6px !important;
            font-size: 0.62rem !important;
          }
          .history-btn {
            padding: 4px 8px !important;
            font-size: 0.6rem !important;
          }
          .steam-grid-wrap {
            padding: 8px !important;
            flex: 1 1 auto !important;
            min-height: 0 !important;
            overflow-y: auto !important;
          }
          .steam-grid {
            gap: 6px !important;
          }
          .steam-tile {
            min-height: 76px !important;
            gap: 2px !important;
            border-radius: 12px !important;
          }
          .steam-tile .table-number {
            font-size: 1rem !important;
          }
          .steam-tile .timer-text {
            font-size: 1.2rem !important;
          }
        }
      `}</style>
    </div>
  );
}

function LegendDot({ color, label }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`w-2.5 h-2.5 rounded-full ${color}`} />
      {label}
    </span>
  );
}
