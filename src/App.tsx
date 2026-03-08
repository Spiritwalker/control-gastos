import { useMemo, useState } from "react";

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

  const addCategory = () => {
    const name = newCategoryName.trim();
    if (!name || places.includes(name)) return;
    setPlaces((prev) => [...prev, name]);
    setNewCategoryName("");
  };

  const nextId = useMemo(
    () => (entries.length ? Math.max(...entries.map((e) => e.id)) + 1 : 1),
    [entries],
  );

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

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const raw = form.amount.replace(/\s/g, "").replace(",", ".");
    const parsed = Number(raw);

    if (!raw || Number.isNaN(parsed)) {
      setAmountError("Ingresa un número válido (positivo o negativo).");
      return;
    }

    const newEntry: Entry = {
      id: nextId,
      date: form.date || todayIso(),
      place: form.place,
      amount: parsed,
      comment: form.comment.trim(),
    };

    setEntries((prev) => [newEntry, ...prev]);
    resetForm();
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <div className="app-title">Control Gastos</div>
          <div className="app-subtitle">
            Registra movimientos por lugar y ve los totales al instante.
          </div>
        </div>
      </header>

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

