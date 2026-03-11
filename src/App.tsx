import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabaseClient";

const DEFAULT_PLACES = ["Caja Seguridad", "Efectivo", "Deel"] as const;

/** Cantidad fija de transacciones mostradas en el dashboard */
const DASHBOARD_TX_LIMIT = 8;
const SALARY_PAGE_SIZE = 10;

/** Horas por mes de referencia para 2026 */
const MONTHLY_HOURS_2026: Record<number, number> = {
  1: 176, 2: 160, 3: 176, 4: 176, 5: 168, 6: 176,
  7: 184, 8: 168, 9: 176, 10: 176, 11: 168, 12: 184,
};

const MONTH_NAMES_ES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

/** Horas por mes: 2026 definido; otros años reutilizan 2026 por defecto */
function getHoursForMonth(year: number, month: number): number {
  const hoursMap: Record<number, number> = year === 2026 ? MONTHLY_HOURS_2026 : { ...MONTHLY_HOURS_2026 };
  return hoursMap[month] ?? 176;
}

/** Último día hábil del mes (sin fines de semana) */
function getLastBusinessDay(year: number, month: number): Date {
  const last = new Date(year, month, 0);
  const dow = last.getDay();
  if (dow === 0) last.setDate(last.getDate() - 2);
  else if (dow === 6) last.setDate(last.getDate() - 1);
  return last;
}

function getNextSalaryPayDate(hourlyRate: number): { date: Date; amount: number; month: number; year: number } | null {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth() + 1;
  const payThisMonth = getLastBusinessDay(y, m);
  if (today <= payThisMonth) {
    const hours = getHoursForMonth(y, m);
    return { date: payThisMonth, amount: hours * hourlyRate, month: m, year: y };
  }
  let nextM = m + 1;
  let nextY = y;
  if (nextM > 12) {
    nextM = 1;
    nextY += 1;
  }
  const payNext = getLastBusinessDay(nextY, nextM);
  const hours = getHoursForMonth(nextY, nextM);
  return { date: payNext, amount: hours * hourlyRate, month: nextM, year: nextY };
}

function formatNextSalaryDate(d: Date): string {
  const day = d.getDate();
  const month = MONTH_NAMES_ES[d.getMonth()].slice(0, 3);
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}

function daysUntil(d: Date): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  return Math.max(0, Math.ceil((target.getTime() - today.getTime()) / 86400000));
}

type ViewId = "dashboard" | "upcoming" | "goals";

const HOURLY_RATE_STORAGE_KEY = "control-gastos-hourly-rate";
const DEFAULT_HOURLY_RATE = 33.5;

interface SalaryEntry {
  id: string;
  year: number;
  month: number;
  hours: number;
  hourlyRate: number;
}

function mapRowToSalaryEntry(row: { id: string; year: number; month: number; hours: number; hourly_rate: number }): SalaryEntry {
  return {
    id: String(row.id),
    year: Number(row.year),
    month: Number(row.month),
    hours: Number(row.hours),
    hourlyRate: Number(row.hourly_rate),
  };
}

/** Próximos N salarios desde la lista dinámica (fecha de cobro >= hoy) */
function getUpcomingFromEntries(entries: SalaryEntry[], count: number): Array<{ date: Date; amount: number; month: number; year: number; id: string }> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const withDate = entries.map((e) => ({
    ...e,
    date: getLastBusinessDay(e.year, e.month),
    amount: e.hours * e.hourlyRate,
  }));
  const future = withDate.filter(({ date }) => date >= today);
  future.sort((a, b) => a.date.getTime() - b.date.getTime());
  return future.slice(0, count).map(({ date, amount, month, year, id }) => ({ date, amount, month, year, id }));
}

interface Entry {
  id: number;
  date: string;
  place: string;
  amount: number;
  comment: string;
}

type TxType = "income" | "expense" | "transfer";

interface FormState {
  date: string;
  place: string;
  amount: string;
  comment: string;
}

type SavingsGoalStatus = "in_progress" | "at_risk" | "completed";

interface SavingsGoal {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  deadline: string | null;
  category: string;
  status: SavingsGoalStatus;
  createdAt: string;
}

interface SavingsContribution {
  id: string;
  goalId: string;
  amount: number;
  source: "manual" | "retention";
  createdAt: string;
  movementId?: number | null;
}

const formatCurrency = (value: number) =>
  value.toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 2,
  });

const formatDisplayDate = (iso: string) => {
  if (!iso) return "";
  const [year, month, day] = iso.split("-");
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return date.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  });
};

const todayIso = () => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

function AccountIcon({ place }: { place: string }) {
  if (place === "Caja Seguridad") {
    return (
      <span className="account-icon account-icon-caja" aria-hidden title="Caja Seguridad">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3"/></svg>
      </span>
    );
  }
  if (place === "Efectivo") {
    return (
      <span className="account-icon account-icon-efectivo" aria-hidden title="Efectivo">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/><circle cx="6" cy="12" r="2"/><circle cx="18" cy="12" r="2"/></svg>
      </span>
    );
  }
  if (place === "Deel") {
    return (
      <span className="account-icon account-icon-deel deel-logo" aria-hidden title="Deel">
        d.
      </span>
    );
  }
  return (
    <span className="account-icon account-icon-default" aria-hidden>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/></svg>
    </span>
  );
}

function getStoredHourlyRate(): number {
  try {
    const s = localStorage.getItem(HOURLY_RATE_STORAGE_KEY);
    if (s != null) {
      const n = Number(s.replace(",", "."));
      if (!Number.isNaN(n) && n > 0) return n;
    }
  } catch {
    // ignore
  }
  return DEFAULT_HOURLY_RATE;
}

