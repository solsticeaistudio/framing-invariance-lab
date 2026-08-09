type Props = {
  label: string;
  value: string;
  detail?: string;
  tone?: "neutral" | "good" | "warn" | "danger";
};

export function MetricCard({ label, value, detail, tone = "neutral" }: Props) {
  return (
    <div className={`metric-card metric-card--${tone}`}>
      <div className="eyebrow">{label}</div>
      <div className="metric-card__value">{value}</div>
      {detail && <div className="metric-card__detail">{detail}</div>}
    </div>
  );
}
