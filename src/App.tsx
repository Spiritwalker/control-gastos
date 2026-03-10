import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";

const DEFAULT_PLACES = ["Caja Seguridad", "Efectivo", "Deel"] as const;

interface Entry {
  id: number;
  date: string;
  place: string;
  amount: number;
  comment: string;
}

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

export function App() {
  const [places, setPlaces] = useState<string[]>([...DEFAULT_PLACES]);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [form, setForm] = useState<FormState>({
    date: todayIso(),
    place: DEFAULT_PLACES[0],
    amount: "",
    comment: "",
  });
  const [amountError, setAmountError] = useState<string | null>(null);
  const [ahorrosMamaPapa, setAhorrosMamaPapa] = useState(23000);
  const [isEditingAhorros, setIsEditingAhorros] = useState(false);
  const [tempAhorros, setTempAhorros] = useState("23000");
  const [confirmAhorros, setConfirmAhorros] = useState<{ newValue: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Entry | null>(null);

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
            setTempAhorros(String(val));
          }
        }
      } catch {
        // si falla, la app sigue vacía
      }
    };

    void load();
  }, []);

  const addCategory = () => {
    const name = newCategoryName.trim();
    if (!name || places.includes(name)) return;
    setPlaces((prev) => [...prev, name]);
    setNewCategoryName("");
    void supabase.from("places").insert({ name }).select("name").single();
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

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const raw = form.amount.replace(/\s/g, "").replace(",", ".");
    const parsed = Number(raw);

    if (!raw || Number.isNaN(parsed)) {
      setAmountError("Ingresa un número válido (positivo o negativo).");
      return;
    }

    const date = form.date || todayIso();
    const payload = {
      date,
      place: form.place,
      amount: parsed,
      comment: form.comment.trim() || null,
    };

    const { data, error } = await supabase
      .from("movements")
      .insert(payload)
      .select("id, date, place, amount, comment")
      .single();

    if (error || !data) {
      // si falla, no cambiamos el estado
      return;
    }

    const newEntry: Entry = {
      id: data.id as number,
      date: data.date as string,
      place: data.place as string,
      amount: Number(data.amount),
      comment: (data.comment as string | null) ?? "",
    };

    setEntries((prev) => [newEntry, ...prev]);
    resetForm();
  };

  const handleDelete = (id: number) => {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    setConfirmDelete(entry);
  };

  const startEditAhorros = () => {
    setTempAhorros(String(ahorrosMamaPapa));
    setIsEditingAhorros(true);
  };

  const cancelEditAhorros = () => {
    setIsEditingAhorros(false);
  };

  const saveEditAhorros = () => {
    const parsed = Number(tempAhorros.replace(/\s/g, "").replace(",", "."));
    if (Number.isNaN(parsed) || parsed < 0) return;
    const newValue = parsed;
    if (newValue === ahorrosMamaPapa) {
      setIsEditingAhorros(false);
      return;
    }
    setConfirmAhorros({ newValue });
  };

  const confirmAhorrosOk = () => {
    if (confirmAhorros) {
      const next = confirmAhorros.newValue;
      void supabase
        .from("settings")
        .upsert({ id: 1, ahorros_mama_papa: next }, { onConflict: "id" });
      setAhorrosMamaPapa(next);
      setIsEditingAhorros(false);
      setConfirmAhorros(null);
    }
  };

  const confirmAhorrosCancel = () => {
    setConfirmAhorros(null);
  };

  const confirmDeleteOk = () => {
    if (confirmDelete) {
      const id = confirmDelete.id;
      void supabase.from("movements").delete().eq("id", id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
      setConfirmDelete(null);
    }
  };

  const confirmDeleteCancel = () => {
    setConfirmDelete(null);
  };

  useEffect(() => {
    if (!confirmAhorros && !confirmDelete) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        confirmAhorrosCancel();
        confirmDeleteCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmAhorros, confirmDelete]);

  return (
    <div className="app-shell">
      {confirmAhorros && (
        <div
          className="modal-overlay"
          onClick={confirmAhorrosCancel}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 id="modal-title" className="modal-title">
              Cambiar Ahorros Mama y Papa
            </h2>
            <p className="modal-body">
              ¿Confirmar el cambio de{" "}
              <strong>{formatCurrency(ahorrosMamaPapa)}</strong> a{" "}
              <strong>{formatCurrency(confirmAhorros.newValue)}</strong>?
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="button button-secondary"
                onClick={confirmAhorrosCancel}
              >
                Cancelar
              </button>
              <button type="button" className="button" onClick={confirmAhorrosOk}>
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="app-header">
        <div>
          <div className="app-title">Control Gastos</div>
          <div className="app-subtitle">
            Registra movimientos por lugar y ve los totales al instante.
          </div>
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

      <div className="layout">
        <section className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Nuevo movimiento</div>
              <div className="card-subtitle">
                Usa montos positivos para entradas y negativos para salidas.
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="field">
                <div className="field-label-row">
                  <label className="field-label" htmlFor="date">
                    Fecha
                  </label>
                </div>
                <input
                  id="date"
                  type="date"
                  className="input"
                  value={form.date}
                  onChange={handleChange("date")}
                />
              </div>

              <div className="field">
                <div className="field-label-row">
                  <label className="field-label" htmlFor="place">
                    Lugar
                  </label>
                </div>
                <select
                  id="place"
                  className="select"
                  value={form.place}
                  onChange={handleChange("place")}
                >
                  {places.map((place) => (
                    <option key={place} value={place}>
                      {place}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <div className="field-label-row">
                  <label className="field-label" htmlFor="amount">
                    Movimiento
                  </label>
                </div>
                <input
                  id="amount"
                  type="text"
                  inputMode="decimal"
                  className={`input ${amountError ? "input-error" : ""}`}
                  placeholder="0.00"
                  value={form.amount}
                  onChange={handleChange("amount")}
                />
                {amountError && <div className="error-text">{amountError}</div>}
              </div>

              <div className="field">
                <div className="field-label-row">
                  <label className="field-label" htmlFor="comment">
                    Comentario
                  </label>
                </div>
                <textarea
                  id="comment"
                  className="textarea"
                  placeholder="Saldo inicial, pago de renta, etc."
                  value={form.comment}
                  onChange={handleChange("comment")}
                />
              </div>
            </div>

            <div className="button-row">
              <button type="submit" className="button">
                <span>Guardar movimiento</span>
              </button>
            </div>
          </form>

          <div className="add-category">
            <div className="card-subtitle" style={{ marginBottom: "0.5rem" }}>
              Agregar categoría
            </div>
            <div className="add-category-row">
              <input
                type="text"
                className="input"
                placeholder="Nombre de la categoría"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCategory())}
              />
              <button
                type="button"
                className="button button-secondary"
                onClick={addCategory}
                disabled={!newCategoryName.trim()}
              >
                Agregar
              </button>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Totales por lugar</div>
              <div className="card-subtitle">
                Calculados automáticamente con los movimientos.
              </div>
            </div>
          </div>

          <div className="totals-grid">
            {places.map((place) => {
              const value = totalsByPlace[place];
              const isPositive = value >= 0;
              const pillClass = [
                "pill",
                value > 0 ? "pill-positive" : "",
                value < 0 ? "pill-negative" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <div key={place} className={pillClass}>
                  <div className="pill-label">{place}</div>
                  <div className="pill-value">
                    {isPositive ? "+" : ""}
                    {formatCurrency(value)}
                  </div>
                </div>
              );
            })}

            <div className="pill pill-total">
              <div className="pill-label">Total</div>
              <div className="pill-value">
                {grandTotal >= 0 ? "+" : ""}
                {formatCurrency(grandTotal)}
              </div>
            </div>
          </div>

          <div className="ahorros-mama-papa">
            <div className="ahorros-row">
              <label className="pill-label">Ahorros Mama y Papa</label>
              {isEditingAhorros ? (
                <div className="ahorros-edit">
                  <input
                    type="text"
                    inputMode="decimal"
                    className="input input-ahorros"
                    value={tempAhorros}
                    onChange={(e) => setTempAhorros(e.target.value)}
                  />
                  <button
                    type="button"
                    className="button"
                    onClick={saveEditAhorros}
                  >
                    Guardar
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={cancelEditAhorros}
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <div className="ahorros-display">
                  <span className="ahorros-value">{formatCurrency(ahorrosMamaPapa)}</span>
                  <button
                    type="button"
                    className="button button-secondary btn-edit-ahorros"
                    onClick={startEditAhorros}
                  >
                    Modificar
                  </button>
                </div>
              )}
            </div>
            <div className={`pill pill-adeudado ${adeudado > 0 ? "pill-negative" : "pill-positive"}`}>
              <div className="pill-label">{adeudado > 0 ? "Faltando" : "Disponible"}</div>
              <div className="pill-value">
                {adeudado > 0 ? formatCurrency(adeudado) : formatCurrency(-adeudado)}
              </div>
            </div>
          </div>
        </section>
      </div>

      <section className="card" style={{ marginTop: "1.25rem" }}>
        <div className="card-header">
          <div>
            <div className="card-title">Historial de movimientos</div>
            <div className="card-subtitle">
              Tus registros, con totales consistentes con la tabla superior.
            </div>
          </div>
          <span className="chip">{entries.length} movimientos</span>
        </div>

        <div className="table-wrapper">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Lugar</th>
                  <th className="cell-right">Movimiento</th>
                  <th>Comentario</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const positive = entry.amount >= 0;
                  return (
                    <tr key={entry.id}>
                      <td>{formatDisplayDate(entry.date)}</td>
                      <td>{entry.place}</td>
                      <td
                        className={`cell-right ${
                          positive ? "amount-positive" : "amount-negative"
                        }`}
                      >
                        {positive ? "+" : ""}
                        {formatCurrency(entry.amount)}
                      </td>
                      <td className={entry.comment ? "" : "muted"}>
                        {entry.comment || "—"}
                      </td>
                      <td className="cell-actions">
                        <button
                          type="button"
                          className="btn-delete"
                          onClick={() => handleDelete(entry.id)}
                          title="Eliminar movimiento"
                        >
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="table-footer">
            <span>
              <strong>Total:</strong>{" "}
              {grandTotal >= 0 ? "+" : ""}
              {formatCurrency(grandTotal)}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}

