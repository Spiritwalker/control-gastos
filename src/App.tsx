import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";

const DEFAULT_PLACES = ["Caja Seguridad", "Efectivo", "Deel"] as const;

/** Cantidad fija de transacciones mostradas en el dashboard */
const DASHBOARD_TX_LIMIT = 8;

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

export function App() {
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
        const [{ data: movements }, { data: placesData }, { data: settingsData }] =
          await Promise.all([
            supabase
              .from("movements")
              .select("id, date, place, amount, comment")
              .order("date", { ascending: false })
              .order("id", { ascending: false }),
            supabase.from("places").select("name").order("name", { ascending: true }),
            supabase.from("settings").select("id, ahorros_mama_papa").eq("id", 1).maybeSingle(),
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
      } catch {
        // si falla, la app sigue vacía
      }
    };

    void load();
  }, []);

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

  useEffect(() => {
    if (!confirmDelete && !showNewTxModal && !showAllTxModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        confirmDeleteCancel();
        closeNewTxModal();
        setShowAllTxModal(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmDelete, showNewTxModal, showAllTxModal]);

  return (
    <div className="app-shell-with-sidebar">
      <aside className="sidebar">
        <div className="sidebar-brand">Control Gastos</div>
        <nav className="sidebar-nav">
          <div className="sidebar-nav-group">
            <div className="sidebar-nav-label">PRINCIPAL</div>
            <a href="#" className="sidebar-nav-item sidebar-nav-item-active">
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
            <a href="#" className="sidebar-nav-item">
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
          <div className="breadcrumb">Control Gastos &gt; Dashboard</div>
          <div className={`reference-bar reference-bar-compact ${adeudado > 0 ? "reference-bar--owing" : "reference-bar--available"}`}>
            <span className="reference-left">
              <span className="reference-main">Mama y Papa</span>
              <span className="reference-amount">{formatCurrency(ahorrosMamaPapa)}</span>
            </span>
            <span className="reference-right">
              {adeudado > 0 ? `Faltando ${formatCurrency(adeudado)}` : `Disponible ${formatCurrency(-adeudado)}`}
            </span>
          </div>
        </header>

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
          <h2 className="panel-title">Próximos salarios</h2>
          <p className="panel-sub">Aquí podrás ver y planificar tus próximos ingresos. (Próximamente)</p>
        </section>
      </div>
    </div>
  );
}

