export function MiniSparkline({
  values,
  tone = "cyan"
}: {
  values: number[];
  tone?: "cyan" | "acid" | "pink" | "amber" | "red";
}) {
  const stroke =
    tone === "acid"
      ? "#7fb7a3"
      : tone === "pink"
        ? "#bc9858"
        : tone === "amber"
          ? "#bc9858"
          : tone === "red"
            ? "#df6b55"
            : "#d8d0bd";
  const width = 160;
  const height = 56;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const path = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg
      className="h-14 w-full overflow-visible"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="价格轨迹"
    >
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={`${path} L ${width} ${height} L 0 ${height} Z`}
        fill={stroke}
        opacity="0.12"
      />
    </svg>
  );
}