export function App() {
  const [activeView, setActiveView] = useState<ViewId>("dashboard");
  const [hourlyRate, setHourlyRate] = useState(getStoredHourlyRate);
  const [salaryEntries, setSalaryEntries] = useState<SalaryEntry[]>([]);
  const [editingSalaryId, setEditingSalaryId] = useState<string | null>(null);
  const [showSalaryForm, setShowSalaryForm] = useState(false);
  const [salaryForm, setSalaryForm] = useState({ year: new Date().getFullYear(), month: 1, hours: 176, hourlyRate: DEFAULT_HOURLY_RATE });
  const [salaryPage, setSalaryPage] = useState(1);
  const [salaryError, setSalaryError] = useState<string | null>(null);
  const totalsSliderRef = useRef<HTMLDivElement>(null);
  const totalsDragRef = useRef({ startX: 0, startScrollLeft: 0 });
  const [places, setPlaces] = useState<string[]>([...DEFAULT_PLACES]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [form, setForm] = useState<FormState>({
    date: todayIso(),
    place: DEFAULT_PLACES[0],
    amount: "",
    comment: "",
  });
  const [amountError, setAmountError] = useState<string | null>(null);
  const [ahorrosMamaPapa, setAhorrosMamaPapa] = useState(23000);
  const [confirmDelete, setConfirmDelete] = useState<Entry | null>(null);
  const [confirmDeleteSalary, setConfirmDeleteSalary] = useState<SalaryEntry | null>(null);

  const [showNewTxModal, setShowNewTxModal] = useState(false);
  const [showAllTxModal, setShowAllTxModal] = useState(false);
  const [txType, setTxType] = useState<TxType>("expense");
  const [txAmount, setTxAmount] = useState("");
  const [txSource, setTxSource] = useState(DEFAULT_PLACES[0]);
  const [txDestination, setTxDestination] = useState(DEFAULT_PLACES[0]);
  const [txDate, setTxDate] = useState(todayIso());
  const [txDescription, setTxDescription] = useState("");
  const [txAmountError, setTxAmountError] = useState<string | null>(null);

  const [savingsGoals, setSavingsGoals] = useState<SavingsGoal[]>([]);
  const [attachToGoal, setAttachToGoal] = useState(false);
  const [selectedGoalIdForRetention, setSelectedGoalIdForRetention] = useState<string | null>(null);
  const [savingsContributions, setSavingsContributions] = useState<SavingsContribution[]>([]);
  const [goalForm, setGoalForm] = useState({ name: "", targetAmount: "", deadline: "", category: "" });
  const [goalFormError, setGoalFormError] = useState<string | null>(null);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [selectedGoalForContribution, setSelectedGoalForContribution] = useState<SavingsGoal | null>(null);
  const [contributionAmount, setContributionAmount] = useState("");
  const [contributionError, setContributionError] = useState<string | null>(null);
  const [showGoalModal, setShowGoalModal] = useState(false);
  const goalsSliderRef = useRef<HTMLDivElement | null>(null);
  const goalsDragRef = useRef({ startX: 0, startScrollLeft: 0 });
  const achievementsSliderRef = useRef<HTMLDivElement | null>(null);
  const achievementsDragRef = useRef({ startX: 0, startScrollLeft: 0 });
  const upcomingDashboardSliderRef = useRef<HTMLDivElement | null>(null);
  const upcomingDashboardDragRef = useRef({ startX: 0, startScrollLeft: 0 });

  // Cargar datos iniciales desde Supabase
  useEffect(() => {
    const load = async () => {
      try {
        const [
          { data: movements },
          { data: placesData },
          { data: settingsData },
          { data: salaryRows },
          { data: goalsRows },
          { data: contributionsRows },
        ] = await Promise.all([
          supabase
            .from("movements")
            .select("id, date, place, amount, comment")
            .order("date", { ascending: false })
            .order("id", { ascending: false }),
          supabase.from("places").select("name").order("name", { ascending: true }),
          supabase.from("settings").select("id, ahorros_mama_papa").eq("id", 1).maybeSingle(),
          supabase
            .from("salary_entries")
            .select("id, year, month, hours, hourly_rate")
            .order("year", { ascending: true })
            .order("month", { ascending: true }),
          supabase
            .from("savings_goals")
            .select("id, name, target_amount, current_amount, deadline, category, status, created_at")
            .order("created_at", { ascending: true }),
          supabase
            .from("savings_goal_contributions")
            .select("id, goal_id, amount, source, created_at, movement_id")
            .order("created_at", { ascending: true }),
        ]);

        if (movements) {
          setEntries(
            movements.map((m) => ({
              id: m.id as number,
              date: m.date as string,
              place: m.place as string,
              amount: Number(m.amount),
              comment: (m.comment as string | null) ?? "",
            })),
          );
        }

        if (placesData && Array.isArray(placesData)) {
          const fromDb = placesData.map((p: { name: string }) => p.name);
          const merged = Array.from(new Set([...DEFAULT_PLACES, ...fromDb]));
          setPlaces(merged);
        }

        if (settingsData && typeof settingsData.ahorros_mama_papa !== "undefined") {
          const val = Number(settingsData.ahorros_mama_papa);
          if (!Number.isNaN(val) && val >= 0) {
            setAhorrosMamaPapa(val);
          }
        }

        if (salaryRows && Array.isArray(salaryRows)) {
          setSalaryEntries(
            salaryRows.map((r: { id: string; year: number; month: number; hours: number; hourly_rate: number }) =>
              mapRowToSalaryEntry(r)
            )
          );
        }

        if (goalsRows && Array.isArray(goalsRows)) {
          setSavingsGoals(
            goalsRows.map((g: { id: string; name: string; target_amount: number; current_amount: number; deadline: string | null; category: string; status: string; created_at: string }) => ({
              id: String(g.id),
              name: g.name,
              targetAmount: Number(g.target_amount),
              currentAmount: Number(g.current_amount),
              deadline: g.deadline,
              category: g.category,
              status: (g.status as SavingsGoalStatus) ?? "in_progress",
              createdAt: g.created_at,
            })),
          );
        }

        if (contributionsRows && Array.isArray(contributionsRows)) {
          setSavingsContributions(
            contributionsRows.map((c: { id: string; goal_id: string; amount: number; source: string; created_at: string; movement_id?: number | null }) => ({
              id: String(c.id),
              goalId: String(c.goal_id),
              amount: Number(c.amount),
              source: c.source === "retention" ? "retention" : "manual",
              createdAt: c.created_at,
              movementId: typeof c.movement_id === "number" ? c.movement_id : c.movement_id ?? null,
            })),
          );
        }
      } catch {
        // si falla, la app sigue vacía
      }
    };

    void load();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(HOURLY_RATE_STORAGE_KEY, String(hourlyRate));
    } catch {
      // ignore
    }
  }, [hourlyRate]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(salaryEntries.length / SALARY_PAGE_SIZE));
    setSalaryPage((p) => (p > totalPages ? totalPages : p));
  }, [salaryEntries.length]);

  /** Al entrar a Próximos salarios o al cambiar datos, ubicar la página en el mes actual */
  useEffect(() => {
    if (activeView !== "upcoming" || salaryEntries.length === 0) return;
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const sorted = [...salaryEntries].sort((a, b) => (a.year !== b.year ? a.year - b.year : a.month - b.month));
    const index = sorted.findIndex((e) => e.year === currentYear && e.month === currentMonth);
    if (index >= 0) {
      const pageForCurrentMonth = Math.floor(index / SALARY_PAGE_SIZE) + 1;
      setSalaryPage(pageForCurrentMonth);
    }
  }, [activeView, salaryEntries]);

  const addSalaryEntry = async () => {
    setSalaryError(null);
    const { year, month, hours, hourlyRate: rate } = salaryForm;
    if (hours <= 0 || rate < 0) return;
    const exists = salaryEntries.some((e) => e.year === year && e.month === month);
    if (exists) return;
    const payload = {
      year: Number(year),
      month: Number(month),
      hours: Number(hours),
      hourly_rate: Number(rate),
    };
    const { data, error } = await supabase
      .from("salary_entries")
      .insert(payload)
      .select("id, year, month, hours, hourly_rate")
      .single();
    if (error) {
      setSalaryError(error.message || "No se pudo guardar el salario.");
      return;
    }
    const newEntry = data ? mapRowToSalaryEntry(data as { id: string; year: number; month: number; hours: number; hourly_rate: number }) : null;
    if (newEntry) {
      setSalaryEntries((prev) => [...prev, newEntry]);
      setSalaryForm((f) => ({ ...f, hours: 176 }));
      setSalaryError(null);
      setShowSalaryForm(false);
    } else {
      setSalaryError("No se recibió el registro guardado.");
    }
  };

  const updateSalaryEntry = async () => {
    if (!editingSalaryId) return;
    const { year, month, hours, hourlyRate: rate } = salaryForm;
    if (hours <= 0 || rate < 0) return;
    const duplicate = salaryEntries.some((e) => e.id !== editingSalaryId && e.year === year && e.month === month);
    if (duplicate) return;
    const { error } = await supabase
      .from("salary_entries")
      .update({ year, month, hours, hourly_rate: rate })
      .eq("id", editingSalaryId);
    if (error) return;
    setSalaryEntries((prev) =>
      prev.map((e) => (e.id === editingSalaryId ? { ...e, year, month, hours, hourlyRate: rate } : e))
    );
    setEditingSalaryId(null);
    setShowSalaryForm(false);
    setSalaryForm({ year: new Date().getFullYear(), month: 1, hours: 176, hourlyRate: hourlyRate });
  };

  const deleteSalaryEntry = async (id: string) => {
    const { error } = await supabase.from("salary_entries").delete().eq("id", id);
    if (error) return;
    setSalaryEntries((prev) => prev.filter((e) => e.id !== id));
    if (editingSalaryId === id) setEditingSalaryId(null);
  };

  const startEditSalary = (entry: SalaryEntry) => {
    setEditingSalaryId(entry.id);
    setSalaryForm({ year: entry.year, month: entry.month, hours: entry.hours, hourlyRate: entry.hourlyRate });
    setShowSalaryForm(true);
  };

  const cancelEditSalary = () => {
    setEditingSalaryId(null);
    setShowSalaryForm(false);
    setSalaryError(null);
    setSalaryForm({ year: new Date().getFullYear(), month: 1, hours: 176, hourlyRate: hourlyRate });
  };

  const handleTotalsSliderMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = totalsSliderRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    e.preventDefault();
    el.classList.add("salary-totals-slider--grabbing");
    totalsDragRef.current = { startX: e.clientX, startScrollLeft: el.scrollLeft };
    const onMove = (moveEvent: MouseEvent) => {
      el.scrollLeft = totalsDragRef.current.startScrollLeft + (totalsDragRef.current.startX - moveEvent.clientX);
    };
    const onUp = () => {
      el.classList.remove("salary-totals-slider--grabbing");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const makeHorizontalDragHandler =
    (ref: React.RefObject<HTMLDivElement>, dragRef: React.MutableRefObject<{ startX: number; startScrollLeft: number }>) =>
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = ref.current;
      if (!el || el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.classList.add("goals-slider--grabbing", "upcoming-cards-slider--grabbing");
      dragRef.current = { startX: e.clientX, startScrollLeft: el.scrollLeft };
      const state = { latestX: e.clientX, rafId: 0, targetScrollLeft: el.scrollLeft };
      const onMove = (moveEvent: MouseEvent) => {
        state.latestX = moveEvent.clientX;
        state.targetScrollLeft = dragRef.current.startScrollLeft + (dragRef.current.startX - state.latestX);
        if (state.rafId === 0) {
          state.rafId = requestAnimationFrame(() => {
            const current = el.scrollLeft;
            const next = current + (state.targetScrollLeft - current) * 0.35;
            el.scrollLeft = next;
            state.rafId = 0;
          });
        }
      };
      const onUp = () => {
        if (state.rafId) cancelAnimationFrame(state.rafId);
        el.classList.remove("goals-slider--grabbing", "upcoming-cards-slider--grabbing");
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };

  const totalsByPlace = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const p of places) totals[p] = 0;
    for (const entry of entries) {
      if (!(entry.place in totals)) totals[entry.place] = 0;
      totals[entry.place] += entry.amount;
    }
    return totals;
  }, [entries, places]);

  const grandTotal = useMemo(
    () => entries.reduce((sum, e) => sum + e.amount, 0),
    [entries],
  );

  /** Variación del total vs mes anterior (para Mis cuentas) */
  const totalVsLastMonth = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;
    const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const currPrefix = `${currentYear}-${String(currentMonth).padStart(2, "0")}`;
    const prevPrefix = `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
    let currSum = 0;
    let prevSum = 0;
    for (const e of entries) {
      if (e.date.startsWith(currPrefix)) currSum += e.amount;
      else if (e.date.startsWith(prevPrefix)) prevSum += e.amount;
    }
    if (prevSum === 0) return currSum > 0 ? { pct: 100, positive: true } : { pct: 0, positive: true };
    const pct = ((currSum - prevSum) / Math.abs(prevSum)) * 100;
    return { pct, positive: pct >= 0 };
  }, [entries]);

  const adeudado = ahorrosMamaPapa - grandTotal;

  const nextSalary = useMemo(() => getNextSalaryPayDate(hourlyRate), [hourlyRate]);
  /** En el Dashboard mostramos más salarios para poder hacer scroll horizontal (Junio, Julio, etc.) */
  const upcomingSalaries = useMemo(() => getUpcomingFromEntries(salaryEntries, 12), [salaryEntries]);

  /** Totalizadores por año (ingresos a la fecha vs proyectados resto del año) */
  const salaryTotalsByYear = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const byYear: Record<number, { ingresosALaFecha: number; ingresosProyectados: number }> = {};
    for (const e of salaryEntries) {
      if (!byYear[e.year]) byYear[e.year] = { ingresosALaFecha: 0, ingresosProyectados: 0 };
      const payDate = getLastBusinessDay(e.year, e.month);
      payDate.setHours(0, 0, 0, 0);
      const amount = e.hours * e.hourlyRate;
      if (payDate <= today) byYear[e.year].ingresosALaFecha += amount;
      else byYear[e.year].ingresosProyectados += amount;
    }
    return byYear;
  }, [salaryEntries]);

  const handleChange =
    (field: keyof FormState) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const value = event.target.value;
      setForm((prev) => ({ ...prev, [field]: value }));
      if (field === "amount") {
        setAmountError(null);
      }
    };

  const resetForm = () => {
    setForm((prev) => ({
      date: todayIso(),
      place: places.includes(prev.place) ? prev.place : places[0] ?? "",
      amount: "",
      comment: "",
    }));
    setAmountError(null);
  };

  const openNewTxModal = () => {
    const first = places[0] ?? DEFAULT_PLACES[0];
    const second = places.find((p) => p !== first) ?? first;
    setTxType("expense");
    setTxAmount("");
    setTxSource(first);
    setTxDestination(second);
    setTxDate(todayIso());
    setTxDescription("");
    setTxAmountError(null);
    setAttachToGoal(false);
    setSelectedGoalIdForRetention(null);
    setShowNewTxModal(true);
  };

  const closeNewTxModal = () => {
    setShowNewTxModal(false);
  };

  const handleSubmitNewTx = async (event: React.FormEvent) => {
    event.preventDefault();
    const raw = txAmount.replace(/\s/g, "").replace(",", ".");
    const parsed = Number(raw);

    if (!raw || Number.isNaN(parsed) || parsed <= 0) {
      setTxAmountError("Ingresa un monto válido mayor a 0.");
      return;
    }
    if (txType === "transfer" && (!txDestination || txSource === txDestination)) {
      setTxAmountError("Elige un destino distinto a la fuente.");
      return;
    }
    setTxAmountError(null);

    const date = txDate || todayIso();
    const comment = txDescription.trim() || null;

    if (txType === "transfer") {
      const fromPayload = { date, place: txSource, amount: -parsed, comment: comment ? `Transferencia a ${txDestination}. ${comment}` : `Transferencia a ${txDestination}` };
      const toPayload = { date, place: txDestination, amount: parsed, comment: comment ? `Transferencia desde ${txSource}. ${comment}` : `Transferencia desde ${txSource}` };
      const [fromRes, toRes] = await Promise.all([
        supabase.from("movements").insert(fromPayload).select("id, date, place, amount, comment").single(),
        supabase.from("movements").insert(toPayload).select("id, date, place, amount, comment").single(),
      ]);
      if (fromRes.data && toRes.data) {
        setEntries((prev) => [
          { id: fromRes.data.id as number, date: fromRes.data.date as string, place: fromRes.data.place as string, amount: Number(fromRes.data.amount), comment: (fromRes.data.comment as string | null) ?? "" },
          { id: toRes.data.id as number, date: toRes.data.date as string, place: toRes.data.place as string, amount: Number(toRes.data.amount), comment: (toRes.data.comment as string | null) ?? "" },
          ...prev,
        ]);
        closeNewTxModal();
      }
      return;
    }

    const amount = txType === "income" ? parsed : -parsed;
    const { data, error } = await supabase
      .from("movements")
      .insert({ date, place: txSource, amount, comment })
      .select("id, date, place, amount, comment")
      .single();

    if (error || !data) return;

    const movement = {
      id: data.id as number,
      date: data.date as string,
      place: data.place as string,
      amount: Number(data.amount),
      comment: (data.comment as string | null) ?? "",
    };

    setEntries((prev) => [movement, ...prev]);

    if (txType === "income" && attachToGoal && selectedGoalIdForRetention) {
      const retentionAmount = Math.round(parsed * 0.05 * 100) / 100;
      if (retentionAmount > 0) {
        const { data: contribData, error: contribError } = await supabase
          .from("savings_goal_contributions")
          .insert({
            goal_id: selectedGoalIdForRetention,
            amount: retentionAmount,
            source: "retention",
            movement_id: movement.id,
          })
          .select("id, goal_id, amount, source, created_at, movement_id")
          .single();
        if (!contribError && contribData) {
          const c = contribData as {
            id: string;
            goal_id: string;
            amount: number;
            source: string;
            created_at: string;
            movement_id?: number | null;
          };
          setSavingsContributions((prev) => [
            ...prev,
            {
              id: String(c.id),
              goalId: String(c.goal_id),
              amount: Number(c.amount),
              source: "retention",
              createdAt: c.created_at,
              movementId: typeof c.movement_id === "number" ? c.movement_id : c.movement_id ?? null,
            },
          ]);

          const goal = savingsGoals.find((g) => g.id === selectedGoalIdForRetention);
          if (goal) {
            const newCurrent = goal.currentAmount + retentionAmount;
            const updatedGoal: SavingsGoal = { ...goal, currentAmount: newCurrent };
            const newStatus = recalcGoalStatus(updatedGoal);
            await supabase
              .from("savings_goals")
              .update({ current_amount: newCurrent, status: newStatus })
              .eq("id", goal.id);
            setSavingsGoals((prev) =>
              prev.map((g) =>
                g.id === goal.id
                  ? {
                      ...g,
                      currentAmount: newCurrent,
                      status: newStatus,
                    }
                  : g,
              ),
            );
          }
        }
      }
    }

    closeNewTxModal();
  };

  const handleDelete = (id: number) => {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    setConfirmDelete(entry);
  };

  const confirmDeleteOk = async () => {
    if (!confirmDelete) return;
    const id = confirmDelete.id;

    const { error } = await supabase.from("movements").delete().eq("id", id);

    if (error) {
      // Mostrar el error en consola y avisar al usuario si algo falla en la BD
      console.error("Error al borrar movimiento:", error);
      alert("No se pudo eliminar el movimiento en la base de datos.");
      setConfirmDelete(null);
      return;
    }

    setEntries((prev) => prev.filter((e) => e.id !== id));
    setConfirmDelete(null);
  };

  const confirmDeleteCancel = () => {
    setConfirmDelete(null);
  };

  const confirmDeleteSalaryOk = async () => {
    if (!confirmDeleteSalary) return;
    const id = confirmDeleteSalary.id;
    setConfirmDeleteSalary(null);
    const { error } = await supabase.from("salary_entries").delete().eq("id", id);
    if (error) return;
    setSalaryEntries((prev) => prev.filter((e) => e.id !== id));
    if (editingSalaryId === id) setEditingSalaryId(null);
  };

  const confirmDeleteSalaryCancel = () => {
    setConfirmDeleteSalary(null);
  };

  const handleGoalFieldChange =
    (field: "name" | "targetAmount" | "deadline" | "category") =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value = event.target.value;
      setGoalForm((prev) => ({ ...prev, [field]: value }));
      setGoalFormError(null);
    };

  const resetGoalForm = () => {
    setGoalForm({ name: "", targetAmount: "", deadline: "", category: "" });
    setGoalFormError(null);
    setEditingGoalId(null);
  };

  const handleSubmitGoal = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = goalForm.name.trim();
    const category = goalForm.category.trim();
    const target = Number(goalForm.targetAmount.replace(/\s/g, "").replace(",", "."));

    if (!name) {
      setGoalFormError("Ingresa un nombre para la meta.");
      return;
    }
    if (!category) {
      setGoalFormError("Ingresa una categoría para la meta.");
      return;
    }
    if (!goalForm.targetAmount || Number.isNaN(target) || target <= 0) {
      setGoalFormError("Ingresa un monto objetivo mayor a 0.");
      return;
    }

    let deadline: string | null = null;
    if (goalForm.deadline) {
      const isValidDate = /^\d{4}-\d{2}-\d{2}$/.test(goalForm.deadline);
      if (!isValidDate) {
        setGoalFormError("La fecha límite debe tener formato YYYY-MM-DD.");
        return;
      }
      deadline = goalForm.deadline;
    }

    if (editingGoalId) {
      const { error } = await supabase
        .from("savings_goals")
        .update({
          name,
          category,
          target_amount: target,
          deadline,
        })
        .eq("id", editingGoalId);
      if (error) {
        setGoalFormError(error.message || "No se pudo actualizar la meta.");
        return;
      }
      setSavingsGoals((prev) =>
        prev.map((g) =>
          g.id === editingGoalId ? { ...g, name, category, targetAmount: target, deadline } : g,
        ),
      );
    } else {
      const { data, error } = await supabase
        .from("savings_goals")
        .insert({
          name,
          category,
          target_amount: target,
          current_amount: 0,
          deadline,
          status: "in_progress",
        })
        .select("id, name, target_amount, current_amount, deadline, category, status, created_at")
        .single();
      if (error) {
        setGoalFormError(error.message || "No se pudo crear la meta.");
        return;
      }
      const row = data as {
        id: string;
        name: string;
        target_amount: number;
        current_amount: number;
        deadline: string | null;
        category: string;
        status: string;
        created_at: string;
      };
      const newGoal: SavingsGoal = {
        id: String(row.id),
        name: row.name,
        category: row.category,
        targetAmount: Number(row.target_amount),
        currentAmount: Number(row.current_amount),
        deadline: row.deadline,
        status: (row.status as SavingsGoalStatus) ?? "in_progress",
        createdAt: row.created_at,
      };
      setSavingsGoals((prev) => [newGoal, ...prev]);
    }

    resetGoalForm();
    setShowGoalModal(false);
  };

  const startEditGoal = (goal: SavingsGoal) => {
    setEditingGoalId(goal.id);
    setGoalForm({
      name: goal.name,
      targetAmount: String(goal.targetAmount),
      deadline: goal.deadline ?? "",
      category: goal.category,
    });
    setGoalFormError(null);
    setShowGoalModal(true);
  };

  const recalcGoalStatus = (goal: SavingsGoal): SavingsGoalStatus => {
    if (goal.currentAmount >= goal.targetAmount && goal.targetAmount > 0) {
      return "completed";
    }
    return "in_progress";
  };

  const markGoalCompleted = async (id: string) => {
    const goal = savingsGoals.find((g) => g.id === id);
    if (!goal) return;
    const { error } = await supabase
      .from("savings_goals")
      .update({ current_amount: goal.targetAmount, status: "completed" })
      .eq("id", id);
    if (error) return;
    setSavingsGoals((prev) =>
      prev.map((g) =>
        g.id === id
          ? {
              ...g,
              currentAmount: g.targetAmount,
              status: "completed",
            }
          : g,
      ),
    );
  };

  const handleSubmitContribution = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedGoalForContribution) return;

    const raw = contributionAmount.replace(/\s/g, "").replace(",", ".");
    const parsed = Number(raw);

    if (!raw || Number.isNaN(parsed) || parsed <= 0) {
      setContributionError("Ingresa un monto válido mayor a 0.");
      return;
    }

    const goalId = selectedGoalForContribution.id;

    const { data, error } = await supabase
      .from("savings_goal_contributions")
      .insert({
        goal_id: goalId,
        amount: parsed,
        source: "manual",
      })
      .select("id, goal_id, amount, source, created_at, movement_id")
      .single();
    if (error) {
      setContributionError(error.message || "No se pudo registrar el aporte.");
      return;
    }

    const contribRow = data as {
      id: string;
      goal_id: string;
      amount: number;
      source: string;
      created_at: string;
      movement_id?: number | null;
    };

    setSavingsContributions((prev) => [
      ...prev,
      {
        id: String(contribRow.id),
        goalId: String(contribRow.goal_id),
        amount: Number(contribRow.amount),
        source: contribRow.source === "retention" ? "retention" : "manual",
        createdAt: contribRow.created_at,
        movementId: typeof contribRow.movement_id === "number" ? contribRow.movement_id : contribRow.movement_id ?? null,
      },
    ]);

    const updatedGoal = savingsGoals.find((g) => g.id === goalId);
    if (updatedGoal) {
      const newCurrent = updatedGoal.currentAmount + parsed;
      const withUpdated: SavingsGoal = {
        ...updatedGoal,
        currentAmount: newCurrent,
      };
      const newStatus = recalcGoalStatus(withUpdated);
      await supabase
        .from("savings_goals")
        .update({ current_amount: newCurrent, status: newStatus })
        .eq("id", goalId);
      setSavingsGoals((prev) =>
        prev.map((g) =>
          g.id === goalId
            ? {
                ...g,
                currentAmount: newCurrent,
                status: newStatus,
              }
            : g,
        ),
      );
    }

    setContributionAmount("");
    setContributionError(null);
    setSelectedGoalForContribution(null);
  };

  const closeContributionModal = () => {
    setSelectedGoalForContribution(null);
    setContributionAmount("");
    setContributionError(null);
  };

  const getGoalProgressPct = (goal: SavingsGoalDemo) => {
    if (!goal.targetAmount || goal.targetAmount <= 0) return 0;
    return Math.min(100, (goal.currentAmount / goal.targetAmount) * 100);
  };

  const getGoalRemainingAmount = (goal: SavingsGoalDemo) =>
    Math.max(0, goal.targetAmount - goal.currentAmount);

  const getGoalDaysLeft = (goal: SavingsGoalDemo) => {
    if (!goal.deadline) return null;
    const [year, month, day] = goal.deadline.split("-");
    const d = new Date(Number(year), Number(month) - 1, Number(day));
    return daysUntil(d);
  };

  const activeGoals = useMemo(
    () =>
      savingsGoals
        .filter((g) => g.status !== "completed")
        .sort((a, b) => {
          const da = getGoalDaysLeft(a) ?? Number.POSITIVE_INFINITY;
          const db = getGoalDaysLeft(b) ?? Number.POSITIVE_INFINITY;
          return da - db;
        }),
    [savingsGoals],
  );
  const completedGoals = useMemo(
    () => savingsGoals.filter((g) => g.status === "completed"),
    [savingsGoals],
  );

  useEffect(() => {
    if (
      !confirmDelete &&
      !confirmDeleteSalary &&
      !showNewTxModal &&
      !showAllTxModal &&
      !showSalaryForm &&
      !editingSalaryId &&
      !showGoalModal &&
      !selectedGoalForContribution
    )
      return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        confirmDeleteCancel();
        confirmDeleteSalaryCancel();
        closeNewTxModal();
        setShowAllTxModal(false);
        if (showSalaryForm || editingSalaryId) cancelEditSalary();
        if (showGoalModal) {
          setShowGoalModal(false);
          resetGoalForm();
        }
        if (selectedGoalForContribution) {
          closeContributionModal();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    confirmDelete,
    confirmDeleteSalary,
    showNewTxModal,
    showAllTxModal,
    showSalaryForm,
    editingSalaryId,
    showGoalModal,
    selectedGoalForContribution,
  ]);

  return (
    <div className="app-shell-with-sidebar">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="sidebar-brand-icon" aria-hidden>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M12 8v8M8 12h8"/></svg>
          </span>
          <span className="sidebar-brand-text">Balance+</span>
        </div>
        <nav className="sidebar-nav">
          <div className="sidebar-nav-group">
            <div className="sidebar-nav-label">PRINCIPAL</div>
            <a
              href="#"
              className={`sidebar-nav-item ${activeView === "dashboard" ? "sidebar-nav-item-active" : ""}`}
              onClick={(e) => { e.preventDefault(); setActiveView("dashboard"); }}
            >
              <span className="sidebar-nav-icon" aria-hidden>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
              </span>
              Dashboard
            </a>
          </div>
          <div className="sidebar-nav-group">
            <div className="sidebar-nav-label">FINANZAS</div>
            <a
              href="#"
              className={`sidebar-nav-item ${activeView === "upcoming" ? "sidebar-nav-item-active" : ""}`}
              onClick={(e) => { e.preventDefault(); setActiveView("upcoming"); }}
            >
              <span className="sidebar-nav-icon" aria-hidden>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              </span>
              Próximos salarios
            </a>
            <a
              href="#"
              className={`sidebar-nav-item ${activeView === "goals" ? "sidebar-nav-item-active" : ""}`}
              onClick={(e) => { e.preventDefault(); setActiveView("goals"); }}
            >
              <span className="sidebar-nav-icon" aria-hidden>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="3" x2="12" y2="5"/><line x1="21" y1="12" x2="19" y2="12"/><line x1="12" y1="21" x2="12" y2="19"/><line x1="3" y1="12" x2="5" y2="12"/></svg>
              </span>
              Metas de Ahorro
            </a>
          </div>
        </nav>
      </aside>

      <div className="main-content">
        <header className="main-header">
          <nav className="breadcrumb" aria-label="Navegación">
            <button
              type="button"
              className="breadcrumb-link"
              onClick={() => setActiveView("dashboard")}
            >
              Balance+
            </button>
            <span className="breadcrumb-sep"> &gt; </span>
            <span className="breadcrumb-current">
              {activeView === "dashboard"
                ? "Dashboard"
                : activeView === "upcoming"
                ? "Próximos salarios"
                : "Metas de Ahorro"}
            </span>
          </nav>
          {activeView === "dashboard" && (
            <div className={`reference-bar reference-bar-compact ${adeudado > 0 ? "reference-bar--owing" : "reference-bar--available"}`}>
              <span className="reference-left">
                <span className="reference-main">Mama y Papa</span>
                <span className="reference-amount">{formatCurrency(ahorrosMamaPapa)}</span>
              </span>
              <span className="reference-right">
                {adeudado > 0 ? `Faltando ${formatCurrency(adeudado)}` : `Disponible ${formatCurrency(-adeudado)}`}
              </span>
            </div>
          )}
          {activeView === "upcoming" && upcomingSalaries.length > 0 && (
            <div className="reference-bar reference-bar-compact reference-bar--lavender">
              <span className="reference-left">
                <span className="reference-main">Próximo cobro</span>
                <span className="reference-amount">
                  {MONTH_NAMES_ES[upcomingSalaries[0].month - 1]} {upcomingSalaries[0].year} · {formatCurrency(upcomingSalaries[0].amount)}
                </span>
              </span>
              <span className="reference-right">
                Cobro: {formatNextSalaryDate(upcomingSalaries[0].date)} · En {daysUntil(upcomingSalaries[0].date)} días
              </span>
            </div>
          )}
          {activeView === "goals" && activeGoals.length > 0 && (
            <div className="reference-bar reference-bar-compact reference-bar--goals">
              <span className="reference-left">
                <span className="reference-main">Metas activas</span>
                <span className="reference-amount">
                  {activeGoals.length} meta{activeGoals.length !== 1 ? "s" : ""} en curso
                </span>
              </span>
              <span className="reference-right">
                {(() => {
                  const next = activeGoals[0];
                  const daysLeft = getGoalDaysLeft(next);
                  return daysLeft != null
                    ? `Próxima meta vence en ${daysLeft} día${daysLeft !== 1 ? "s" : ""}`
                    : "Organiza y avanza en tus objetivos";
                })()}
              </span>
            </div>
          )}
        </header>

        {activeView === "upcoming" && (
          <section className="panel panel-upcoming panel-upcoming-page">
            <div className="salary-page-header">
              <h2 className="panel-title salary-page-title">Próximos salarios</h2>
              <button
                type="button"
                className="button button-add-salary"
                onClick={() => {
                  setSalaryError(null);
                  setShowSalaryForm(true);
                  setEditingSalaryId(null);
                  setSalaryForm({ year: new Date().getFullYear(), month: 1, hours: 176, hourlyRate: hourlyRate });
                }}
              >
                + Agregar salario
              </button>
            </div>

            {Object.keys(salaryTotalsByYear).length > 0 && (
              <div
                ref={totalsSliderRef}
                className={`salary-totals-by-year ${Object.keys(salaryTotalsByYear).length > 1 ? "salary-totals-slider" : ""}`}
                onMouseDown={handleTotalsSliderMouseDown}
              >
                {Object.entries(salaryTotalsByYear)
                  .sort(([a], [b]) => Number(b) - Number(a))
                  .map(([year, totals]) => (
                    <div key={year} className="salary-totals-card">
                      <h3 className="salary-totals-year">Año {year}</h3>
                      <div className="salary-totals-row">
                        <span className="salary-totals-label">Ingresos a la fecha</span>
                        <span className="salary-totals-value">{formatCurrency(totals.ingresosALaFecha)}</span>
                      </div>
                      <div className="salary-totals-row">
                        <span className="salary-totals-label">Ingresos proyectados (resto del año)</span>
                        <span className="salary-totals-value">{formatCurrency(totals.ingresosProyectados)}</span>
                      </div>
                    </div>
                  ))}
              </div>
            )}

            <div className="salary-page-table-wrap">
              <table className="salary-page-table">
                <thead>
                  <tr>
                    <th>AÑO</th>
                    <th>MES</th>
                    <th className="salary-page-th-num">HORAS</th>
                    <th className="salary-page-th-num">$/HORA</th>
                    <th className="salary-page-th-num">SALARIO MENSUAL</th>
                    <th>FECHA DE COBRO</th>
                    <th className="salary-page-th-actions"></th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const sorted = [...salaryEntries].sort((a, b) => (a.year !== b.year ? a.year - b.year : a.month - b.month));
                    if (sorted.length === 0) {
                      return (
                        <tr>
                          <td colSpan={7} className="salary-page-empty-cell">
                            No hay salarios cargados. Agregá uno con el botón de arriba.
                          </td>
                        </tr>
                      );
                    }
                    const totalPages = Math.max(1, Math.ceil(sorted.length / SALARY_PAGE_SIZE));
                    const currentPage = Math.min(Math.max(1, salaryPage), totalPages);
                    const start = (currentPage - 1) * SALARY_PAGE_SIZE;
                    const paginated = sorted.slice(start, start + SALARY_PAGE_SIZE);
                    return (
                      <>
                        {paginated.map((entry, rowIndex) => {
                      const now = new Date();
                      const isCurrentMonth = entry.year === now.getFullYear() && entry.month === now.getMonth() + 1;
                      const payDate = getLastBusinessDay(entry.year, entry.month);
                      const amount = entry.hours * entry.hourlyRate;
                      return (
                        <tr key={entry.id} className={isCurrentMonth ? "salary-page-row-current-month" : undefined}>
                          <td>{entry.year}</td>
                          <td>{MONTH_NAMES_ES[entry.month - 1]}</td>
                          <td className="salary-page-td-num">{entry.hours}</td>
                          <td className="salary-page-td-num">{formatCurrency(entry.hourlyRate)}</td>
                          <td className="salary-page-td-num">{formatCurrency(amount)}</td>
                          <td>{formatNextSalaryDate(payDate)}</td>
                          <td className="salary-page-td-actions">
                            <div className="salary-page-row-actions">
                              <button
                                type="button"
                                className="salary-page-action-btn salary-page-action-btn--edit"
                                onClick={() => {
                                  setSalaryError(null);
                                  startEditSalary(entry);
                                  setShowSalaryForm(true);
                                }}
                                aria-label="Editar"
                                title="Editar"
                              >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                              </button>
                              <button
                                type="button"
                                className="salary-page-action-btn salary-page-action-btn--delete"
                                onClick={() => setConfirmDeleteSalary(entry)}
                                aria-label="Eliminar"
                                title="Eliminar"
                              >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                      </>
                    );
                  })()}
                </tbody>
              </table>
            </div>
            {salaryEntries.length > 0 && (() => {
              const sorted = [...salaryEntries].sort((a, b) => (a.year !== b.year ? a.year - b.year : a.month - b.month));
              const totalPages = Math.max(1, Math.ceil(sorted.length / SALARY_PAGE_SIZE));
              const currentPage = Math.min(Math.max(1, salaryPage), totalPages);
              return (
                <div className="salary-page-pagination">
                  <button
                    type="button"
                    className="button button-secondary salary-page-pagination-btn"
                    disabled={currentPage <= 1}
                    onClick={() => setSalaryPage((p) => Math.max(1, p - 1))}
                  >
                    Anterior
                  </button>
                  <span className="salary-page-pagination-info">
                    Página {currentPage} de {totalPages}
                  </span>
                  <button
                    type="button"
                    className="button button-secondary salary-page-pagination-btn"
                    disabled={currentPage >= totalPages}
                    onClick={() => setSalaryPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Siguiente
                  </button>
                </div>
              );
            })()}
          </section>
        )}

        {activeView === "goals" && (
          <section className="panel panel-goals">
            <div className="goals-layout">
              <div className="goals-list-card">
                <div className="goals-list-header">
                  <h2 className="panel-title">Tus metas activas</h2>
                  <div className="goals-list-header-right">
                    <p className="panel-sub-right">
                      {activeGoals.length === 0
                        ? "Todavía no creaste metas"
                        : `${activeGoals.length} meta${activeGoals.length !== 1 ? "s" : ""} en curso`}
                    </p>
                    <button
                      type="button"
                      className="button goals-add-button"
                      onClick={() => {
                        resetGoalForm();
                        setShowGoalModal(true);
                      }}
                    >
                      + Nueva meta
                    </button>
                  </div>
                </div>
                {activeGoals.length === 0 ? (
                  <div className="goals-empty-state">
                    <p className="goals-empty-title">Empieza creando tu primera meta</p>
                    <p className="goals-empty-sub">
                      Por ejemplo: "Fondo de emergencias", "Viaje de vacaciones" o "Nuevo equipo".
                    </p>
                  </div>
                ) : (
                  <div
                    ref={goalsSliderRef}
                    className="goals-grid goals-slider"
                    onMouseDown={makeHorizontalDragHandler(goalsSliderRef, goalsDragRef)}
                  >
                    {activeGoals.map((goal) => {
                      const progressPct = getGoalProgressPct(goal);
                      const remaining = getGoalRemainingAmount(goal);
                      const daysLeft = getGoalDaysLeft(goal);
                      const isAtRisk = goal.status === "at_risk";
                      const isCompleted = goal.status === "completed";
                      return (
                        <article key={goal.id} className="goal-card">
                          <header className="goal-card-header">
                            <div>
                              <h3 className="goal-card-title">{goal.name}</h3>
                              <p className="goal-card-category">{goal.category}</p>
                            </div>
                            {(goal.currentAmount > 0 || isCompleted) && (
                              <span
                                className={`goal-status-chip goal-status-chip--${goal.status}`}
                              >
                                {isCompleted
                                  ? "Completada"
                                  : isAtRisk
                                  ? "En riesgo"
                                  : "En curso"}
                              </span>
                            )}
                          </header>

                          <div className="goal-progress">
                            <div className="goal-progress-bar">
                              <div
                                className={`goal-progress-fill goal-progress-fill--${goal.status}`}
                                style={{ width: `${progressPct}%` }}
                              />
                            </div>
                            <div className="goal-progress-row">
                              <span className="goal-progress-main">
                                Llevas{" "}
                                <strong>
                                  {formatCurrency(goal.currentAmount)} /{" "}
                                  {formatCurrency(goal.targetAmount)}
                                </strong>
                              </span>
                              <span className="goal-progress-pct">
                                {progressPct.toFixed(0)}%
                              </span>
                            </div>
                            <p className="goal-progress-remaining">
                              {remaining > 0
                                ? `Te faltan ${formatCurrency(remaining)} para llegar.`
                                : "¡Meta alcanzada! 🎉"}
                            </p>
                            {daysLeft != null && (
                              <p className="goal-deadline">
                                Te quedan{" "}
                                <strong>
                                  {daysLeft} día{daysLeft !== 1 ? "s" : ""}
                                </strong>{" "}
                                para tu objetivo.
                              </p>
                            )}
                          </div>

                          <footer className="goal-card-footer">
                            <button
                              type="button"
                              className="button button-secondary goal-card-btn"
                              onClick={() => {
                                setSelectedGoalForContribution(goal);
                                setContributionAmount("");
                                setContributionError(null);
                              }}
                            >
                              + Aportar
                            </button>
                            <div className="goal-card-footer-right">
                              <button
                                type="button"
                                className="button button-secondary goal-card-btn"
                                onClick={() => startEditGoal(goal)}
                              >
                                Editar
                              </button>
                              <button
                                type="button"
                                className="button goal-card-btn"
                                onClick={() => markGoalCompleted(goal.id)}
                              >
                                Marcar como completada
                              </button>
                            </div>
                          </footer>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <section className="goals-achievements">
              <h2 className="panel-title">Logros</h2>
              {completedGoals.length === 0 ? (
                <p className="goals-achievements-empty">
                  Cuando completes una meta, aparecerá aquí para que puedas celebrar tus avances.
                </p>
              ) : (
                <div
                  ref={achievementsSliderRef}
                  className="goals-achievements-grid goals-slider"
                  onMouseDown={makeHorizontalDragHandler(achievementsSliderRef, achievementsDragRef)}
                >
                  {completedGoals.map((goal) => (
                    <article key={goal.id} className="goal-achievement-card">
                      <div className="goal-achievement-header">
                        <span className="goal-achievement-icon" aria-hidden>
                          🏆
                        </span>
                        <div>
                          <h3 className="goal-achievement-title">{goal.name}</h3>
                          <p className="goal-achievement-category">{goal.category}</p>
                        </div>
                      </div>
                      <p className="goal-achievement-amount">
                        Alcanzaste {formatCurrency(goal.targetAmount)} para esta meta.
                      </p>
                      <p className="goal-achievement-date">
                        Creada el {formatDisplayDate(goal.createdAt)}
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </section>
        )}

      {confirmDelete && (
        <div
          className="modal-overlay"
          onClick={confirmDeleteCancel}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-delete-title"
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 id="modal-delete-title" className="modal-title">
              Eliminar movimiento
            </h2>
            {confirmDelete && (
              <p className="modal-body">
                ¿Seguro que quieres eliminar este movimiento?
                <br />
                <strong>
                  {formatDisplayDate(confirmDelete.date)} · {confirmDelete.place} ·{" "}
                  {formatCurrency(confirmDelete.amount)}
                </strong>
              </p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="button button-secondary"
                onClick={confirmDeleteCancel}
              >
                Cancelar
              </button>
              <button type="button" className="button" onClick={confirmDeleteOk}>
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteSalary && (
        <div
          className="modal-overlay"
          onClick={confirmDeleteSalaryCancel}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-delete-salary-title"
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 id="modal-delete-salary-title" className="modal-title">
              Eliminar salario
            </h2>
            <p className="modal-body">
              ¿Seguro que querés eliminar este salario?
              <br />
              <strong>
                {MONTH_NAMES_ES[confirmDeleteSalary.month - 1]} {confirmDeleteSalary.year} ·{" "}
                {formatCurrency(confirmDeleteSalary.hours * confirmDeleteSalary.hourlyRate)}
              </strong>
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="button button-secondary"
                onClick={confirmDeleteSalaryCancel}
              >
                Cancelar
              </button>
              <button type="button" className="button" onClick={confirmDeleteSalaryOk}>
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {showAllTxModal && (
        <div
          className="modal-overlay"
          onClick={() => setShowAllTxModal(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-all-tx-title"
        >
          <div className="modal modal-all-transactions" onClick={(e) => e.stopPropagation()}>
            <div className="modal-all-tx-header">
              <h2 id="modal-all-tx-title" className="modal-title">
                Todas las transacciones
              </h2>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowAllTxModal(false)}
                aria-label="Cerrar"
              >
                ×
              </button>
            </div>
            <p className="modal-all-tx-sub">
              {entries.length} movimiento{entries.length !== 1 ? "s" : ""} en total
            </p>
            <div className="tx-list-all-wrap">
              <ul className="tx-list-plain">
                {entries.map((entry) => {
                  const positive = entry.amount >= 0;
                  return (
                    <li key={entry.id} className="tx-list-plain-item">
                      <span className={`tx-list-icon ${positive ? "tx-list-icon-in" : "tx-list-icon-out"}`}>
                        {positive ? "↑" : "↓"}
                      </span>
                      <div className="tx-list-body">
                        <span className="tx-list-desc">{entry.comment || "Sin descripción"}</span>
                        <span className="tx-list-meta">
                          {entry.place} · {formatDisplayDate(entry.date)}
                        </span>
                      </div>
                      <div className="tx-list-right">
                        <span className={positive ? "tx-list-amount-in" : "tx-list-amount-out"}>
                          {positive ? "+" : ""}{formatCurrency(entry.amount)}
                        </span>
                        <button
                          type="button"
                          className="btn-delete-inline"
                          onClick={() => handleDelete(entry.id)}
                          title="Eliminar"
                        >
                          Eliminar
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      )}

      {showNewTxModal && (
        <div
          className="modal-overlay"
          onClick={closeNewTxModal}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-new-tx-title"
        >
          <div className="modal modal-transaction" onClick={(e) => e.stopPropagation()}>
            <div className="modal-transaction-header">
              <div>
                <h2 id="modal-new-tx-title" className="modal-title modal-transaction-title">
                  Nueva transacción
                </h2>
                <p className="modal-transaction-subtitle">
                  Registra un movimiento de dinero en tus fuentes.
                </p>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={closeNewTxModal}
                aria-label="Cerrar"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSubmitNewTx}>
              <div className="tx-type-group">
                <span className="tx-type-label">Tipo</span>
                <div className="tx-type-btns">
                  <button
                    type="button"
                    className={`tx-type-btn ${txType === "income" ? "tx-type-btn-active" : ""}`}
                    onClick={() => setTxType("income")}
                  >
                    <span className="tx-type-icon">←</span>
                    Ingreso
                  </button>
                  <button
                    type="button"
                    className={`tx-type-btn ${txType === "expense" ? "tx-type-btn-active" : ""}`}
                    onClick={() => setTxType("expense")}
                  >
                    <span className="tx-type-icon">→</span>
                    Gasto
                  </button>
                  <button
                    type="button"
                    className={`tx-type-btn ${txType === "transfer" ? "tx-type-btn-active" : ""}`}
                    onClick={() => setTxType("transfer")}
                  >
                    <span className="tx-type-icon">↔</span>
                    Transferencia
                  </button>
                </div>
              </div>

              <div className="tx-field">
                <label className="tx-label">Monto</label>
                <div className="tx-amount-wrap">
                  <span className="tx-amount-prefix">$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    className={`input tx-amount-input ${txAmountError ? "input-error" : ""}`}
                    placeholder="0.00"
                    value={txAmount}
                    onChange={(e) => {
                      setTxAmount(e.target.value);
                      setTxAmountError(null);
                    }}
                  />
                </div>
                {txAmountError && <div className="error-text">{txAmountError}</div>}
              </div>

              <div className="tx-field">
                <label className="tx-label">Fuente</label>
                <select
                  className="select tx-select"
                  value={txSource}
                  onChange={(e) => setTxSource(e.target.value)}
                >
                  {places.map((place) => (
                    <option key={place} value={place}>
                      {place}
                    </option>
                  ))}
                </select>
              </div>

              {txType === "transfer" && (
                <div className="tx-field">
                  <label className="tx-label">Destino</label>
                  <select
                    className="select tx-select"
                    value={txDestination === txSource ? "" : txDestination}
                    onChange={(e) => setTxDestination(e.target.value)}
                  >
                    <option value="">Selecciona destino</option>
                    {places.filter((p) => p !== txSource).map((place) => (
                      <option key={place} value={place}>
                        {place}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="tx-field">
                <label className="tx-label">Fecha</label>
                <input
                  type="date"
                  className="input tx-date-input"
                  value={txDate}
                  onChange={(e) => setTxDate(e.target.value)}
                />
              </div>

              <div className="tx-field">
                <label className="tx-label">Descripción</label>
                <textarea
                  className="textarea tx-description"
                  placeholder="¿Para qué fue esta transacción?"
                  value={txDescription}
                  onChange={(e) => setTxDescription(e.target.value)}
                />
              </div>

              {txType === "income" && savingsGoals.some((g) => g.status !== "completed") && (
                <div className="tx-field tx-field-goal">
                  <label className="tx-label">Ahorro automático</label>
                  <div className="tx-goal-retention-row">
                    <label className="tx-goal-checkbox-label">
                      <input
                        type="checkbox"
                        checked={attachToGoal}
                        onChange={(e) => setAttachToGoal(e.target.checked)}
                      />
                      <span>Asignar 5% de este ingreso a una meta de ahorro</span>
                    </label>
                    {attachToGoal && (
                      <select
                        className="select tx-select tx-goal-select"
                        value={selectedGoalIdForRetention ?? ""}
                        onChange={(e) => setSelectedGoalIdForRetention(e.target.value || null)}
                      >
                        <option value="">Selecciona una meta</option>
                        {savingsGoals
                          .filter((g) => g.status !== "completed")
                          .map((goal) => (
                            <option key={goal.id} value={goal.id}>
                              {goal.name}
                            </option>
                          ))}
                      </select>
                    )}
                  </div>
                </div>
              )}

              <div className="modal-actions modal-transaction-actions">
                <button type="button" className="button button-secondary" onClick={closeNewTxModal}>
                  Cancelar
                </button>
                <button type="submit" className="button button-tx-submit">
                  Agregar transacción
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showGoalModal && (
        <div
          className="modal-overlay"
          onClick={() => {
            setShowGoalModal(false);
            resetGoalForm();
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-goal-title"
        >
          <div
            className="modal modal-goal-form"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-goal-header">
              <div>
                <h2 id="modal-goal-title" className="modal-title">
                  {editingGoalId ? "Editar meta de ahorro" : "Nueva meta de ahorro"}
                </h2>
                <p className="modal-goal-subtitle">
                  Define un objetivo, un monto a alcanzar y una fecha límite opcional.
                </p>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => {
                  setShowGoalModal(false);
                  resetGoalForm();
                }}
                aria-label="Cerrar"
              >
                ×
              </button>
            </div>

            <form
              onSubmit={handleSubmitGoal}
              className="modal-goal-form-body"
            >
              <div className="goals-modal-fields">
                <div className="field">
                  <div className="field-label-row">
                    <label className="field-label">Nombre de la meta</label>
                  </div>
                  <input
                    type="text"
                    className="input"
                    placeholder="Ej. Fondo de emergencias"
                    value={goalForm.name}
                    onChange={handleGoalFieldChange("name")}
                  />
                </div>
                <div className="field">
                  <div className="field-label-row">
                    <label className="field-label">Monto objetivo</label>
                    <span className="field-hint">Sin comas, solo números</span>
                  </div>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="input"
                    placeholder="50000"
                    value={goalForm.targetAmount}
                    onChange={handleGoalFieldChange("targetAmount")}
                  />
                </div>
                <div className="field">
                  <div className="field-label-row">
                    <label className="field-label">Fecha límite (opcional)</label>
                  </div>
                  <input
                    type="date"
                    className="input"
                    value={goalForm.deadline}
                    onChange={handleGoalFieldChange("deadline")}
                  />
                </div>
                <div className="field">
                  <div className="field-label-row">
                    <label className="field-label">Categoría de ahorro</label>
                  </div>
                  <select
                    className="select"
                    value={goalForm.category}
                    onChange={handleGoalFieldChange("category")}
                  >
                    <option value="">Selecciona o escribe</option>
                    <option value="Viajes">Viajes</option>
                    <option value="Tecnología">Tecnología</option>
                    <option value="Salud">Salud</option>
                    <option value="Hogar">Hogar</option>
                    <option value="Emergencias">Emergencias</option>
                    <option value="Otro">Otro</option>
                  </select>
                </div>
              </div>
              {goalFormError && (
                <div className="error-text goals-error-text">{goalFormError}</div>
              )}
              <div className="modal-actions modal-goal-actions">
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => {
                    setShowGoalModal(false);
                    resetGoalForm();
                  }}
                >
                  Cancelar
                </button>
                <button type="submit" className="button">
                  {editingGoalId ? "Guardar cambios" : "Crear meta"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedGoalForContribution && (
        <div
          className="modal-overlay"
          onClick={closeContributionModal}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-goal-contribution-title"
        >
          <div
            className="modal modal-goal-contribution"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-goal-contribution-header">
              <div>
                <h2
                  id="modal-goal-contribution-title"
                  className="modal-title"
                >
                  Aportar a la meta
                </h2>
                <p className="modal-goal-contribution-sub">
                  Registra manualmente un aporte a esta meta de ahorro.
                </p>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={closeContributionModal}
                aria-label="Cerrar"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSubmitContribution}>
              <div className="goal-contribution-summary">
                <div className="goal-contribution-main">
                  <span className="goal-contribution-name">
                    {selectedGoalForContribution.name}
                  </span>
                  <span className="goal-contribution-category">
                    {selectedGoalForContribution.category}
                  </span>
                </div>
                <div className="goal-contribution-amounts">
                  <span className="goal-contribution-amount">
                    {formatCurrency(selectedGoalForContribution.currentAmount)}{" "}
                    / {formatCurrency(selectedGoalForContribution.targetAmount)}
                  </span>
                </div>
              </div>

              <div className="tx-field">
                <label className="tx-label">Monto del aporte</label>
                <div className="tx-amount-wrap">
                  <span className="tx-amount-prefix">$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    className={`input tx-amount-input ${
                      contributionError ? "input-error" : ""
                    }`}
                    placeholder="0.00"
                    value={contributionAmount}
                    onChange={(e) => {
                      setContributionAmount(e.target.value);
                      setContributionError(null);
                    }}
                  />
                </div>
                {contributionError && (
                  <div className="error-text">{contributionError}</div>
                )}
              </div>

              <div className="modal-actions modal-transaction-actions">
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={closeContributionModal}
                >
                  Cancelar
                </button>
                <button type="submit" className="button">
                  Guardar aporte
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {(showSalaryForm || editingSalaryId) && (
        <div
          className="modal-overlay"
          onClick={cancelEditSalary}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-salary-title"
        >
          <div className="modal modal-salary-form" onClick={(e) => e.stopPropagation()}>
            <h2 id="modal-salary-title" className="modal-title">
              {editingSalaryId ? "Editar salario" : "Agregar salario"}
            </h2>
            <div className="salary-form-card-fields">
              <div className="salary-abm-field">
                <label htmlFor="salary-year">Año</label>
                <input
                  id="salary-year"
                  type="number"
                  min="2020"
                  max="2030"
                  className="input salary-abm-input"
                  value={salaryForm.year}
                  onChange={(e) => setSalaryForm((f) => ({ ...f, year: Number(e.target.value) || f.year }))}
                />
              </div>
              <div className="salary-abm-field">
                <label htmlFor="salary-month">Mes</label>
                <select
                  id="salary-month"
                  className="select salary-abm-select"
                  value={salaryForm.month}
                  onChange={(e) => setSalaryForm((f) => ({ ...f, month: Number(e.target.value) }))}
                >
                  {MONTH_NAMES_ES.map((name, i) => (
                    <option key={i} value={i + 1}>{name}</option>
                  ))}
                </select>
              </div>
              <div className="salary-abm-field">
                <label htmlFor="salary-hours">Horas</label>
                <input
                  id="salary-hours"
                  type="number"
                  min="1"
                  className="input salary-abm-input"
                  value={salaryForm.hours}
                  onChange={(e) => setSalaryForm((f) => ({ ...f, hours: Number(e.target.value) || 0 }))}
                />
              </div>
              <div className="salary-abm-field">
                <label htmlFor="salary-hourly">Monto por hora ($)</label>
                <input
                  id="salary-hourly"
                  type="number"
                  min="0"
                  step="0.01"
                  className="input salary-abm-input"
                  value={salaryForm.hourlyRate}
                  onChange={(e) => setSalaryForm((f) => ({ ...f, hourlyRate: Number(e.target.value) || 0 }))}
                />
              </div>
            </div>
            <p className="salary-abm-calc">Monto mensual: {formatCurrency(salaryForm.hours * salaryForm.hourlyRate)}</p>
            {salaryError && (
              <p className="salary-modal-error" role="alert">
                {salaryError}
              </p>
            )}
            <div className="modal-actions">
              <button type="button" className="button button-secondary" onClick={cancelEditSalary}>
                Cancelar
              </button>
              {editingSalaryId ? (
                <button type="button" className="button" onClick={updateSalaryEntry}>
                  Guardar
                </button>
              ) : (
                <button
                  type="button"
                  className="button"
                  onClick={addSalaryEntry}
                  disabled={salaryEntries.some((e) => e.year === salaryForm.year && e.month === salaryForm.month) || salaryForm.hours <= 0 || salaryForm.hourlyRate < 0}
                >
                  Agregar
                </button>
              )}
            </div>
          </div>
        </div>
      )}

        {activeView === "dashboard" && (
        <>
        <div className="dashboard-columns">
          <section className="panel panel-accounts">
            <div className="panel-accounts-content">
              <h2 className="panel-title">Mis cuentas</h2>
              <div className="panel-total-row">
                <div className="panel-total">{formatCurrency(grandTotal)}</div>
                <div className={`panel-total-variation ${totalVsLastMonth.positive ? "panel-total-variation--up" : "panel-total-variation--down"}`}>
                  <span className="panel-total-variation-pill">
                    <span className="panel-total-variation-arrow" aria-hidden>
                      {totalVsLastMonth.positive ? "↑" : "↓"}
                    </span>
                    <span className="panel-total-variation-pct">
                      {totalVsLastMonth.pct.toFixed(1)}%
                    </span>
                  </span>
                  <span className="panel-total-variation-label">vs último mes</span>
                </div>
              </div>
              <p className="panel-sub">Saldo total en todas las fuentes</p>
              <ul className="accounts-list">
                {places.map((place) => {
                  const value = totalsByPlace[place];
                  const positive = value >= 0;
                  return (
                    <li key={place} className="accounts-list-item">
                      <AccountIcon place={place} />
                      <span className="accounts-list-name">{place}</span>
                      <span className="accounts-list-balance">
                        {positive ? "+" : ""}{formatCurrency(value)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="panel-actions">
              <button type="button" className="button" onClick={openNewTxModal}>
                + Nueva transacción
              </button>
            </div>
          </section>

          <section className="panel panel-transactions">
            <h2 className="panel-title">Transacciones recientes</h2>
            <p className="panel-sub-right">
              Actividad reciente ({entries.length} movimientos)
            </p>
            <div className="tx-list-dashboard-wrap">
              <ul className="tx-list-plain">
                {entries.slice(0, DASHBOARD_TX_LIMIT).map((entry) => {
                  const positive = entry.amount >= 0;
                  return (
                    <li key={entry.id} className="tx-list-plain-item">
                      <span className={`tx-list-icon ${positive ? "tx-list-icon-in" : "tx-list-icon-out"}`}>
                        {positive ? "↑" : "↓"}
                      </span>
                      <div className="tx-list-body">
                        <span className="tx-list-desc">{entry.comment || "Sin descripción"}</span>
                        <span className="tx-list-meta">
                          {entry.place} · {formatDisplayDate(entry.date)}
                        </span>
                      </div>
                      <div className="tx-list-right">
                        <span className={positive ? "tx-list-amount-in" : "tx-list-amount-out"}>
                          {positive ? "+" : ""}{formatCurrency(entry.amount)}
                        </span>
                        <button
                          type="button"
                          className="btn-delete-inline"
                          onClick={() => handleDelete(entry.id)}
                          title="Eliminar"
                        >
                          Eliminar
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="panel-transactions-footer">
              <button
                type="button"
                className="button button-ver-todas"
                onClick={() => setShowAllTxModal(true)}
              >
                Ver todas las transacciones →
              </button>
            </div>
          </section>
        </div>

        <div className="dashboard-secondary">
          <section className="panel panel-upcoming">
            <div className="upcoming-events-header">
              <span className="upcoming-events-icon" aria-hidden>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              </span>
              <h2 className="panel-title upcoming-events-title">Próximos salarios</h2>
            </div>
            <div
              ref={upcomingDashboardSliderRef}
              className="upcoming-cards upcoming-cards-slider"
              onMouseDown={makeHorizontalDragHandler(
                upcomingDashboardSliderRef,
                upcomingDashboardDragRef,
              )}
            >
              {upcomingSalaries.length === 0 ? (
                <div className="upcoming-card upcoming-card-empty">
                  <p className="upcoming-card-empty-text">No hay próximos salarios cargados.</p>
                  <a href="#" className="upcoming-card-link" onClick={(e) => { e.preventDefault(); setActiveView("upcoming"); }}>
                    Agregar en Próximos salarios →
                  </a>
                </div>
              ) : (
              upcomingSalaries.map((item, index) => {
                const days = daysUntil(item.date);
                const isFirst = index === 0;
                return (
                  <div key={item.id} className="upcoming-card">
                    <div className="upcoming-card-top">
                      <span className="upcoming-card-icon" aria-hidden>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M12 8v8M8 12h8"/></svg>
                      </span>
                      <span className={`upcoming-card-status ${isFirst ? "upcoming-card-status--next" : "upcoming-card-status--pending"}`}>
                        {isFirst ? "Próximo" : "Siguiente"}
                      </span>
                    </div>
                    <h3 className="upcoming-card-title">
                      Salario {MONTH_NAMES_ES[item.month - 1]} {item.year}
                    </h3>
                    <p className="upcoming-card-desc">Cobro último día hábil del mes</p>
                    <div className="upcoming-card-progress-wrap">
                      <span className="upcoming-card-progress-label">En {days} días</span>
                      <div className="upcoming-card-progress-bar">
                        <div
                          className="upcoming-card-progress-fill"
                          style={{ width: `${Math.min(100, Math.max(0, 100 - (days / 31) * 100))}%` }}
                        />
                      </div>
                    </div>
                    <p className="upcoming-card-amount">
                      <span className="upcoming-card-amount-label">Monto </span>
                      {formatCurrency(item.amount)}
                    </p>
                    <p className="upcoming-card-date">
                      <span className="upcoming-card-date-icon" aria-hidden>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                      </span>
                      Cobro: {formatNextSalaryDate(item.date)}
                    </p>
                    <a
                      href="#"
                      className="upcoming-card-link"
                      onClick={(e) => { e.preventDefault(); setActiveView("upcoming"); }}
                    >
                      Ver detalle →
                    </a>
                  </div>
                );
              })
              )
              }
            </div>
          </section>

          <section className="panel panel-goals-summary">
            <div className="goals-summary-header">
              <h2 className="panel-title">Progreso de metas</h2>
              <button
                type="button"
                className="button button-secondary goals-summary-link"
                onClick={() => setActiveView("goals")}
              >
                Ver todas →
              </button>
            </div>
            {savingsGoals.length === 0 ? (
              <p className="goals-summary-empty">
                Todavía no creaste metas de ahorro. Empieza definiendo tu primer objetivo.
              </p>
            ) : (
              <ul className="goals-summary-list">
                {activeGoals.slice(0, 3).map((goal) => {
                  const progressPct = getGoalProgressPct(goal);
                  return (
                    <li key={goal.id} className="goals-summary-item">
                      <div className="goals-summary-row">
                        <span className="goals-summary-name">{goal.name}</span>
                        <span className="goals-summary-amount">
                          {formatCurrency(goal.currentAmount)} / {formatCurrency(goal.targetAmount)}
                        </span>
                      </div>
                      <div className="goals-summary-bar">
                        <div
                          className="goals-summary-bar-fill"
                          style={{ width: `${progressPct}%` }}
                        >
                          <span className="goals-summary-bar-label">
                            {progressPct.toFixed(0)}%
                          </span>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
        </>
        )}
      </div>
    </div>
  );
}

