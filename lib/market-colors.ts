import type { StockMarket } from "./stock-catalog";

export interface MarketColorPalette {
  riseText: string;
  fallText: string;
  riseBackground: string;
  fallBackground: string;
  riseHex: string;
  fallHex: string;
}

const chinaPalette: MarketColorPalette = {
  riseText: "text-dangerline",
  fallText: "text-acid",
  riseBackground: "bg-dangerline/70",
  fallBackground: "bg-acid/70",
  riseHex: "#df6b55",
  fallHex: "#7fb7a3"
};

const usPalette: MarketColorPalette = {
  riseText: "text-acid",
  fallText: "text-dangerline",
  riseBackground: "bg-acid/70",
  fallBackground: "bg-dangerline/70",
  riseHex: "#7fb7a3",
  fallHex: "#df6b55"
};

export function marketColorPalette(market: StockMarket) {
  return market === "CN" ? chinaPalette : usPalette;
}

export function marketChangeText(market: StockMarket, value: number | null | undefined) {
  const palette = marketColorPalette(market);
  return (value ?? 0) >= 0 ? palette.riseText : palette.fallText;
}
