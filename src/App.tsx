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

type ViewId = "dashboard" | "upcoming";

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

  // Cargar datos iniciales desde Supabase
  useEffect(() => {
    const load = async () => {
      try {
        const [
          { data: movements },
          { data: placesData },
          { data: settingsData },
          { data: salaryRows },
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

  const adeudado = ahorrosMamaPapa - grandTotal;

  const nextSalary = useMemo(() => getNextSalaryPayDate(hourlyRate), [hourlyRate]);
  const upcomingSalaries = useMemo(() => getUpcomingFromEntries(salaryEntries, 3), [salaryEntries]);

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

    setEntries((prev) => [
      { id: data.id as number, date: data.date as string, place: data.place as string, amount: Number(data.amount), comment: (data.comment as string | null) ?? "" },
      ...prev,
    ]);
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

  useEffect(() => {
    if (!confirmDelete && !confirmDeleteSalary && !showNewTxModal && !showAllTxModal && !showSalaryForm && !editingSalaryId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        confirmDeleteCancel();
        confirmDeleteSalaryCancel();
        closeNewTxModal();
        setShowAllTxModal(false);
        if (showSalaryForm || editingSalaryId) cancelEditSalary();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmDelete, confirmDeleteSalary, showNewTxModal, showAllTxModal, showSalaryForm, editingSalaryId]);

  return (
    <div className="app-shell-with-sidebar">
      <aside className="sidebar">
        <div className="sidebar-brand">Control Gastos</div>
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
              className="sidebar-nav-item"
              onClick={(e) => {
                e.preventDefault();
                setShowAllTxModal(true);
              }}
            >
              <span className="sidebar-nav-icon" aria-hidden>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
              </span>
              Transacciones
            </a>
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
          </div>
        </nav>
        <div className="sidebar-bottom">
          <a href="#" className="sidebar-nav-item">
            <span className="sidebar-nav-icon" aria-hidden>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </span>
            Configuración
          </a>
          <a href="#" className="sidebar-nav-item">
            <span className="sidebar-nav-icon" aria-hidden>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            </span>
            Ayuda
          </a>
        </div>
      </aside>

      <div className="main-content">
        <header className="main-header">
          <nav className="breadcrumb" aria-label="Navegación">
            <button
              type="button"
              className="breadcrumb-link"
              onClick={() => setActiveView("dashboard")}
            >
              Control Gastos
            </button>
            <span className="breadcrumb-sep"> &gt; </span>
            <span className="breadcrumb-current">
              {activeView === "dashboard" ? "Dashboard" : "Próximos salarios"}
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
            <div className="reference-bar reference-bar-compact reference-bar--neutral">
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
              <div className="panel-total">{formatCurrency(grandTotal)}</div>
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

        <section className="panel panel-upcoming">
          <div className="upcoming-events-header">
            <span className="upcoming-events-icon" aria-hidden>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            </span>
            <h2 className="panel-title upcoming-events-title">Próximos salarios</h2>
          </div>
          <div className="upcoming-cards">
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
        </>
        )}
      </div>
    </div>
  );
}

